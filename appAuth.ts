import { randomBytes } from "node:crypto";
import type { Express, Request, Response } from "express";
import { parse as parseCookieHeader } from "cookie";
import { SignJWT, jwtVerify } from "jose";
import { createClient } from "@supabase/supabase-js";
import * as db from "../db";
import { effectivePermissions, type PermissionId } from "../permissions";
import { loginSessions, type User } from "../../drizzle/schema";
import { and, eq } from "drizzle-orm";

export const APP_SESSION_COOKIE = "kickmod_session";
const SESSION_COOKIE = APP_SESSION_COOKIE;
const SESSION_MS = 60 * 60 * 1000; // short-lived portal cookie; Supabase refresh is independent
const INITIAL_ADMIN_EMAIL = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase() || "";
const DEV_PUBLIC_ORIGIN = "http://localhost:3000";

export type SafeUser = {
  id: number;
  email: string | null;
  name: string | null;
  role: "user" | "admin";
  status: "pending" | "approved" | "banned";
  loginMethod: string | null;
  createdAt: Date;
  lastSignedIn: Date;
  permissions: PermissionId[];
  ranks: Array<{ id: number; name: string; color: string }>;
  sessionId: string;
  mfaEnabled: boolean;
  mfaRequired: boolean;
};

export type AuthSnapshot = { user: SafeUser | null; sessionRevokedReason: "stream-ended" | "banned" | "session-revoked" | null };

function sessionSecret() {
  const secret = process.env.APP_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("APP_SESSION_SECRET must be a random value of at least 32 characters");
  return new TextEncoder().encode(secret);
}

export function publicOrigin() {
  // Preview deployments may use a different hostname from the production alias.
  if (process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  const fallback = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : DEV_PUBLIC_ORIGIN;
  return (process.env.PUBLIC_APP_ORIGIN || fallback).replace(/\/$/, "");
}

function cookieOptions() {
  // Derive from the configured public origin, never the internal proxy hop or NODE_ENV.
  const secure = publicOrigin().startsWith("https://");
  return { httpOnly: true, secure, sameSite: "lax" as const, path: "/" };
}

function isTrustedOrigin(value: string | undefined) {
  if (!value) return false;
  try {
    const origin = new URL(value).origin;
    return origin === publicOrigin() || (process.env.NODE_ENV !== "production" && (origin === "http://localhost:3000" || origin === "http://127.0.0.1:3000"));
  } catch {
    return false;
  }
}

export function guardSameOriginMutation(req: Request, res: Response, next: (error?: unknown) => void) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (!isTrustedOrigin(req.get("origin"))) {
    setNoStore(res);
    return res.status(403).json({ error: "cross_origin_request", message: "This request must come from the sign-in site." });
  }
  return next();
}

function setNoStore(res: Response) {
  res.setHeader("Cache-Control", "no-store, private");
}

function cookieValue(req: Request, key: string) {
  return parseCookieHeader(req.headers.cookie ?? "")[key];
}

function clearSession(res: Response) {
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions(), maxAge: 0 });
}

export function clearAppSession(res: Response) {
  clearSession(res);
}

export async function issueSession(res: Response, user: User, userAgent?: string, mfaVerified = false) {
  const secret = sessionSecret();
  const state = await db.getStreamState();
  const sid = randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_MS);
  const database = await db.getDb();
  if (!database) throw new Error("Database unavailable");
  await database.insert(loginSessions).values({ id: sid, userId: user.id, userAgent: userAgent?.slice(0, 300) ?? null, expiresAt });
  const token = await new SignJWT({ sessionVersion: user.sessionVersion, sessionEpoch: state.sessionEpoch, sid, mfa: mfaVerified })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(secret);
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(), maxAge: SESSION_MS });
}

async function toSafeUser(user: User, sid: string, mfaVerified: boolean): Promise<SafeUser> {
  const [permissions, ranks] = await Promise.all([
    effectivePermissions({ id: user.id, role: user.role }),
    db.getUserRanks(user.id),
  ]);
  return {
    id: user.id,
    sessionId: sid,
    mfaEnabled: user.totpEnabled,
    mfaRequired: user.role === "admin" && user.totpEnabled && !mfaVerified,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    loginMethod: user.loginMethod,
    createdAt: user.createdAt,
    lastSignedIn: user.lastSignedIn,
    permissions,
    ranks: ranks.map(rank => ({ id: rank.id, name: rank.name, color: rank.color })),
  };
}

export async function readAuthSnapshot(req: Request, res: Response): Promise<AuthSnapshot> {
  const token = cookieValue(req, SESSION_COOKIE);
  if (!token) return { user: null, sessionRevokedReason: null };
  try {
    const { payload } = await jwtVerify(token, sessionSecret(), { algorithms: ["HS256"] });
    const userId = Number(payload.sub);
    if (!Number.isInteger(userId) || userId <= 0) throw new Error("Invalid subject");
    const sid = typeof payload.sid === "string" ? payload.sid : "";
    if (!/^[0-9a-f]{32}$/.test(sid)) throw new Error("Missing session identifier");
    const database = await db.getDb();
    if (!database) throw new Error("Database unavailable");
    const [user, stream, sessions] = await Promise.all([db.getUserById(userId), db.getStreamState(), database.select().from(loginSessions).where(and(eq(loginSessions.id, sid), eq(loginSessions.userId, userId)))]);
    if (sessions.length !== 1 || sessions[0].revokedAt) {
      clearSession(res);
      return { user: null, sessionRevokedReason: "session-revoked" };
    }
    if (sessions[0].expiresAt < new Date()) throw new Error("Expired session");
    if (!user) {
      clearSession(res);
      return { user: null, sessionRevokedReason: null };
    }
    if (user.status === "banned") {
      clearSession(res);
      return { user: null, sessionRevokedReason: "banned" };
    }
    if (Number(payload.sessionVersion) !== user.sessionVersion) {
      clearSession(res);
      return { user: null, sessionRevokedReason: "banned" };
    }
    if (Number(payload.sessionEpoch) !== stream.sessionEpoch) {
      clearSession(res);
      return { user: null, sessionRevokedReason: "stream-ended" };
    }
    return { user: await toSafeUser(user, sid, payload.mfa === true), sessionRevokedReason: null };
  } catch {
    clearSession(res);
    return { user: null, sessionRevokedReason: null };
  }
}

/** Supabase Auth is the ONLY identity provider.  Do not trust a posted email/uid. */
function supabaseVerifier() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key || !url.startsWith("https://")) throw new Error("Supabase Auth is not configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

async function upsertVerifiedSupabaseIdentity(identity: { id: string; email: string; name: string | null; provider: string }) {
  const openId = `supabase:${identity.id}`;
  const email = identity.email.trim().toLowerCase();
  const isInitialAdmin = Boolean(INITIAL_ADMIN_EMAIL) && email === INITIAL_ADMIN_EMAIL;
  // Verified email is owned by this Supabase Auth account. This permits a transition
  // from old accounts while preserving bans and existing member ranks.
  const existing = await db.getUserByOpenId(openId) || await db.getUserByEmail(email);
  if (existing?.openId.startsWith("supabase:") && existing.openId !== openId) {
    throw new Error("This verified email is already linked to another Supabase identity");
  }
  if (existing) {
    if (existing.status === "banned") return existing;
    const updated = await db.updateUser(existing.id, {
      openId, email, name: identity.name || existing.name,
      emailVerified: true, passwordHash: null, loginMethod: identity.provider,
      lastSignedIn: new Date(),
      ...(isInitialAdmin && existing.role !== "admin" ? {
        role: "admin" as const, status: "approved" as const,
        sessionVersion: existing.sessionVersion + 1,
      } : {}),
    });
    if (!updated) throw new Error("Could not update member account");
    return updated;
  }
  const created = await db.createUser({
    openId, email, name: identity.name, emailVerified: true,
    loginMethod: identity.provider, passwordHash: null,
    role: isInitialAdmin ? "admin" : "user", status: isInitialAdmin ? "approved" : "pending",
  });
  if (!created) throw new Error("Could not create member account");
  return created;
}

export function registerAppAuthRoutes(app: Express) {
  app.post("/api/auth/supabase/session", async (req: Request, res: Response) => {
    setNoStore(res);
    const match = /^Bearer (\S{30,})$/i.exec(req.get("authorization") ?? "");
    if (!match) return res.status(401).json({ message: "Missing Supabase access token" });
    try {
      // getUser calls Supabase Auth to authenticate the JWT instead of trusting client claims.
      const { data, error } = await supabaseVerifier().auth.getUser(match[1]);
      if (error || !data.user || !data.user.email || !data.user.email_confirmed_at) {
        return res.status(401).json({ message: "A confirmed Supabase email is required" });
      }
      const identity = data.user;
      const member = await upsertVerifiedSupabaseIdentity({
        id: identity.id,
        email: identity.email,
        name: typeof identity.user_metadata?.name === "string" ? identity.user_metadata.name.slice(0, 120) : null,
        provider: typeof identity.app_metadata?.provider === "string" ? identity.app_metadata.provider : "email",
      });
      if (member.status === "banned") return res.status(403).json({ message: "This account is banned" });
      await issueSession(res, member, req.get("user-agent"));
      return res.json({ success: true, status: member.status });
    } catch (error) {
      console.error("[Supabase Auth] exchange failed", error instanceof Error ? error.message : "unknown");
      return res.status(503).json({ message: "Sign-in service unavailable. Check Supabase settings." });
    }
  });

  app.post("/api/auth/logout", async (req: Request, res: Response) => {
    setNoStore(res);
    try {
      const token = cookieValue(req, SESSION_COOKIE);
      if (token) {
        const { payload } = await jwtVerify(token, sessionSecret(), { algorithms: ["HS256"] });
        if (typeof payload.sid === "string") {
          const database = await db.getDb();
          if (database) await database.update(loginSessions).set({ revokedAt: new Date() }).where(eq(loginSessions.id, payload.sid));
        }
      }
    } catch { /* Logout clears the cookie even if the old session has expired. */ }
    clearSession(res);
    res.json({ success: true });
  });
}
