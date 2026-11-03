import { and, asc, eq, sql, isNotNull } from "drizzle-orm";
import { getPostgresDb } from "./db-driver";
import { InsertUser, attendanceSessions, discordSettings, ranks, streamState, userRanks, users } from "../drizzle/schema";
import { ENV } from "./_core/env";

export async function getDb() {
  return getPostgresDb();
}

function requireDatabase(db: Awaited<ReturnType<typeof getDb>>) {
  if (!db) throw new Error("Database is not available");
  return db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = requireDatabase(await getDb());
  const values: InsertUser = { openId: user.openId };
  const updateSet: Partial<InsertUser> = {};
  const textFields = ["name", "email", "loginMethod"] as const;
  for (const field of textFields) {
    if (user[field] !== undefined) {
      values[field] = user[field] ?? null;
      updateSet[field] = user[field] ?? null;
    }
  }
  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }
  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (!Object.keys(updateSet).length) updateSet.lastSignedIn = new Date();
  await db.insert(users).values(values).onConflictDoUpdate({ target: users.openId, set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = requireDatabase(await getDb());
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0] ?? null;
}

export async function getUserByEmail(email: string) {
  const db = requireDatabase(await getDb());
  const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return result[0] ?? null;
}

export async function getUserById(id: number) {
  const db = requireDatabase(await getDb());
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result[0] ?? null;
}

export async function createUser(input: InsertUser) {
  const db = requireDatabase(await getDb());
  await db.insert(users).values(input);
  return getUserByOpenId(input.openId);
}

export async function updateUser(id: number, patch: Partial<InsertUser>) {
  const db = requireDatabase(await getDb());
  await db.update(users).set(patch).where(eq(users.id, id));
  return getUserById(id);
}

export async function listUsersWithRanks() {
  const db = requireDatabase(await getDb());
  const userRows = await db.select({
    id: users.id,
    name: users.name,
    email: users.email,
    role: users.role,
    team: users.team,
    status: users.status,
    loginMethod: users.loginMethod,
    banReason: users.banReason,
    bannedAt: users.bannedAt,
    createdAt: users.createdAt,
    lastSignedIn: users.lastSignedIn,
  }).from(users).orderBy(asc(users.createdAt));
  const links = await db.select({ userId: userRanks.userId, rankId: ranks.id, rankName: ranks.name })
    .from(userRanks).innerJoin(ranks, eq(userRanks.rankId, ranks.id));
  const byUser = new Map<number, Array<{ id: number; name: string }>>();
  for (const link of links) {
    const existing = byUser.get(link.userId) ?? [];
    existing.push({ id: link.rankId, name: link.rankName });
    byUser.set(link.userId, existing);
  }
  return userRows.map(user => ({ ...user, ranks: byUser.get(user.id) ?? [] }));
}

export async function getAllRanks() {
  const db = requireDatabase(await getDb());
  return db.select().from(ranks).orderBy(asc(ranks.name));
}

export async function getRankById(id: number) {
  const db = requireDatabase(await getDb());
  const result = await db.select().from(ranks).where(eq(ranks.id, id)).limit(1);
  return result[0] ?? null;
}

export async function saveRank(input: { id?: number; name: string; description: string | null; color: string; permissions: string[] }) {
  const db = requireDatabase(await getDb());
  const values = { name: input.name, description: input.description, color: input.color, permissions: JSON.stringify(input.permissions) };
  if (input.id) {
    await db.update(ranks).set(values).where(eq(ranks.id, input.id));
    return getRankById(input.id);
  }
  await db.insert(ranks).values(values);
  const created = await db.select().from(ranks).where(eq(ranks.name, input.name)).limit(1);
  return created[0] ?? null;
}

export async function deleteRank(id: number) {
  const db = requireDatabase(await getDb());
  await db.delete(userRanks).where(eq(userRanks.rankId, id));
  await db.delete(ranks).where(eq(ranks.id, id));
}

export async function getUserRanks(userId: number) {
  const db = requireDatabase(await getDb());
  return db.select({ id: ranks.id, name: ranks.name, color: ranks.color, permissions: ranks.permissions })
    .from(userRanks).innerJoin(ranks, eq(userRanks.rankId, ranks.id)).where(eq(userRanks.userId, userId)).orderBy(asc(ranks.name));
}

export async function assignRank(userId: number, rankId: number) {
  const db = requireDatabase(await getDb());
  await db.insert(userRanks).values({ userId, rankId }).onConflictDoUpdate({ target: [userRanks.userId, userRanks.rankId], set: { assignedAt: new Date() } });
}

export async function removeRank(userId: number, rankId: number) {
  const db = requireDatabase(await getDb());
  await db.delete(userRanks).where(and(eq(userRanks.userId, userId), eq(userRanks.rankId, rankId)));
}

export async function approveUser(id: number) {
  const db = requireDatabase(await getDb());
  await db.update(users).set({ status: "approved" }).where(and(eq(users.id, id), eq(users.status, "pending")));
  return getUserById(id);
}

export async function permanentlyBanUser(id: number, reason: string | null) {
  const db = requireDatabase(await getDb());
  await db.update(users).set({ status: "banned", banReason: reason, bannedAt: new Date(), sessionVersion: sql`${users.sessionVersion} + 1` })
    .where(and(eq(users.id, id), eq(users.role, "user")));
  return getUserById(id);
}

export async function getStreamState() {
  const db = requireDatabase(await getDb());
  await db.insert(streamState).values({ id: 1, isLive: false, badge: "OFFLINE", viewerCount: 0, sessionEpoch: 0 })
    .onConflictDoNothing({ target: streamState.id });
  const result = await db.select().from(streamState).where(eq(streamState.id, 1)).limit(1);
  return result[0];
}

export async function setStreamStatus(input: { isLive: boolean; badge: string; viewerCount: number }) {
  const db = requireDatabase(await getDb());
  const previous = await getStreamState();
  const ended = previous.isLive && !input.isLive;
  const nextState = {
    isLive: input.isLive,
    badge: input.badge.slice(0, 40),
    viewerCount: Math.max(0, Math.floor(input.viewerCount)),
    updatedAt: new Date(),
    sessionEpoch: ended ? sql`${streamState.sessionEpoch} + 1` : previous.sessionEpoch,
  };
  // Keep forced check-out and session revocation in one atomic transaction.
  await db.transaction(async tx => {
    await tx.update(streamState).set(nextState).where(eq(streamState.id, 1));
    if (ended) {
      await tx.update(attendanceSessions).set({
        endedAt: new Date(), activeUserId: null, endReason: "stream_end",
        durationSeconds: sql`LEAST(GREATEST(EXTRACT(EPOCH FROM (NOW() - ${attendanceSessions.startedAt})), 0), 43200)`,
      }).where(isNotNull(attendanceSessions.activeUserId));
    }
  });
  return { ...input, sessionEpoch: previous.sessionEpoch + (ended ? 1 : 0), ended };
}

export async function getDiscordSettings() {
  const db = requireDatabase(await getDb());
  const result = await db.select().from(discordSettings).where(eq(discordSettings.id, 1)).limit(1);
  return result[0] ?? null;
}

export async function saveDiscordSettings(channelId: string, encryptedToken: string) {
  const db = requireDatabase(await getDb());
  await db.insert(discordSettings).values({ id: 1, channelId, encryptedToken, connected: true, lastError: null, checkedAt: new Date() })
    .onConflictDoUpdate({ target: discordSettings.id, set: { channelId, encryptedToken, connected: true, lastError: null, checkedAt: new Date() } });
}

export async function updateDiscordHealth(connected: boolean, error: string | null) {
  const db = requireDatabase(await getDb());
  await db.update(discordSettings).set({ connected, lastError: error, checkedAt: new Date() }).where(eq(discordSettings.id, 1));
}
