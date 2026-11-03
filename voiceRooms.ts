import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { managedVoiceRooms, portalSettings, sensitiveApprovals } from "../drizzle/schema";
import { discordApi } from "./discord";
import { adminProcedure, permissionProcedure, protectedProcedure, router } from "./_core/trpc";
import { audit, getPortalSettings, notify, requireDb } from "./portalFeatures";
import type { PermissionId } from "./permissions";

type Guild = { id: string; name: string };
type Channel = { id: string; guild_id?: string; parent_id?: string | null; name: string; type: number; user_limit?: number; permission_overwrites?: Array<{ id: string; type: number; allow: string; deny: string }> };
const idRule = z.string().regex(/^\d{17,20}$/);
const roomName = z.string().trim().min(2).max(80).refine(s => !/[\r\n@]/.test(s), "Invalid room name");
const allowed = (actor: { role: string; permissions: PermissionId[] }, permission: PermissionId) => actor.role === "admin" || actor.permissions.includes(permission);

async function guildOptions() {
  const guilds = await discordApi<Guild[]>("/users/@me/guilds");
  return guilds.map(g => ({ id: g.id, name: g.name }));
}
async function assertAccessibleGuild(guildId: string) {
  if (!(await guildOptions()).some(g => g.id === guildId)) throw new TRPCError({ code: "FORBIDDEN", message: "Discord bot is not a member of that server." });
}

export const voiceRouter = router({
  options: permissionProcedure("manageDiscord").input(z.object({ guildId: idRule.optional() })).query(async ({ input }) => {
    const guilds = await guildOptions();
    const settings = await getPortalSettings();
    const chosen = input.guildId || settings.voiceGuildId;
    if (chosen && !guilds.some(g => g.id === chosen)) throw new TRPCError({ code: "FORBIDDEN" });
    const channels = chosen ? await discordApi<Channel[]>(`/guilds/${chosen}/channels`) : [];
    return { guilds, categories: channels.filter(c => c.type === 4).map(c => ({ id: c.id, name: c.name })), textChannels: channels.filter(c => c.type === 0).map(c => ({ id: c.id, name: c.name })), voiceChannels: channels.filter(c => c.type === 2).map(c => ({ id: c.id, name: c.name, parentId: c.parent_id || null })) };
  }),
  configure: adminProcedure.input(z.object({ guildId: idRule, categoryId: idRule, alertsChannelId: z.union([idRule, z.literal("")]) })).mutation(async ({ ctx, input }) => {
    await assertAccessibleGuild(input.guildId);
    const channels = await discordApi<Channel[]>(`/guilds/${input.guildId}/channels`);
    if (!channels.some(c => c.id === input.categoryId && c.type === 4)) throw new TRPCError({ code: "BAD_REQUEST", message: "Select an existing Discord category." });
    if (input.alertsChannelId && !channels.some(c => c.id === input.alertsChannelId && c.type === 0)) throw new TRPCError({ code: "BAD_REQUEST", message: "Select an existing text channel for alerts." });
    const db = await requireDb();
    await getPortalSettings();
    await db.update(portalSettings).set({ voiceGuildId: input.guildId, voiceCategoryId: input.categoryId, discordAlertsChannelId: input.alertsChannelId || null }).where(eq(portalSettings.id, 1));
    await audit(ctx.user.id, "voice.configure", "guild", input.guildId, "Voice category and alert channel configured");
    return { success: true };
  }),
  config: protectedProcedure.query(async () => {
    const settings = await getPortalSettings();
    return { enabled: Boolean(settings.voiceGuildId && settings.voiceCategoryId), guildId: settings.voiceGuildId, categoryId: settings.voiceCategoryId, alertsChannelId: settings.discordAlertsChannelId };
  }),
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const rooms = await db.select().from(managedVoiceRooms).where(isNull(managedVoiceRooms.deletedAt)).orderBy(desc(managedVoiceRooms.createdAt)).limit(150);
    return { rooms, canCreate: allowed(ctx.user, "createVoiceRooms"), canDelete: allowed(ctx.user, "deleteVoiceRooms"), canManage: allowed(ctx.user, "manageVoiceRooms") };
  }),
  adopt: adminProcedure.input(z.object({ channelId: idRule })).mutation(async ({ ctx, input }) => {
    const settings = await getPortalSettings();
    if (!settings.voiceGuildId || !settings.voiceCategoryId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Configure the voice category first." });
    const channels = await discordApi<Channel[]>(`/guilds/${settings.voiceGuildId}/channels`);
    const selected = channels.find(c => c.id === input.channelId && c.type === 2 && c.parent_id === settings.voiceCategoryId);
    if (!selected) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a voice room in the managed category." });
    const db = await requireDb();
    const [existing] = await db.select().from(managedVoiceRooms).where(eq(managedVoiceRooms.channelId, input.channelId));
    if (existing) throw new TRPCError({ code: "CONFLICT", message: "This room is already tracked by the website." });
    await db.insert(managedVoiceRooms).values({
      guildId: settings.voiceGuildId, categoryId: settings.voiceCategoryId, channelId: selected.id,
      name: selected.name.slice(0, 80), userLimit: selected.user_limit ?? 0, source: "adopted", createdBy: ctx.user.id,
    });
    await audit(ctx.user.id, "voice.adopt", "voice", selected.id, `Explicitly adopted: ${selected.name.slice(0, 70)}`);
    return { success: true };
  }),
  create: permissionProcedure("createVoiceRooms").input(z.object({ name: roomName, userLimit: z.number().int().min(0).max(99).default(0) })).mutation(async ({ ctx, input }) => {
    const settings = await getPortalSettings();
    if (!settings.voiceGuildId || !settings.voiceCategoryId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Configure the Discord server and voice category first." });
    const db = await requireDb();
    const current = await db.select().from(managedVoiceRooms).where(isNull(managedVoiceRooms.deletedAt));
    if (current.length >= 100 || current.filter(r => r.createdBy === ctx.user.id).length >= 8) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Voice room limit reached." });
    const created = await discordApi<Channel>(`/guilds/${settings.voiceGuildId}/channels`, { method: "POST", body: { name: input.name, type: 2, parent_id: settings.voiceCategoryId, user_limit: input.userLimit } });
    try {
      await db.insert(managedVoiceRooms).values({ guildId: settings.voiceGuildId, categoryId: settings.voiceCategoryId, channelId: created.id, name: input.name, userLimit: input.userLimit, createdBy: ctx.user.id });
    } catch (error) {
      // Compensate orphan creation if persistence failed, without swallowing original error.
      try { await discordApi(`/channels/${created.id}`, { method: "DELETE" }); } catch { /* admin can clean up an orphan manually */ }
      throw error;
    }
    await audit(ctx.user.id, "voice.create", "voice", created.id, input.name);
    return { success: true, channelId: created.id };
  }),
  update: permissionProcedure("manageVoiceRooms").input(z.object({ id: z.number().int().positive(), name: roomName, userLimit: z.number().int().min(0).max(99) })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    const [record] = await db.select().from(managedVoiceRooms).where(and(eq(managedVoiceRooms.id, input.id), isNull(managedVoiceRooms.deletedAt)));
    if (!record) throw new TRPCError({ code: "NOT_FOUND" });
    const actual = await discordApi<Channel>(`/channels/${record.channelId}`);
    if (actual.type !== 2 || actual.guild_id !== record.guildId) throw new TRPCError({ code: "CONFLICT", message: "Discord channel identity does not match the managed room." });
    await discordApi(`/channels/${record.channelId}`, { method: "PATCH", body: { name: input.name, user_limit: input.userLimit } });
    await db.update(managedVoiceRooms).set({ name: input.name, userLimit: input.userLimit }).where(eq(managedVoiceRooms.id, input.id));
    await audit(ctx.user.id, "voice.update", "voice", record.channelId, input.name);
    return { success: true };
  }),
  lock: permissionProcedure("manageVoiceRooms").input(z.object({ id: z.number().int().positive(), locked: z.boolean() })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    const [record] = await db.select().from(managedVoiceRooms).where(and(eq(managedVoiceRooms.id, input.id), isNull(managedVoiceRooms.deletedAt)));
    if (!record) throw new TRPCError({ code: "NOT_FOUND" });
    const actual = await discordApi<Channel>(`/channels/${record.channelId}`);
    if (actual.type !== 2 || actual.guild_id !== record.guildId) throw new TRPCError({ code: "CONFLICT" });
    const existing = actual.permission_overwrites?.find(o => o.id === record.guildId && o.type === 0);
    const CONNECT = 1n << 20n;
    if (!record.locked && ((BigInt(existing?.allow || "0") | BigInt(existing?.deny || "0")) & CONNECT) !== 0n) throw new TRPCError({ code: "CONFLICT", message: "An external Discord permission override already controls Connect. Edit that setting directly in Discord." });
    const allow = BigInt(existing?.allow || "0") & ~CONNECT;
    const deny = input.locked ? BigInt(existing?.deny || "0") | CONNECT : BigInt(existing?.deny || "0") & ~CONNECT;
    await discordApi(`/channels/${record.channelId}/permissions/${record.guildId}`, { method: "PUT", body: { allow: allow.toString(), deny: deny.toString(), type: 0 } });
    await db.update(managedVoiceRooms).set({ locked: input.locked }).where(eq(managedVoiceRooms.id, input.id));
    await audit(ctx.user.id, "voice.lock", "voice", record.channelId, input.locked ? "locked" : "unlocked");
    return { success: true };
  }),
  delete: permissionProcedure("deleteVoiceRooms").input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    const [record] = await db.select().from(managedVoiceRooms).where(and(eq(managedVoiceRooms.id, input.id), isNull(managedVoiceRooms.deletedAt)));
    if (!record) throw new TRPCError({ code: "NOT_FOUND" });
    // Adopted channels were not created by this website. Require a second admin to approve.
    if (record.source === "adopted") {
      await db.insert(sensitiveApprovals).values({ action: "delete_adopted_voice", payload: JSON.stringify({ channelId: record.channelId }), requestedBy: ctx.user.id });
      await audit(ctx.user.id, "voice.delete.request", "voice", record.channelId);
      return { success: true, approvalRequired: true };
    }
    // Safety boundary: deletion is possible ONLY for tracked portal-created OR admin-adopted rooms.
    const actual = await discordApi<Channel>(`/channels/${record.channelId}`);
    if (actual.type !== 2 || actual.guild_id !== record.guildId) throw new TRPCError({ code: "CONFLICT", message: "Channel changed; aborting deletion." });
    await discordApi(`/channels/${record.channelId}`, { method: "DELETE" });
    await db.update(managedVoiceRooms).set({ deletedAt: new Date(), deletedBy: ctx.user.id }).where(and(eq(managedVoiceRooms.id, input.id), isNull(managedVoiceRooms.deletedAt)));
    await audit(ctx.user.id, "voice.delete", "voice", record.channelId, record.name);
    await notify(record.createdBy, "voice", "تم حذف روم صوتي", `تم حذف الروم ${record.name} من لوحة الإدارة.`);
    return { success: true };
  }),
});
