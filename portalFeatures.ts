import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import {
  academyAttempts, academyQuestions, attendanceSessions, auditEvents, incidentReports,
  loginSessions, pointEvents, portalSettings, userNotifications, users, disciplinaryActions,
} from "../drizzle/schema";
import { getDb } from "./db";
import { adminProcedure, permissionProcedure, protectedProcedure, router } from "./_core/trpc";
import { reportingWindow } from "./moderation";
import type { PermissionId } from "./permissions";

export async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database is not configured." });
  return db;
}

export async function getPortalSettings() {
  const db = await requireDb();
  await db.insert(portalSettings).values({ id: 1 }).onConflictDoNothing({ target: portalSettings.id });
  const [row] = await db.select().from(portalSettings).where(eq(portalSettings.id, 1));
  return row;
}

export async function audit(actorId: number | null, action: string, targetType: string, targetId?: string | number, details?: string) {
  const db = await requireDb();
  await db.insert(auditEvents).values({ actorId, action: action.slice(0, 90), targetType: targetType.slice(0, 40), targetId: targetId === undefined ? null : String(targetId), details: details?.slice(0, 500) ?? null });
}

export async function notify(userId: number, kind: string, title: string, message: string) {
  const db = await requireDb();
  await db.insert(userNotifications).values({ userId, kind, title: title.slice(0, 150), message: message.slice(0, 500) });
}

const may = (actor: { role: string; permissions: PermissionId[] }, permission: PermissionId) => actor.role === "admin" || actor.permissions.includes(permission);
const httpsUrl = z.union([z.literal(""), z.url().refine(s => s.startsWith("https://"), "Only HTTPS evidence URLs are permitted")]);

export const settingsRouter = router({
  get: protectedProcedure.query(async () => {
    const { pointsPerActivity, elitePoints, subLeaderPoints, leadershipPoints, attendanceTargetMinutes, examPassingPercent, kickChannelSlug } = await getPortalSettings();
    return { pointsPerActivity, elitePoints, subLeaderPoints, leadershipPoints, attendanceTargetMinutes, examPassingPercent, kickChannelSlug };
  }),
  admin: adminProcedure.query(getPortalSettings),
  save: adminProcedure.input(z.object({
    pointsPerActivity: z.number().int().min(1).max(150),
    elitePoints: z.number().int().min(1).max(100000),
    subLeaderPoints: z.number().int().min(2).max(100000),
    leadershipPoints: z.number().int().min(3).max(100000),
    attendanceTargetMinutes: z.number().int().min(15).max(10080),
    examPassingPercent: z.number().int().min(1).max(100),
    kickChannelSlug: z.string().trim().regex(/^[a-zA-Z0-9_-]{2,80}$/),
  }).refine(p => p.elitePoints < p.subLeaderPoints && p.subLeaderPoints < p.leadershipPoints, "Promotion thresholds must increase.")).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    await getPortalSettings();
    await db.update(portalSettings).set(input).where(eq(portalSettings.id, 1));
    await audit(ctx.user.id, "settings.update", "portal", "1", "Changed configurable scoring, promotion and channel settings");
    return { success: true };
  }),
});

export const notificationRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const rows = await db.select().from(userNotifications).where(eq(userNotifications.userId, ctx.user.id)).orderBy(desc(userNotifications.createdAt)).limit(80);
    return { rows, unread: rows.filter(r => !r.readAt).length };
  }),
  read: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    await db.update(userNotifications).set({ readAt: new Date() }).where(and(eq(userNotifications.id, input.id), eq(userNotifications.userId, ctx.user.id)));
    return { success: true };
  }),
  readAll: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await requireDb();
    await db.update(userNotifications).set({ readAt: new Date() }).where(eq(userNotifications.userId, ctx.user.id));
    return { success: true };
  }),
});

export const auditRouter = router({
  list: permissionProcedure("viewAudit").query(async () => {
    const db = await requireDb();
    return db.select().from(auditEvents).orderBy(desc(auditEvents.createdAt)).limit(300);
  }),
});

export const incidentsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    return db.select().from(incidentReports)
      .where(may(ctx.user, "manageReports") ? undefined : eq(incidentReports.reporterId, ctx.user.id))
      .orderBy(desc(incidentReports.createdAt)).limit(150);
  }),
  submit: protectedProcedure.input(z.object({ category: z.enum(["conduct", "technical", "appeal", "other"]), description: z.string().trim().min(15).max(2000), evidenceUrl: httpsUrl })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    await db.insert(incidentReports).values({ reporterId: ctx.user.id, category: input.category, description: input.description, evidenceUrl: input.evidenceUrl || null });
    await audit(ctx.user.id, "incident.create", "incident");
    const managers = await db.select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), eq(users.status, "approved"))).limit(20);
    for (const m of managers) if (m.id !== ctx.user.id) await notify(m.id, "incident", "بلاغ جديد", "وصل بلاغ داخلي جديد يحتاج المراجعة.");
    return { success: true };
  }),
  review: permissionProcedure("manageReports").input(z.object({ id: z.number().int().positive(), status: z.enum(["reviewing", "resolved", "rejected"]), response: z.string().trim().max(1000) })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    const [existing] = await db.select().from(incidentReports).where(eq(incidentReports.id, input.id));
    if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
    if (existing.reporterId === ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "Cannot review your own report." });
    if (existing.status === "resolved" || existing.status === "rejected") throw new TRPCError({ code: "CONFLICT", message: "This report has been closed." });
    await db.update(incidentReports).set({ status: input.status, reviewerId: ctx.user.id, response: input.response || null }).where(and(eq(incidentReports.id, input.id), eq(incidentReports.status, existing.status)));
    await notify(existing.reporterId, "incident", "تحديث البلاغ", `تم تغيير حالة بلاغك إلى ${input.status}.`);
    await audit(ctx.user.id, "incident.review", "incident", input.id, input.status);
    return { success: true };
  }),
});

// Correct answers never leave the server in the exam's public query.
const questionInput = z.object({ question: z.string().trim().min(12).max(500), options: z.array(z.string().trim().min(1).max(180)).length(4), correctIndex: z.number().int().min(0).max(3) });
export const academyRouter = router({
  exam: protectedProcedure.query(async () => {
    const db = await requireDb();
    const rows = await db.select({ id: academyQuestions.id, question: academyQuestions.question, optionsJson: academyQuestions.optionsJson })
      .from(academyQuestions).where(eq(academyQuestions.enabled, true)).orderBy(academyQuestions.id).limit(20);
    return rows.map(r => ({ id: r.id, question: r.question, options: JSON.parse(r.optionsJson) as string[] }));
  }),
  questionBank: permissionProcedure("manageAcademy").query(async () => {
    const db = await requireDb();
    return db.select().from(academyQuestions).orderBy(desc(academyQuestions.id)).limit(100);
  }),
  addQuestion: permissionProcedure("manageAcademy").input(questionInput).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    await db.insert(academyQuestions).values({ question: input.question, optionsJson: JSON.stringify(input.options), correctIndex: input.correctIndex, createdBy: ctx.user.id });
    await audit(ctx.user.id, "academy.question.create", "academy");
    return { success: true };
  }),
  toggle: permissionProcedure("manageAcademy").input(z.object({ id: z.number().int().positive(), enabled: z.boolean() })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    await db.update(academyQuestions).set({ enabled: input.enabled }).where(eq(academyQuestions.id, input.id));
    await audit(ctx.user.id, "academy.question.toggle", "academy", input.id);
    return { success: true };
  }),
  take: protectedProcedure.input(z.object({ answers: z.array(z.object({ id: z.number().int().positive(), answer: z.number().int().min(0).max(3) })).min(3).max(20) })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    const questions = await db.select().from(academyQuestions).where(eq(academyQuestions.enabled, true)).orderBy(academyQuestions.id).limit(20);
    if (questions.length < 3 || input.answers.length !== questions.length) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The exam must contain at least 3 active questions and every question must be answered." });
    const selected = new Map(input.answers.map(a => [a.id, a.answer]));
    if (selected.size !== questions.length || questions.some(q => !selected.has(q.id))) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid exam answers." });
    const correct = questions.filter(q => selected.get(q.id) === q.correctIndex).length;
    const config = await getPortalSettings();
    const percent = Math.round(100 * correct / questions.length);
    const passed = percent >= config.examPassingPercent;
    await db.insert(academyAttempts).values({ userId: ctx.user.id, score: correct, total: questions.length, passed });
    await notify(ctx.user.id, "academy", "نتيجة اختبار المود", `درجتك ${percent}%؛ ${passed ? "اجتياز" : "لم تجتز"}.`);
    await audit(ctx.user.id, "academy.attempt", "academy", ctx.user.id, `${percent}%`);
    return { correct, total: questions.length, percent, passed };
  }),
  attempts: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    return db.select().from(academyAttempts).where(may(ctx.user, "manageAcademy") ? undefined : eq(academyAttempts.userId, ctx.user.id)).orderBy(desc(academyAttempts.createdAt)).limit(100);
  }),
});

export function computePerformance(input: { verifiedMinutes: number; points: number; warnings: number; strikes: number; targetMinutes: number; pointTarget: number }) {
  const attendance = Math.min(40, Math.round(40 * input.verifiedMinutes / Math.max(1, input.targetMinutes)));
  const activity = Math.min(35, Math.round(35 * Math.max(0, input.points) / Math.max(1, input.pointTarget)));
  const conduct = Math.max(0, 25 - input.warnings * 8 - input.strikes * 15);
  return { attendance, activity, conduct, total: attendance + activity + conduct };
}

export const performanceRouter = router({
  leaderboard: protectedProcedure.input(z.object({ period: z.enum(["week", "month"]).default("week"), offset: z.number().int().min(0).max(12).default(0) })).query(async ({ ctx, input }) => {
    const db = await requireDb();
    const config = await getPortalSettings();
    const window = reportingWindow(input.period, new Date(), input.offset);
    const [members, sessions, events, actions] = await Promise.all([
      db.select({ id: users.id, name: users.name, team: users.team }).from(users).where(and(eq(users.status, "approved"), eq(users.role, "user"))),
      db.select().from(attendanceSessions).where(and(gte(attendanceSessions.startedAt, window.start), lt(attendanceSessions.startedAt, window.end))),
      db.select().from(pointEvents).where(and(gte(pointEvents.createdAt, window.start), lt(pointEvents.createdAt, window.end))),
      db.select().from(disciplinaryActions).where(and(gte(disciplinaryActions.createdAt, window.start), lt(disciplinaryActions.createdAt, window.end))),
    ]);
    const rows = members.map(u => {
      const verifiedMinutes = Math.floor(sessions.filter(s => s.userId === u.id).reduce((a, b) => a + b.verifiedSeconds, 0) / 60);
      const points = events.filter(e => e.userId === u.id).reduce((a, b) => a + b.delta, 0);
      const penalties = actions.filter(a => a.userId === u.id && !a.rescindedAt);
      const score = computePerformance({ verifiedMinutes, points, warnings: penalties.filter(a => a.level === "warning").length, strikes: penalties.filter(a => a.level === "strike").length, targetMinutes: config.attendanceTargetMinutes, pointTarget: config.elitePoints });
      return { ...u, verifiedMinutes, points, score };
    }).sort((a, b) => b.score.total - a.score.total || b.points - a.points);
    const own = rows.find(r => r.id === ctx.user.id) || null;
    // All approved members may see a rank table but not other people's discipline details.
    return { label: window.label, rows, own, scoring: "حضور موقع موثق جزئيًا + نقاط الإدارة + خصومات الإنذارات؛ لا يثبت نشاط Kick أو Discord." };
  }),
  profile: protectedProcedure.input(z.object({ userId: z.number().int().positive().optional() })).query(async ({ ctx, input }) => {
    const db = await requireDb();
    const target = input.userId ?? ctx.user.id;
    if (target !== ctx.user.id && !may(ctx.user, "viewReports") && !may(ctx.user, "manageUsers")) throw new TRPCError({ code: "FORBIDDEN" });
    const [member] = await db.select({ id: users.id, name: users.name, email: users.email, team: users.team, createdAt: users.createdAt }).from(users).where(eq(users.id, target));
    if (!member) throw new TRPCError({ code: "NOT_FOUND" });
    const [points, sessions, notices, exams] = await Promise.all([
      db.select().from(pointEvents).where(eq(pointEvents.userId, target)).orderBy(desc(pointEvents.createdAt)).limit(100),
      db.select().from(attendanceSessions).where(eq(attendanceSessions.userId, target)).orderBy(desc(attendanceSessions.startedAt)).limit(100),
      db.select().from(disciplinaryActions).where(eq(disciplinaryActions.userId, target)).orderBy(desc(disciplinaryActions.createdAt)).limit(100),
      db.select().from(academyAttempts).where(eq(academyAttempts.userId, target)).orderBy(desc(academyAttempts.createdAt)).limit(20),
    ]);
    return { member, pointTotal: points.reduce((a, p) => a + p.delta, 0), verifiedMinutes: Math.floor(sessions.reduce((a, s) => a + s.verifiedSeconds, 0) / 60), sessions: sessions.length, warnings: notices.filter(n => n.level !== "notice" && !n.rescindedAt).length, exams };
  }),
});

export const sessionRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    return db.select({ id: loginSessions.id, createdAt: loginSessions.createdAt, expiresAt: loginSessions.expiresAt, revokedAt: loginSessions.revokedAt, userAgent: loginSessions.userAgent })
      .from(loginSessions).where(eq(loginSessions.userId, ctx.user.id)).orderBy(desc(loginSessions.createdAt)).limit(30);
  }),
  revoke: protectedProcedure.input(z.object({ id: z.string().regex(/^[0-9a-f]{32}$/) })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    await db.update(loginSessions).set({ revokedAt: new Date() }).where(and(eq(loginSessions.id, input.id), eq(loginSessions.userId, ctx.user.id)));
    await audit(ctx.user.id, "session.revoke", "session", input.id.slice(0, 8));
    return { success: true };
  }),
  revokeOther: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await requireDb();
    const rows = await db.select().from(loginSessions).where(eq(loginSessions.userId, ctx.user.id));
    await Promise.all(rows.filter(s => s.id !== ctx.user.sessionId).map(s => db.update(loginSessions).set({ revokedAt: new Date() }).where(eq(loginSessions.id, s.id))));
    return { success: true };
  }),
});
