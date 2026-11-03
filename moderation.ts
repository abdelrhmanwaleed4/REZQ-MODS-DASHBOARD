/** Staff operations: server-owned records, explicit access checks and auditable actors. */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, desc, eq, gte, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";
import { absenceRequests, attendanceSessions, disciplinaryActions, pointEvents, users } from "../drizzle/schema";
import { getDb, getUserById, getStreamState } from "./db";
import { audit, notify, getPortalSettings } from "./portalFeatures";
import { tryDiscordAlert } from "./discord";
import { adminProcedure, permissionProcedure, protectedProcedure, router } from "./_core/trpc";
import type { PermissionId } from "./permissions";

function database(db: Awaited<ReturnType<typeof getDb>>) {
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database is unavailable." });
  return db;
}

type StaffActor = { id: number; role: "admin" | "user"; permissions: PermissionId[] };
const can = (actor: StaffActor, permission: PermissionId) => actor.role === "admin" || actor.permissions.includes(permission);

async function approvedMember(id: number) {
  const member = await getUserById(id);
  if (!member || member.role === "admin" || member.status !== "approved") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Select an approved non-admin member." });
  }
  return member;
}

export function promotionForPoints(total: number) {
  if (total >= 800) return { title: "قيادة عليا", next: null, remaining: 0 };
  if (total >= 400) return { title: "Sub-Leader", next: 800, remaining: 800 - total };
  if (total >= 150) return { title: "Elite Staff", next: 400, remaining: 400 - total };
  return { title: "Member", next: 150, remaining: Math.max(0, 150 - total) };
}

export function promotionForPointsWithThresholds(total: number, settings: { elitePoints: number; subLeaderPoints: number; leadershipPoints: number }) {
  if (total >= settings.leadershipPoints) return { title: "قيادة عليا", next: null, remaining: 0 };
  if (total >= settings.subLeaderPoints) return { title: "Sub-Leader", next: settings.leadershipPoints, remaining: settings.leadershipPoints - total };
  if (total >= settings.elitePoints) return { title: "Elite Staff", next: settings.subLeaderPoints, remaining: settings.subLeaderPoints - total };
  return { title: "Member", next: settings.elitePoints, remaining: Math.max(0, settings.elitePoints - total) };
}

export function validatedDateRange(startDate: string, endDate: string, kind: "leave" | "excuse") {
  const pattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!pattern.test(startDate) || !pattern.test(endDate)) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid date format." });
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || new Date(start).toISOString().slice(0, 10) !== startDate || new Date(end).toISOString().slice(0, 10) !== endDate) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid calendar date." });
  }
  const days = Math.round((end - start) / 86_400_000) + 1;
  if (days < 1 || days > 30 || (kind === "excuse" && days !== 1)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Excuses are one day; leave requests can be 1–30 days." });
  }
  return days;
}

/** Qatar calendar day/week/month, converted to timestamp boundaries stored in UTC. */
export function reportingWindow(period: "week" | "month", date = new Date(), offset = 0) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Qatar", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const year = Number(parts.find(p => p.type === "year")?.value);
  const month = Number(parts.find(p => p.type === "month")?.value);
  const day = Number(parts.find(p => p.type === "day")?.value);
  const currentMidnight = period === "week"
    ? Date.UTC(year, month - 1, day - offset * 7)
    : Date.UTC(year, month - 1 - offset, 1);
  let startMidnight: number;
  let endMidnight: number;
  if (period === "week") {
    const weekday = new Date(currentMidnight).getUTCDay();
    startMidnight = currentMidnight - ((weekday + 6) % 7) * 86_400_000;
    endMidnight = startMidnight + 7 * 86_400_000;
  } else {
    startMidnight = currentMidnight;
    endMidnight = Date.UTC(new Date(startMidnight).getUTCFullYear(), new Date(startMidnight).getUTCMonth() + 1, 1);
  }
  const qatarOffsetMs = 3 * 60 * 60 * 1000; // Asia/Qatar: fixed UTC+03:00
  return {
    start: new Date(startMidnight - qatarOffsetMs),
    end: new Date(endMidnight - qatarOffsetMs),
    label: `${new Date(startMidnight).toISOString().slice(0, 10)} / ${new Date(endMidnight - 86_400_000).toISOString().slice(0, 10)}`,
  };
}

const memberDirectory = async () => {
  const db = database(await getDb());
  return db.select({ id: users.id, name: users.name, team: users.team }).from(users)
    .where(and(eq(users.status, "approved"), eq(users.role, "user"))).orderBy(users.name);
};

export const staffRouter = router({
  members: protectedProcedure.query(async ({ ctx }) => {
    if (!["manageAttendance", "managePoints", "manageLeaves", "manageDiscipline", "viewReports", "manageUsers"].some(id => can(ctx.user, id as PermissionId))) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }
    return memberDirectory();
  }),
  team: adminProcedure.input(z.object({ userId: z.number().int().positive(), team: z.enum(["main", "reserve"]) })).mutation(async ({ input }) => {
    await approvedMember(input.userId);
    const db = database(await getDb());
    await db.update(users).set({ team: input.team }).where(eq(users.id, input.userId));
    return { success: true };
  }),
});

export const attendanceRouter = router({
  status: protectedProcedure.query(async ({ ctx }) => {
    const db = database(await getDb());
    const rows = await db.select().from(attendanceSessions).where(eq(attendanceSessions.activeUserId, ctx.user.id)).limit(1);
    return rows[0] ?? null;
  }),
  checkIn: protectedProcedure.mutation(async ({ ctx }) => {
    const db = database(await getDb());
    const already = await db.select({ id: attendanceSessions.id }).from(attendanceSessions).where(eq(attendanceSessions.activeUserId, ctx.user.id)).limit(1);
    if (already.length) throw new TRPCError({ code: "CONFLICT", message: "You are already checked in." });
    const stream = await getStreamState();
    if (!stream.isLive) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Check-in is only available during a LIVE stream." });
    try {
      await db.insert(attendanceSessions).values({ userId: ctx.user.id, activeUserId: ctx.user.id, lastPulseAt: new Date() });
    } catch (error) {
      if (error instanceof Error && /duplicate/i.test(error.message)) throw new TRPCError({ code: "CONFLICT", message: "You are already checked in." });
      throw error;
    }
    await audit(ctx.user.id, "attendance.checkin", "user", ctx.user.id);
    return { success: true };
  }),
  pulse: protectedProcedure.mutation(async ({ ctx }) => {
    const state = await getStreamState();
    if (!state.isLive) return { success: false, creditedSeconds: 0 };
    const db = database(await getDb());
    const [active] = await db.select().from(attendanceSessions).where(eq(attendanceSessions.activeUserId, ctx.user.id));
    if (!active) return { success: false, creditedSeconds: 0 };
    const now = new Date();
    const last = active.lastPulseAt || now;
    const elapsed = Math.max(0, Math.floor((now.getTime() - last.getTime()) / 1000));
    const credited = Math.min(45, elapsed);
    // A compare-and-set protects simultaneous requests from double counting.
    await db.update(attendanceSessions).set({ lastPulseAt: now, verifiedSeconds: sql`${attendanceSessions.verifiedSeconds} + ${credited}` }).where(and(eq(attendanceSessions.id, active.id), eq(attendanceSessions.activeUserId, ctx.user.id), active.lastPulseAt ? eq(attendanceSessions.lastPulseAt, active.lastPulseAt) : isNull(attendanceSessions.lastPulseAt)));
    return { success: true, creditedSeconds: credited };
  }),
  checkOut: protectedProcedure.mutation(async ({ ctx }) => {
    const db = database(await getDb());
    const active = await db.select().from(attendanceSessions).where(eq(attendanceSessions.activeUserId, ctx.user.id)).limit(1);
    if (!active.length) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No active check-in." });
    const now = new Date();
    const seconds = Math.min(43_200, Math.max(0, Math.floor((now.getTime() - active[0].startedAt.getTime()) / 1000)));
    // durationSeconds is wall-clock time; verifiedSeconds is foreground website presence only.
    // Another request may have closed the session; never overwrite its recorded duration.
    await db.update(attendanceSessions).set({ endedAt: now, activeUserId: null, durationSeconds: seconds, endReason: "manual" })
      .where(eq(attendanceSessions.activeUserId, ctx.user.id));
    await audit(ctx.user.id, "attendance.checkout", "user", ctx.user.id, `${seconds} wall seconds`);
    return { success: true, durationSeconds: seconds };
  }),
  history: protectedProcedure.query(async ({ ctx }) => {
    const db = database(await getDb());
    const allowed = can(ctx.user, "manageAttendance") || can(ctx.user, "viewReports");
    const rows = await db.select().from(attendanceSessions)
      .where(allowed ? undefined : eq(attendanceSessions.userId, ctx.user.id))
      .orderBy(desc(attendanceSessions.startedAt)).limit(250);
    return { rows, canViewAll: allowed };
  }),
});

export const pointsRouter = router({
  summary: protectedProcedure.query(async ({ ctx }) => {
    const db = database(await getDb());
    const allowed = can(ctx.user, "managePoints") || can(ctx.user, "viewReports");
    const config = await getPortalSettings();
    const totals = await db.select({ userId: pointEvents.userId, total: sql<number>`COALESCE(SUM(${pointEvents.delta}), 0)` })
      .from(pointEvents).where(allowed ? undefined : eq(pointEvents.userId, ctx.user.id)).groupBy(pointEvents.userId);
    const history = await db.select().from(pointEvents).where(allowed ? undefined : eq(pointEvents.userId, ctx.user.id))
      .orderBy(desc(pointEvents.createdAt)).limit(100);
    return { totals: totals.map(row => ({ ...row, total: Number(row.total), promotion: promotionForPointsWithThresholds(Number(row.total), config) })), history, canManage: can(ctx.user, "managePoints") };
  }),
  award: permissionProcedure("managePoints").input(z.object({
    userId: z.number().int().positive(), delta: z.number().int().refine(n => n !== 0 && Math.abs(n) <= 150, "1–150 points per adjustment"),
    reason: z.string().trim().min(5).max(500),
  })).mutation(async ({ ctx, input }) => {
    if (input.userId === ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "Cannot award points to yourself." });
    await approvedMember(input.userId);
    const db = database(await getDb());
    // Only the administrator can make negative corrections.
    if (input.delta < 0 && ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Only administrators may correct points downward." });
    const config = await getPortalSettings();
    const totals = await db.transaction(async tx => {
      // Serialize ledger changes per member across concurrent requests.
      const [lockedMember] = await tx.select({ id: users.id, status: users.status }).from(users)
        .where(eq(users.id, input.userId)).for("update");
      if (!lockedMember || lockedMember.status !== "approved") throw new TRPCError({ code: "BAD_REQUEST", message: "Member is no longer approved." });
      const [balance] = await tx.select({ total: sql<number>`COALESCE(SUM(${pointEvents.delta}), 0)` }).from(pointEvents).where(eq(pointEvents.userId, input.userId));
      const before = Number(balance?.total ?? 0);
      const after = before + input.delta;
      if (after < 0) throw new TRPCError({ code: "BAD_REQUEST", message: "The balance cannot become negative." });
      await tx.insert(pointEvents).values({ userId: input.userId, actorId: ctx.user.id, delta: input.delta, reason: input.reason });
      return { before, after };
    });
    await audit(ctx.user.id, "points.award", "user", input.userId, `${input.delta} points: ${input.reason.slice(0, 100)}`);
    await notify(input.userId, "points", "تحديث نقاطك", `تم ${input.delta > 0 ? "إضافة" : "خصم"} ${Math.abs(input.delta)} نقطة: ${input.reason.slice(0, 120)}`);
    const prevStage = promotionForPointsWithThresholds(totals.before, config).title;
    const nextStage = promotionForPointsWithThresholds(totals.after, config).title;
    if (input.delta > 0 && prevStage !== nextStage) {
      await notify(input.userId, "promotion", "مستوى ترقية جديد", `وصلت إلى ${nextStage} بالنقاط. الترقية الفعلية تتطلب موافقة الإدارة.`);
      await tryDiscordAlert("استحقاق ترقية", `عضو الفريق #${input.userId} وصل لمستوى ${nextStage} (${totals.after} نقطة).`);
    }
    return { success: true, promotionEligible: prevStage !== nextStage && input.delta > 0 ? nextStage : null };
  }),
});

export const absencesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = database(await getDb());
    const isManager = can(ctx.user, "manageLeaves");
    const rows = await db.select().from(absenceRequests)
      .where(isManager ? undefined : eq(absenceRequests.userId, ctx.user.id))
      .orderBy(desc(absenceRequests.createdAt)).limit(200);
    return { rows, canManage: isManager };
  }),
  request: protectedProcedure.input(z.object({
    kind: z.enum(["leave", "excuse"]), startDate: z.string(), endDate: z.string(), reason: z.string().trim().min(10).max(1000),
  })).mutation(async ({ ctx, input }) => {
    validatedDateRange(input.startDate, input.endDate, input.kind);
    const db = database(await getDb());
    await db.insert(absenceRequests).values({ userId: ctx.user.id, ...input });
    await audit(ctx.user.id, "absence.request", "user", ctx.user.id, input.kind);
    const admins = await db.select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), eq(users.status, "approved"))).limit(30);
    for (const admin of admins) if (admin.id !== ctx.user.id) {
      await notify(admin.id, "leave", "طلب إجازة أو عذر جديد", `قدم عضو الفريق #${ctx.user.id} طلب ${input.kind === "leave" ? "إجازة" : "عذر"} يحتاج المراجعة.`);
    }
    return { success: true };
  }),
  review: permissionProcedure("manageLeaves").input(z.object({ id: z.number().int().positive(), status: z.enum(["approved", "rejected"]), note: z.string().trim().max(500).optional() })).mutation(async ({ ctx, input }) => {
    const db = database(await getDb());
    const [request] = await db.select().from(absenceRequests).where(eq(absenceRequests.id, input.id)).limit(1);
    if (!request) throw new TRPCError({ code: "NOT_FOUND" });
    if (request.userId === ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "You cannot review your own request." });
    const requester = await getUserById(request.userId);
    if (requester?.role === "admin" && ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Cannot review an administrator's request." });
    if (request.status !== "pending") throw new TRPCError({ code: "CONFLICT", message: "Already reviewed." });
    await db.update(absenceRequests).set({ status: input.status, reviewedBy: ctx.user.id, reviewedAt: new Date(), reviewedNote: input.note || null })
      .where(and(eq(absenceRequests.id, input.id), eq(absenceRequests.status, "pending")));
    await notify(request.userId, "leave", "قرار الطلب", `تم ${input.status === "approved" ? "قبول" : "رفض"} طلبك.`);
    await audit(ctx.user.id, "absence.review", "user", request.userId, input.status);
    return { success: true };
  }),
});

export const disciplineRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = database(await getDb());
    const isManager = can(ctx.user, "manageDiscipline");
    const rows = await db.select().from(disciplinaryActions)
      .where(isManager ? undefined : eq(disciplinaryActions.userId, ctx.user.id))
      .orderBy(desc(disciplinaryActions.createdAt)).limit(200);
    return { rows, canManage: isManager };
  }),
  issue: permissionProcedure("manageDiscipline").input(z.object({
    userId: z.number().int().positive(), level: z.enum(["notice", "warning", "strike"]),
    reason: z.string().trim().min(10).max(1000), evidenceUrl: z.union([z.url().refine(url => url.startsWith("https://"), "HTTPS links only"), z.literal("")]).optional(),
  })).mutation(async ({ ctx, input }) => {
    if (ctx.user.id === input.userId) throw new TRPCError({ code: "FORBIDDEN", message: "Cannot issue a warning to yourself." });
    await approvedMember(input.userId);
    const db = database(await getDb());
    await db.insert(disciplinaryActions).values({ userId: input.userId, actorId: ctx.user.id, level: input.level, reason: input.reason, evidenceUrl: input.evidenceUrl || null });
    await notify(input.userId, "discipline", "إجراء إداري", `تم تسجيل ${input.level} في ملفك: ${input.reason.slice(0, 160)}`);
    await audit(ctx.user.id, "discipline.issue", "user", input.userId, input.level);
    await tryDiscordAlert("إجراء إداري", `تم تسجيل ${input.level} لعضو الفريق #${input.userId}`);
    return { success: true };
  }),
  rescind: permissionProcedure("manageDiscipline").input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const db = database(await getDb());
    const [action] = await db.select().from(disciplinaryActions).where(eq(disciplinaryActions.id, input.id)).limit(1);
    if (!action) throw new TRPCError({ code: "NOT_FOUND" });
    if (action.userId === ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
    if (action.rescindedAt) throw new TRPCError({ code: "CONFLICT", message: "Already rescinded." });
    await db.update(disciplinaryActions).set({ rescindedAt: new Date(), rescindedBy: ctx.user.id })
      .where(and(eq(disciplinaryActions.id, input.id), isNull(disciplinaryActions.rescindedAt)));
    await notify(action.userId, "discipline", "إلغاء مخالفة", "تم إلغاء مخالفة من سجلك الإداري.");
    await audit(ctx.user.id, "discipline.rescind", "discipline", input.id);
    return { success: true };
  }),
});

export const reportsRouter = router({
  period: permissionProcedure("viewReports").input(z.object({ period: z.enum(["week", "month"]), offset: z.number().int().min(0).max(12).default(0) })).query(async ({ input }) => {
    const db = database(await getDb());
    const window = reportingWindow(input.period, new Date(), input.offset);
    const [members, attendance, points, discipline, absence] = await Promise.all([
      memberDirectory(),
      db.select().from(attendanceSessions).where(and(isNotNull(attendanceSessions.endedAt), gte(attendanceSessions.endedAt, window.start), lt(attendanceSessions.endedAt, window.end))),
      db.select().from(pointEvents).where(and(gte(pointEvents.createdAt, window.start), lt(pointEvents.createdAt, window.end))),
      db.select().from(disciplinaryActions).where(and(gte(disciplinaryActions.createdAt, window.start), lt(disciplinaryActions.createdAt, window.end))),
      db.select().from(absenceRequests).where(and(eq(absenceRequests.status, "approved"), lte(absenceRequests.startDate, window.label.slice(-10)), gte(absenceRequests.endDate, window.label.slice(0, 10)))),
    ]);
    const entries = members.map(member => {
      const sessions = attendance.filter(row => row.userId === member.id);
      const actions = discipline.filter(row => row.userId === member.id && !row.rescindedAt);
      return {
        ...member,
        attendanceSessions: sessions.length,
        hours: Number((sessions.reduce((sum, row) => sum + row.verifiedSeconds, 0) / 3600).toFixed(2)),
        points: points.filter(row => row.userId === member.id).reduce((sum, row) => sum + row.delta, 0),
        warnings: actions.filter(row => row.level !== "notice").length,
        notices: actions.filter(row => row.level === "notice").length,
        approvedAbsences: absence.filter(row => row.userId === member.id).length,
      };
    });
    return { ...window, period: input.period, entries: entries.sort((a, b) => b.points - a.points || b.hours - a.hours) };
  }),
});
