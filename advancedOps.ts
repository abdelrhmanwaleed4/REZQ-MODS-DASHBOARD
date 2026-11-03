/** REZK advanced operations. Every write is server-authorized; all user text is plain text. */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import {
  users, linkedAccounts, moderationCases, automodRules, automodHits, punishmentAppeals,
  streamSamples, staffAnnouncements, announcementReads, staffMessages,
  knowledgeArticles, streamBookmarks, automationRules, sensitiveApprovals,
  portalSettings, managedVoiceRooms, temporaryVoiceConfig, temporaryVoiceRooms,
} from "../drizzle/schema";
import { adminProcedure, permissionProcedure, protectedProcedure, router } from "./_core/trpc";
import { audit, getPortalSettings, notify, requireDb } from "./portalFeatures";
import { getStreamState } from "./db";
import * as rankDb from "./db";
import { PERMISSION_IDS, parsePermissions } from "./permissions";
import { tryDiscordAlert, discordApi } from "./discord";

const evidence = z.union([z.literal(""), z.url().refine(s => s.startsWith("https://"))]);
const id = z.number().int().positive();
const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const PER_PAGE = 100;
const keyword = (s: string) => s.toLocaleLowerCase("en-US");
export type AutomationEvent = "stream_started" | "stream_ended" | "case_created" | "appeal_created" | "voice_created" | "reward_pending";

/** Only allow predeclared actions. No arbitrary URLs, scripts, or cross-service commands. */
export async function fireAutomation(event: AutomationEvent, description: string) {
  const db = await requireDb();
  const rules = await db.select().from(automationRules).where(and(eq(automationRules.event, event), eq(automationRules.enabled, true))).limit(50);
  for (const rule of rules) {
    try {
      if (rule.action === "discord_alert") await tryDiscordAlert(`REZK • ${rule.title}`, description.slice(0, 400));
      else {
        const admins = await db.select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), eq(users.status, "approved"))).limit(50);
        for (const person of admins) await notify(person.id, "automation", rule.title, description.slice(0, 400));
      }
    } catch (e) { console.warn("[automation]", rule.id, e instanceof Error ? e.message : "failure"); }
  }
}

/** Last sample no more than once per minute per stream epoch, even across app instances. */
export async function recordStreamSample(epoch: number, count: number, live: boolean) {
  if (!Number.isInteger(epoch) || !Number.isSafeInteger(count) || count < 0) return;
  const db = await requireDb();
  // PostgreSQL INSERT SELECT, sampledAt quoted to match case-sensitive schema.
  await db.execute(sql`INSERT INTO stream_samples ("streamEpoch", "viewerCount", "isLive", "sampledAt")
    SELECT ${epoch}, ${count}, ${live}, NOW()
    WHERE NOT EXISTS (SELECT 1 FROM stream_samples WHERE "streamEpoch"=${epoch}
      AND "sampledAt" > NOW() - INTERVAL '60 seconds')`);
}

export function matchesAutoMod(kind: "word" | "link" | "flood", pattern: string, message: string): boolean {
  if (!message || message.length > 4000) return false;
  if (kind === "link") return /(?:https?:\/\/|www\.)\S+/i.test(message);
  if (kind === "flood") {
    // Repeated char/phrase threshold; not a cross-user rate-limiter.
    return /(.)\1{9,}/u.test(message) || /(.{2,20})\1{5,}/u.test(message);
  }
  const escaped = pattern.trim().toLocaleLowerCase("en-US");
  return escaped.length > 1 && message.toLocaleLowerCase("en-US").includes(escaped);
}

const recentByUser = new Map<string, number[]>();
function isFlood(actor: string) {
  const now = Date.now();
  const old = recentByUser.get(actor) || [];
  const recent = old.filter(t => now - t < 8000).slice(-9);
  recent.push(now);
  if (recentByUser.size > 5000) recentByUser.clear();
  recentByUser.set(actor, recent);
  return recent.length >= 6;
}

async function scanAutomod(platform: "kick"|"discord", eventId: string, actor: string, message: string, deleteMessage?: () => Promise<unknown>) {
  if (!message) return 0;
  const db = await requireDb();
  const rules = await db.select().from(automodRules).where(and(eq(automodRules.enabled, true), eq(automodRules.platform, platform))).limit(100);
  const tooFast = isFlood(`${platform}:${actor}`);
  let count = 0, deleted = false;
  for (const rule of rules) {
    if (!(rule.kind === "flood" ? (tooFast || matchesAutoMod(rule.kind, rule.pattern, message)) : matchesAutoMod(rule.kind, rule.pattern, message))) continue;
    const hash = createHash("sha256").update(`${process.env.AUTOMOD_HASH_PEPPER || process.env.APP_SESSION_SECRET || "REZK_MODS"}:${actor}`).digest("hex");
    const inserted = await db.insert(automodHits).values({ ruleId: rule.id, eventId: eventId.slice(0, 80), platform, actorHash: hash })
      .onConflictDoNothing({ target: [automodHits.ruleId, automodHits.eventId] }).returning({ id: automodHits.id });
    if (inserted.length === 0) continue; // avoid repeat alerts/deletions on duplicate signed events
    count++;
    if (rule.action === "alert") await tryDiscordAlert(`AutoMod • ${platform}`, `قاعدة: ${rule.name} | حدث: ${eventId.slice(0, 35)}. راجع السجل.`);
    if (rule.action === "delete" && !deleted && deleteMessage) {
      try { await deleteMessage(); deleted = true; }
      catch (error) { console.warn(`[AutoMod ${platform} delete]`, error instanceof Error ? error.message : error); await tryDiscordAlert("AutoMod Delete Failed", `تعذر حذف رسالة #${eventId.slice(0,35)}. تأكد من صلاحيات البوت.`); }
    }
  }
  return count;
}
/** Signed Kick events, verified upstream. The chat content is never persisted. */
export async function processKickChatEvent(eventId: string, actor: string, message: string, messageId?: string) {
  return scanAutomod("kick", eventId, actor, message, messageId && /^[\w-]{3,100}$/.test(messageId) ? async () => {
    const { accessKickBroadcaster } = await import("./accountLinks");
    const response = await fetch(`https://api.kick.com/public/v1/chat/${encodeURIComponent(messageId)}`, { method: "DELETE", headers: { Authorization: `Bearer ${await accessKickBroadcaster()}` }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Kick chat deletion rejected (${response.status})`);
  } : undefined);
}
/** Discord bot MESSAGE_CREATE events. No message content is stored or displayed. */
export async function processDiscordChatEvent(guildId: string, channelId: string, eventId: string, actor: string, message: string) {
  const configuredGuild = process.env.DISCORD_AUTOMOD_GUILD_ID || (await getPortalSettings()).voiceGuildId;
  if (!configuredGuild || guildId !== configuredGuild || !/^[0-9]{17,20}$/.test(channelId) || !/^[0-9]{17,20}$/.test(eventId)) return 0;
  return scanAutomod("discord", eventId, actor, message, async () => { await discordApi(`/channels/${channelId}/messages/${eventId}`, { method: "DELETE" }); });
}

export const moderationCenterRouter = router({
  cases: permissionProcedure("manageModeration").input(z.object({ query: z.string().max(120).default("") })).query(async ({ input }) => {
    const db = await requireDb();
    const rows = await db.select().from(moderationCases).orderBy(desc(moderationCases.createdAt)).limit(200);
    return rows.filter(r => !input.query || keyword(`${r.subject} ${r.reason} ${r.platform}`).includes(keyword(input.query))).slice(0, 100);
  }),
  create: permissionProcedure("manageModeration").input(z.object({ platform: z.enum(["kick", "discord", "internal"]), subject: text(2, 120), action: z.enum(["warn", "timeout", "ban", "unban", "delete_message", "note"]), reason: text(4, 1000), evidenceUrl: evidence })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    const [result] = await db.insert(moderationCases).values({ ...input, evidenceUrl: input.evidenceUrl || null, actorId: ctx.user.id }).returning({ id: moderationCases.id });
    await audit(ctx.user.id, "mod.case.create", "case", result.id, `${input.platform}:${input.action}`);
    await fireAutomation("case_created", `تم تسجيل إجراء ${input.action} على ${input.subject}`);
    return { id: result.id };
  }),
  automodRules: permissionProcedure("manageAutoMod").query(async () => (await requireDb()).select().from(automodRules).orderBy(desc(automodRules.id)).limit(100)),
  hits: permissionProcedure("manageAutoMod").query(async () => (await requireDb()).select().from(automodHits).orderBy(desc(automodHits.id)).limit(100)),
  addAutoRule: permissionProcedure("manageAutoMod").input(z.object({ name: text(2, 80), platform: z.enum(["kick", "discord"]), kind: z.enum(["word", "link", "flood"]), pattern: z.string().max(200), action: z.enum(["log", "alert", "delete"]) })).mutation(async ({ ctx, input }) => {
    if (input.kind === "word" && input.pattern.trim().length < 2) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter at least two characters." });
    const db = await requireDb();
    await db.insert(automodRules).values({ ...input, createdBy: ctx.user.id });
    await audit(ctx.user.id, "automod.rule.create", "automod", undefined, input.name);
    return { success: true };
  }),
  setAutoRule: permissionProcedure("manageAutoMod").input(z.object({ id, enabled: z.boolean() })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    await db.update(automodRules).set({ enabled: input.enabled }).where(eq(automodRules.id, input.id));
    await audit(ctx.user.id, "automod.rule.toggle", "automod", input.id);
    return { success: true };
  }),
});

export const appealsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const canReview = ctx.user.role === "admin" || ctx.user.permissions.includes("reviewAppeals");
    return db.select().from(punishmentAppeals).where(canReview ? undefined : eq(punishmentAppeals.requesterId, ctx.user.id)).orderBy(desc(punishmentAppeals.createdAt)).limit(100);
  }),
  create: protectedProcedure.input(z.object({ caseId: id, reason: text(20, 1500) })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    const [record] = await db.select().from(moderationCases).where(eq(moderationCases.id, input.caseId));
    if (!record) throw new TRPCError({ code: "NOT_FOUND" });
    if (record.actorId === ctx.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot appeal an action you authored." });
    const identities = await db.select().from(linkedAccounts).where(eq(linkedAccounts.userId, ctx.user.id));
    const target = record.subject.trim().toLowerCase();
    const authorized = record.platform === "internal"
      ? target === String(ctx.user.id) || (Boolean(ctx.user.email) && target === ctx.user.email!.trim().toLowerCase())
      : identities.some(a => a.provider === record.platform && (target === a.providerUserId.toLowerCase() || target === a.username.toLowerCase()));
    if (!authorized) throw new TRPCError({ code: "FORBIDDEN", message: "You can only appeal cases against a verified account you own." });
    const existing = await db.select({ id: punishmentAppeals.id }).from(punishmentAppeals).where(and(eq(punishmentAppeals.caseId, input.caseId), eq(punishmentAppeals.requesterId, ctx.user.id), eq(punishmentAppeals.status, "pending"))).limit(1);
    if (existing.length) throw new TRPCError({ code: "CONFLICT", message: "This case already has a pending appeal." });
    await db.insert(punishmentAppeals).values({ requesterId: ctx.user.id, ...input });
    await audit(ctx.user.id, "appeal.create", "case", input.caseId);
    await fireAutomation("appeal_created", `استئناف جديد على الحالة #${input.caseId}`);
    return { success: true };
  }),
  decide: permissionProcedure("reviewAppeals").input(z.object({ id, status: z.enum(["accepted", "rejected"]), decision: text(3, 1000) })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    const [appeal] = await db.select().from(punishmentAppeals).where(eq(punishmentAppeals.id, input.id));
    if (!appeal || appeal.status !== "pending") throw new TRPCError({ code: "CONFLICT", message: "Appeal not pending." });
    const [record] = await db.select().from(moderationCases).where(eq(moderationCases.id, appeal.caseId));
    if (appeal.requesterId === ctx.user.id || record?.actorId === ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "An independent reviewer must decide." });
    await db.update(punishmentAppeals).set({ status: input.status, decision: input.decision, reviewerId: ctx.user.id, reviewedAt: new Date() }).where(and(eq(punishmentAppeals.id, input.id), eq(punishmentAppeals.status, "pending")));
    await notify(appeal.requesterId, "appeal", "قرار الاستئناف", `${input.status === "accepted" ? "تم قبول" : "تم رفض"} استئنافك. القرار لا يلغي عقوبة Kick تلقائيًا.`);
    await audit(ctx.user.id, "appeal.decide", "appeal", input.id, input.status);
    return { success: true };
  }),
});

export const analyticsRouter = router({
  overview: permissionProcedure("viewReports").query(async () => {
    const db = await requireDb();
    const cutoff = new Date(Date.now() - 30 * 24 * 3600_000);
    const samples = await db.select().from(streamSamples).where(gte(streamSamples.sampledAt, cutoff)).orderBy(desc(streamSamples.sampledAt)).limit(1000);
    const cases = await db.select().from(moderationCases).where(gte(moderationCases.createdAt, cutoff)).orderBy(desc(moderationCases.createdAt)).limit(500);
    const byEpoch = new Map<number, { peak: number; total: number; count: number; started: Date; last: Date }>();
    for (const s of samples) {
      const item = byEpoch.get(s.streamEpoch) || { peak: 0, total: 0, count: 0, started: s.sampledAt, last: s.sampledAt };
      item.peak = Math.max(item.peak, s.viewerCount); item.total += s.viewerCount; item.count++;
      if (s.sampledAt < item.started) item.started = s.sampledAt;
      if (s.sampledAt > item.last) item.last = s.sampledAt;
      byEpoch.set(s.streamEpoch, item);
    }
    return { samples: samples.reverse(), streams: [...byEpoch].map(([epoch, v]) => ({ epoch, peak: v.peak, average: Math.round(v.total / v.count), samples: v.count, firstSample: v.started, lastSample: v.last })), casesByAction: Object.entries(cases.reduce<Record<string, number>>((acc, c) => { acc[c.action] = (acc[c.action] || 0) + 1; return acc; }, {})), coverage: "Only connected sample intervals are measured; gaps are not estimated." };
  }),
});

export const knowledgeRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const rows = await db.select().from(knowledgeArticles).orderBy(desc(knowledgeArticles.updatedAt)).limit(100);
    return ctx.user.role === "admin" || ctx.user.permissions.includes("manageKnowledge") ? rows : rows.filter(a => a.published);
  }),
  save: permissionProcedure("manageKnowledge").input(z.object({ id: id.optional(), title: text(3, 160), body: text(10, 15000), published: z.boolean() })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    const { id: entryId, ...data } = input;
    if (entryId) {
      const result = await db.update(knowledgeArticles).set(data).where(eq(knowledgeArticles.id, entryId)); void result;
    } else await db.insert(knowledgeArticles).values({ ...data, createdBy: ctx.user.id });
    await audit(ctx.user.id, "knowledge.save", "article", entryId);
    return { success: true };
  }),
});

export const announcementsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const records = await db.select().from(staffAnnouncements).orderBy(desc(staffAnnouncements.createdAt)).limit(100);
    const reads = await db.select().from(announcementReads).where(eq(announcementReads.userId, ctx.user.id));
    return records.map(r => ({ ...r, read: reads.some(v => v.announcementId === r.id) }));
  }),
  post: permissionProcedure("manageAnnouncements").input(z.object({ title: text(3, 160), body: text(5, 7000) })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    await db.insert(staffAnnouncements).values({ ...input, createdBy: ctx.user.id });
    await audit(ctx.user.id, "announcement.post", "announcement", undefined, input.title);
    return { success: true };
  }),
  markRead: protectedProcedure.input(z.object({ id })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    const [existing] = await db.select({ id: staffAnnouncements.id }).from(staffAnnouncements).where(eq(staffAnnouncements.id, input.id));
    if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
    await db.insert(announcementReads).values({ announcementId: input.id, userId: ctx.user.id }).onConflictDoNothing({ target: [announcementReads.announcementId, announcementReads.userId] });
    return { success: true };
  }),
  receipts: permissionProcedure("manageAnnouncements").input(z.object({ id })).query(async ({ input }) => {
    const db = await requireDb();
    const receipts = await db.select().from(announcementReads).where(eq(announcementReads.announcementId, input.id));
    const approved = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.status, "approved"));
    return { read: receipts, totalApproved: approved.length, names: receipts.map(r => ({ userId: r.userId, name: approved.find(a => a.id === r.userId)?.name || `#${r.userId}` })) };
  }),
});

export const staffChatRouter = router({
  list: protectedProcedure.query(async () => (await requireDb()).select({ id: staffMessages.id, authorId: staffMessages.authorId, body: staffMessages.body, createdAt: staffMessages.createdAt, author: users.name }).from(staffMessages).innerJoin(users, eq(users.id, staffMessages.authorId)).orderBy(desc(staffMessages.createdAt)).limit(80)),
  send: protectedProcedure.input(z.object({ body: text(1, 1500) })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    const last = await db.select({ createdAt: staffMessages.createdAt }).from(staffMessages).where(eq(staffMessages.authorId, ctx.user.id)).orderBy(desc(staffMessages.id)).limit(1);
    if (last.length && Date.now() - last[0].createdAt.getTime() < 2500) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Wait before sending another message." });
    await db.insert(staffMessages).values({ authorId: ctx.user.id, body: input.body });
    return { success: true };
  }),
});

export const bookmarkRouter = router({
  list: protectedProcedure.query(async () => (await requireDb()).select().from(streamBookmarks).orderBy(desc(streamBookmarks.createdAt)).limit(PER_PAGE)),
  add: permissionProcedure("manageBookmarks").input(z.object({ label: text(2, 200), note: z.string().max(1000).default("") })).mutation(async ({ ctx, input }) => {
    const stream = await getStreamState();
    if (!stream.isLive) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Bookmarks require a live stream." });
    const db = await requireDb();
    await db.insert(streamBookmarks).values({ streamEpoch: stream.sessionEpoch, ...input, createdBy: ctx.user.id });
    await audit(ctx.user.id, "stream.bookmark", "stream", stream.sessionEpoch, input.label);
    return { success: true };
  }),
});

export const automationRouter = router({
  list: permissionProcedure("manageAutomations").query(async () => (await requireDb()).select().from(automationRules).orderBy(desc(automationRules.id)).limit(100)),
  create: permissionProcedure("manageAutomations").input(z.object({ title: text(3, 120), event: z.enum(["stream_started", "stream_ended", "case_created", "appeal_created", "voice_created", "reward_pending"]), action: z.enum(["notify_admins", "discord_alert"]) })).mutation(async ({ ctx, input }) => {
    const db = await requireDb(); await db.insert(automationRules).values({ ...input, createdBy: ctx.user.id });
    await audit(ctx.user.id, "automation.create", "automation", undefined, `${input.event}:${input.action}`); return { success: true };
  }),
  toggle: permissionProcedure("manageAutomations").input(z.object({ id, enabled: z.boolean() })).mutation(async ({ ctx, input }) => {
    const db = await requireDb(); await db.update(automationRules).set({ enabled: input.enabled }).where(eq(automationRules.id, input.id));
    await audit(ctx.user.id, "automation.toggle", "automation", input.id); return { success: true };
  }),
});

// Export contains no auth sessions, email addresses, tokens, private incidents or member chat.
const backupSchema = z.object({ kind: z.literal("rezk_safe_settings_v1"), settings: z.object({ pointsPerActivity: z.number().int().min(1).max(150), elitePoints: z.number().int().positive(), subLeaderPoints: z.number().int().positive(), leadershipPoints: z.number().int().positive(), attendanceTargetMinutes: z.number().int().min(15).max(10080), examPassingPercent: z.number().int().min(1).max(100), kickChannelSlug: z.string().regex(/^[a-zA-Z0-9_-]{2,80}$/) }), articles: z.array(z.object({ title: text(3, 160), body: text(10, 15000), published: z.boolean() })).max(100) }).refine(v => v.settings.elitePoints < v.settings.subLeaderPoints && v.settings.subLeaderPoints < v.settings.leadershipPoints);
export type SafeBackup = z.infer<typeof backupSchema>;
export async function restoreSafeBackup(data: SafeBackup, actorId: number) {
  const db = await requireDb();
  // Restore intentionally leaves prior articles intact, adding only new titles.
  await getPortalSettings();
  await db.update(portalSettings).set(data.settings).where(eq(portalSettings.id, 1));
  const existing = await db.select({ title: knowledgeArticles.title }).from(knowledgeArticles).limit(200);
  const known = new Set(existing.map(x => x.title));
  for (const article of data.articles) if (!known.has(article.title)) {
    await db.insert(knowledgeArticles).values({ ...article, createdBy: actorId }); known.add(article.title);
  }
  await audit(actorId, "backup.restore", "backup", undefined, `${data.articles.length} provided articles; safe settings only`);
}
export const backupRouter = router({
  export: adminProcedure.query(async () => {
    const db = await requireDb(); const settings = await getPortalSettings();
    const articles = await db.select({ title: knowledgeArticles.title, body: knowledgeArticles.body, published: knowledgeArticles.published }).from(knowledgeArticles).limit(100);
    const { pointsPerActivity, elitePoints, subLeaderPoints, leadershipPoints, attendanceTargetMinutes, examPassingPercent, kickChannelSlug } = settings;
    return { kind: "rezk_safe_settings_v1" as const, settings: { pointsPerActivity, elitePoints, subLeaderPoints, leadershipPoints, attendanceTargetMinutes, examPassingPercent, kickChannelSlug }, articles };
  }),
  requestRestore: adminProcedure.input(backupSchema).mutation(async ({ ctx, input }) => {
    const db = await requireDb(); await db.insert(sensitiveApprovals).values({ action: "restore_config", payload: JSON.stringify(input), requestedBy: ctx.user.id });
    await audit(ctx.user.id, "backup.restore.request", "approval"); return { success: true };
  }),
});

export const approvalsRouter = router({
  list: adminProcedure.query(async () => (await requireDb()).select({ id: sensitiveApprovals.id, action: sensitiveApprovals.action, status: sensitiveApprovals.status, requestedBy: sensitiveApprovals.requestedBy, approvedBy: sensitiveApprovals.approvedBy, createdAt: sensitiveApprovals.createdAt, resolvedAt: sensitiveApprovals.resolvedAt }).from(sensitiveApprovals).orderBy(desc(sensitiveApprovals.createdAt)).limit(100)),
  decide: adminProcedure.input(z.object({ id, approve: z.boolean() })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    const [record] = await db.select().from(sensitiveApprovals).where(eq(sensitiveApprovals.id, input.id));
    if (!record || record.status !== "pending") throw new TRPCError({ code: "CONFLICT", message: "Request already resolved." });
    if (record.requestedBy === ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "A second administrator must approve." });
    if (!input.approve) {
      await db.update(sensitiveApprovals).set({ status: "rejected", approvedBy: ctx.user.id, resolvedAt: new Date() }).where(and(eq(sensitiveApprovals.id, record.id), eq(sensitiveApprovals.status, "pending")));
      await audit(ctx.user.id, "approval.reject", "approval", input.id); return { success: true };
    }
    const claimed = await db.update(sensitiveApprovals).set({ status: "executing", approvedBy: ctx.user.id }).where(and(eq(sensitiveApprovals.id, record.id), eq(sensitiveApprovals.status, "pending"))).returning({ id: sensitiveApprovals.id });
    if (claimed.length !== 1) throw new TRPCError({ code: "CONFLICT", message: "Already being handled." });
    try {
      if (record.action === "restore_config") await restoreSafeBackup(backupSchema.parse(JSON.parse(record.payload)), ctx.user.id);
      else if (record.action === "delete_adopted_voice") {
        const { channelId } = z.object({ channelId: z.string().regex(/^\d{17,20}$/) }).parse(JSON.parse(record.payload));
        const [room] = await db.select().from(managedVoiceRooms).where(and(eq(managedVoiceRooms.channelId, channelId), isNull(managedVoiceRooms.deletedAt)));
        if (!room || room.source !== "adopted") throw new Error("Adopted voice room not found or changed.");
        const actual = await discordApi<{ id: string; type: number; guild_id?: string }>(`/channels/${channelId}`);
        if (actual.type !== 2 || actual.guild_id !== room.guildId) throw new Error("Discord channel identity mismatch.");
        await discordApi(`/channels/${channelId}`, { method: "DELETE" });
        await db.update(managedVoiceRooms).set({ deletedAt: new Date(), deletedBy: ctx.user.id }).where(eq(managedVoiceRooms.id, room.id));
      } else if (record.action === "rank_save_high") {
        const payload = z.object({
          id: id.optional(), name: text(2, 80), description: z.string().max(500).nullable(),
          color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
          permissions: z.array(z.enum(PERMISSION_IDS)),
          expectedPreviousPermissions: z.string().nullable(),
        }).parse(JSON.parse(record.payload));
        const previous = payload.id ? await rankDb.getRankById(payload.id) : null;
        if (payload.id && (!previous || previous.permissions !== payload.expectedPreviousPermissions)) {
          throw new Error("Rank changed since approval was requested. Submit a fresh request.");
        }
        const { expectedPreviousPermissions, ...newValue } = payload;
        const saved = await rankDb.saveRank(newValue);
        if (!saved) throw new Error("Rank could not be saved.");
        await audit(ctx.user.id, "rank.approved.save", "rank", saved.id);
      } else if (record.action === "rank_assign_high" || record.action === "rank_unassign_high") {
        const payload = z.object({ userId: id, rankId: id, expectedPermissions: z.string() }).parse(JSON.parse(record.payload));
        const [targetUser, targetRank] = await Promise.all([
          rankDb.getUserById(payload.userId), rankDb.getRankById(payload.rankId),
        ]);
        if (!targetUser || targetUser.role === "admin" || targetUser.status !== "approved") throw new Error("Target user is unavailable.");
        if (!targetRank || targetRank.permissions !== payload.expectedPermissions) throw new Error("Rank changed since request; submit again.");
        if (record.action === "rank_assign_high") {
          await rankDb.assignRank(payload.userId, payload.rankId);
          await notify(payload.userId, "rank", "رتبة جديدة", `تم اعتماد تعيين رتبة ${targetRank.name} لحسابك.`);
        } else {
          await rankDb.removeRank(payload.userId, payload.rankId);
          await notify(payload.userId, "rank", "تغيير الرتبة", `تم اعتماد إزالة رتبة ${targetRank.name} من حسابك.`);
        }
        await audit(ctx.user.id, `rank.approved.${record.action}`, "user", payload.userId, targetRank.name);
      } else throw new Error("Unsupported sensitive action.");
      await db.update(sensitiveApprovals).set({ status: "completed", resolvedAt: new Date() }).where(eq(sensitiveApprovals.id, input.id));
      await audit(ctx.user.id, "approval.execute", "approval", input.id, record.action);
      return { success: true };
    } catch (e) {
      await db.update(sensitiveApprovals).set({ status: "failed", resolvedAt: new Date() }).where(eq(sensitiveApprovals.id, input.id));
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: e instanceof Error ? e.message : "Operation failed" });
    }
  }),
});
