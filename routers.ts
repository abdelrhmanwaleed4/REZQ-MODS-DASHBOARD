import { moderationCenterRouter, appealsRouter, analyticsRouter, knowledgeRouter, announcementsRouter, staffChatRouter, bookmarkRouter, automationRouter, backupRouter, approvalsRouter } from "./advancedOps";
import { tempVoiceRouter } from "./tempVoice";
import { accountsRouter, rewardsRouter } from "./accountLinks";
import { sensitiveApprovals } from "../drizzle/schema";
import { requireDb } from "./portalFeatures";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "./db";
import { PERMISSION_IDS, parsePermissions, canManageDelegatedRank } from "./permissions";
import { adminProcedure, permissionProcedure, publicProcedure, router } from "./_core/trpc";
import { getPublicDiscordConfig, pollDiscordOnce, saveDiscordIntegration } from "./discord";
import { clearAppSession } from "./_core/appAuth";
import { staffRouter, attendanceRouter, pointsRouter, absencesRouter, disciplineRouter, reportsRouter } from "./moderation";
import { settingsRouter, notificationRouter, auditRouter, incidentsRouter, academyRouter, performanceRouter, sessionRouter, audit, notify } from "./portalFeatures";
import { voiceRouter } from "./voiceRooms";
import { mfaRouter } from "./adminMfa";
import { getKickEvents } from "./kickEvents";
import { kickIntegrationConfig, refreshKickViewers, subscribeKickEvents } from "./kickApi";

const rankInput = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).nullable(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  permissions: z.array(z.enum(PERMISSION_IDS)).max(PERMISSION_IDS.length),
});

/** A second administrator must authorize new privileges or changes to critical ranks. */
export const CRITICAL_RANK_PERMISSIONS = new Set<string>([
  "manageRanks", "manageUsers", "manageDiscord", "managePoints", "manageDiscipline",
  "deleteVoiceRooms", "manageVoiceRooms", "manageModeration", "manageAutoMod",
  "manageAutomations", "manageRewards", "viewAudit", "manageAcademy", "reviewAppeals",
]);
function containsCriticalPrivileges(permissions: readonly string[]) {
  return permissions.some(permission => CRITICAL_RANK_PERMISSIONS.has(permission));
}
async function proposeRankOperation(requestedBy: number, action: "rank_save_high" | "rank_assign_high" | "rank_unassign_high", payload: object) {
  const database = await requireDb();
  await database.insert(sensitiveApprovals).values({ action, payload: JSON.stringify(payload), requestedBy });
  await audit(requestedBy, `approval.request.${action}`, "approval");
}

export const appRouter = router({
  moderationCenter: moderationCenterRouter,
  appeals: appealsRouter,
  analytics: analyticsRouter,
  knowledge: knowledgeRouter,
  announcements: announcementsRouter,
  staffChat: staffChatRouter,
  bookmarks: bookmarkRouter,
  automations: automationRouter,
  backups: backupRouter,
  approvals: approvalsRouter,
  tempVoice: tempVoiceRouter,
  accounts: accountsRouter,
  rewards: rewardsRouter,

  staff: staffRouter,
  settings: settingsRouter,
  notifications: notificationRouter,
  audits: auditRouter,
  incidents: incidentsRouter,
  academy: academyRouter,
  performance: performanceRouter,
  sessions: sessionRouter,
  voice: voiceRouter,
  mfa: mfaRouter,
  kick: router({
    events: permissionProcedure("viewReports").query(getKickEvents),
    integration: adminProcedure.query(kickIntegrationConfig),
    subscribe: adminProcedure.mutation(async ({ ctx }) => { const result = await subscribeKickEvents(); await audit(ctx.user.id, "kick.subscribe", "kick"); return { success: true, response: result }; }),
    refresh: adminProcedure.mutation(async () => { await refreshKickViewers(); return { success: true }; }),
  }),
  attendance: attendanceRouter,
  points: pointsRouter,
  absences: absencesRouter,
  discipline: disciplineRouter,
  reports: reportsRouter,
  auth: router({
    me: publicProcedure.query(({ ctx }) => ctx.user),
    snapshot: publicProcedure.query(({ ctx }) => ({ user: ctx.user, sessionRevokedReason: ctx.sessionRevokedReason })),
    logout: publicProcedure.mutation(async ({ ctx }) => {
      if (ctx.user) {
        const { getDb } = await import("./db");
        const { loginSessions } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const database = await getDb();
        if (database) await database.update(loginSessions).set({ revokedAt: new Date() }).where(eq(loginSessions.id, ctx.user.sessionId));
      }
      clearAppSession(ctx.res); return { success: true };
    }),
  }),
  stream: router({
    status: publicProcedure.query(async () => {
      const [state, discord] = await Promise.all([db.getStreamState(), db.getDiscordSettings()]);
      return {
        isLive: state.isLive,
        badge: state.badge,
        viewerCount: state.viewerCount,
        updatedAt: state.updatedAt,
        connected: discord?.connected ?? false,
        configured: Boolean(discord),
      };
    }),
  }),
  ranks: router({
    list: permissionProcedure("manageRanks").query(async () => (await db.getAllRanks()).map(rank => ({ ...rank, permissions: parsePermissions(rank.permissions) }))),
    members: permissionProcedure("manageRanks").query(async () => (await db.listUsersWithRanks())
      .filter(user => user.role !== "admin")
      .map(user => ({ ...user, ranks: user.ranks.map(rank => ({ ...rank, color: "#A9F4FF" })) }))),
    save: permissionProcedure("manageRanks").input(rankInput).mutation(async ({ input, ctx }) => {
      if (ctx.user.role !== "admin") {
        if (!canManageDelegatedRank(ctx.user.permissions, input.permissions)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You cannot grant permissions you don't have." });
        }
        if (input.id) {
          const existing = await db.getRankById(input.id);
          if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Rank not found." });
          if (!canManageDelegatedRank(ctx.user.permissions, parsePermissions(existing.permissions))) {
            throw new TRPCError({ code: "FORBIDDEN", message: "You cannot edit a more privileged rank." });
          }
        }
        if (input.id && (await db.getUserRanks(ctx.user.id)).some(rank => rank.id === input.id) && !input.permissions.includes("manageRanks")) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You cannot remove your own Manage Ranks access." });
        }
      }
      const oldRank = input.id ? await db.getRankById(input.id) : null;
      const newCritical = containsCriticalPrivileges(input.permissions);
      const oldCritical = oldRank && containsCriticalPrivileges(parsePermissions(oldRank.permissions));
      if (newCritical || oldCritical) {
        await proposeRankOperation(ctx.user.id, "rank_save_high", {
          ...input,
          // If another administrator edits this rank before approval, reject stale requests.
          expectedPreviousPermissions: oldRank?.permissions ?? null,
        });
        return { pendingApproval: true };
      }
      try {
        const rank = await db.saveRank(input);
        if (!rank) throw new Error("Rank was not saved");
        await audit(ctx.user.id, input.id ? "rank.update" : "rank.create", "rank", rank.id, rank.name);
        return { ...rank, permissions: parsePermissions(rank.permissions) };
      } catch (error) {
        if (error instanceof Error && error.message.toLowerCase().includes("duplicate")) {
          throw new TRPCError({ code: "CONFLICT", message: "A rank with this name already exists." });
        }
        throw error;
      }
    }),
    delete: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input, ctx }) => {
      await db.deleteRank(input.id);
      // The id remains in the audit record even after hard deletion.
      await audit(ctx.user.id, "rank.delete", "rank", input.id);
      return { success: true };
    }),
    assign: permissionProcedure("manageRanks").input(z.object({ userId: z.number().int().positive(), rankId: z.number().int().positive() })).mutation(async ({ input, ctx }) => {
      if (ctx.user.role !== "admin" && input.userId === ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "Rank managers cannot assign ranks to themselves." });
      const [user, rank] = await Promise.all([db.getUserById(input.userId), db.getRankById(input.rankId)]);
      if (!user || user.role === "admin") throw new TRPCError({ code: "NOT_FOUND", message: "That account cannot be assigned a rank." });
      if (user.status !== "approved") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Approve the account before assigning a rank." });
      if (!rank) throw new TRPCError({ code: "NOT_FOUND", message: "Rank not found." });
      if (ctx.user.role !== "admin" && !canManageDelegatedRank(ctx.user.permissions, parsePermissions(rank.permissions))) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You cannot assign a rank with permissions above yours." });
      }
      if (containsCriticalPrivileges(parsePermissions(rank.permissions))) {
        await proposeRankOperation(ctx.user.id, "rank_assign_high", {
          ...input, expectedPermissions: rank.permissions,
        });
        return { success: true, pendingApproval: true };
      }
      await db.assignRank(input.userId, input.rankId);
      await notify(input.userId, "rank", "رتبة جديدة", `تم تعيين رتبة ${rank.name} لحسابك.`);
      await audit(ctx.user.id, "rank.assign", "user", input.userId, `Rank: ${rank.name}`);
      return { success: true };
    }),
    unassign: permissionProcedure("manageRanks").input(z.object({ userId: z.number().int().positive(), rankId: z.number().int().positive() })).mutation(async ({ input, ctx }) => {
      if (ctx.user.role !== "admin" && input.userId === ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "Rank managers cannot remove their own roles." });
      const [target, rank] = await Promise.all([db.getUserById(input.userId), db.getRankById(input.rankId)]);
      if (!target || target.role === "admin" || !rank) throw new TRPCError({ code: "NOT_FOUND", message: "Rank or member not found." });
      if (ctx.user.role !== "admin" && !canManageDelegatedRank(ctx.user.permissions, parsePermissions(rank.permissions))) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You cannot remove a more privileged rank." });
      }
      if (containsCriticalPrivileges(parsePermissions(rank.permissions))) {
        await proposeRankOperation(ctx.user.id, "rank_unassign_high", {
          ...input, expectedPermissions: rank.permissions,
        });
        return { success: true, pendingApproval: true };
      }
      await db.removeRank(input.userId, input.rankId);
      await notify(input.userId, "rank", "تغيير الرتبة", `تمت إزالة رتبة ${rank.name} من حسابك.`);
      await audit(ctx.user.id, "rank.unassign", "user", input.userId, `Rank: ${rank.name}`);
      return { success: true };
    }),
  }),
  users: router({
    list: permissionProcedure("manageUsers").query(async () => (await db.listUsersWithRanks()).filter(user => user.role !== "admin")),
    approve: permissionProcedure("manageUsers").input(z.object({ userId: z.number().int().positive() })).mutation(async ({ input, ctx }) => {
      const user = await db.approveUser(input.userId);
      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "Account not found." });
      if (user.status === "approved") { await notify(input.userId, "account", "تم اعتماد حسابك", "تمت الموافقة على عضويتك في REZK MODS."); await audit(ctx.user.id, "user.approve", "user", input.userId); }
      return { success: user.status === "approved" };
    }),
    ban: permissionProcedure("manageUsers").input(z.object({ userId: z.number().int().positive(), reason: z.string().trim().max(500).nullable() })).mutation(async ({ input, ctx }) => {
      if (input.userId === ctx.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot ban your own account." });
      const user = await db.getUserById(input.userId);
      if (!user || user.role === "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Administrator accounts cannot be banned here." });
      await db.permanentlyBanUser(input.userId, input.reason);
      await audit(ctx.user.id, "user.ban", "user", input.userId, input.reason || "no reason provided");
      return { success: true };
    }),
  }),
  discord: router({
    config: permissionProcedure("manageDiscord").query(getPublicDiscordConfig),
    save: permissionProcedure("manageDiscord").input(z.object({ token: z.string().min(1).max(512), channelId: z.string().trim().min(17).max(20) })).mutation(async ({ input, ctx }) => {
      try {
        await saveDiscordIntegration(input.token, input.channelId);
        await audit(ctx.user.id, "discord.configure", "discord", input.channelId, "Connection changed; token not logged");
        await pollDiscordOnce();
        return { success: true, configured: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Discord setup failed.";
        throw new TRPCError({ code: "BAD_REQUEST", message });
      }
    }),
    refresh: permissionProcedure("manageDiscord").mutation(async () => {
      await pollDiscordOnce();
      return getPublicDiscordConfig();
    }),
  }),
});

export type AppRouter = typeof appRouter;
