/** OAuth identity linking. Never accept user-entered IDs as proof of account ownership. */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { Express, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { linkedAccounts } from "../drizzle/schema";
import { publicOrigin, readAuthSnapshot } from "./_core/appAuth";
import { adminProcedure, protectedProcedure, router } from "./_core/trpc";
import { audit, requireDb } from "./portalFeatures";

const COOKIE = "rezk_link_oauth";
type Provider = "discord" | "kick";
type OAuthToken = { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };
const safeProvider = (v: string): v is Provider => v === "discord" || v === "kick";

function linkKey() {
  const raw = process.env.LINK_TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("LINK_TOKEN_ENCRYPTION_KEY must contain 32 random base64 bytes.");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("LINK_TOKEN_ENCRYPTION_KEY must decode to 32 bytes.");
  return key;
}
export function encryptLinkSecret(value: string) {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", linkKey(), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${data.toString("base64url")}`;
}
export function decryptLinkSecret(value: string) {
  const [iv, tag, bytes, rest] = value.split(".");
  if (!iv || !tag || !bytes || rest) throw new Error("Invalid secret payload.");
  const decipher = createDecipheriv("aes-256-gcm", linkKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(bytes, "base64url")), decipher.final()]).toString("utf8");
}
function callback(provider: Provider) { return `${publicOrigin()}/api/links/${provider}/callback`; }
function config(provider: Provider) {
  const clientId = provider === "discord" ? process.env.DISCORD_CLIENT_ID : process.env.KICK_CLIENT_ID;
  const secret = provider === "discord" ? process.env.DISCORD_CLIENT_SECRET : process.env.KICK_CLIENT_SECRET;
  if (!clientId || !secret) throw new Error(`${provider} OAuth client ID/secret is not configured.`);
  return { clientId, secret };
}
const cookieOptions = { httpOnly: true, secure: publicOrigin().startsWith("https://"), sameSite: "lax" as const, path: "/api/links", maxAge: 10 * 60 * 1000 };
function readCookie(req: Request, key: string) {
  const item = (req.get("cookie") || "").split(";").map(x => x.trim()).find(x => x.startsWith(`${key}=`));
  return item ? decodeURIComponent(item.slice(key.length + 1)) : "";
}
function pkceChallenge(code: string) { return createHash("sha256").update(code).digest("base64url"); }
async function tokenRequest(url: string, params: Record<string, string>): Promise<OAuthToken> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params), signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`OAuth token exchange failed (${response.status}).`);
  const token = await response.json() as OAuthToken;
  if (!token.access_token) throw new Error("OAuth did not supply an access token.");
  return token;
}
async function fetchIdentity(provider: Provider, access: string) {
  const response = await fetch(provider === "discord" ? "https://discord.com/api/v10/users/@me" : "https://api.kick.com/public/v1/users", { headers: { Authorization: `Bearer ${access}` }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Unable to verify ${provider} identity (${response.status}).`);
  if (provider === "discord") {
    const v = await response.json() as { id: string; username: string; global_name?: string };
    if (!/^\d{17,20}$/.test(v.id)) throw new Error("Unexpected Discord identity format.");
    return { id: v.id, username: (v.global_name || v.username).slice(0, 100) };
  }
  const v = await response.json() as { data?: Array<{ user_id: number; name: string }> };
  const u = v.data?.[0];
  if (!u || !Number.isSafeInteger(u.user_id)) throw new Error("Kick did not return the signed-in user.");
  return { id: String(u.user_id), username: u.name.slice(0, 100) };
}
export function registerAccountLinks(app: Express) {
  app.get("/api/links/:provider/start", async (req, res) => {
    try {
      const provider = req.params.provider;
      if (!safeProvider(provider)) return res.status(404).send("Provider not found.");
      const { user } = await readAuthSnapshot(req, res);
      if (!user || user.status !== "approved" || user.mfaRequired) return res.status(401).send("Sign in first.");
      const { clientId } = config(provider);
      const nonce = randomBytes(24).toString("base64url");
      const verifier = randomBytes(32).toString("base64url");
      const cookie = encryptLinkSecret(JSON.stringify({ provider, nonce, verifier, userId: user.id, sessionId: user.sessionId, created: Date.now() }));
      res.cookie(COOKIE, cookie, cookieOptions);
      const query = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: callback(provider), state: nonce, scope: provider === "discord" ? "identify" : (req.query.management === "1" && user.role === "admin" ? "user:read channel:rewards:read channel:rewards:write moderation:chat_message:manage" : "user:read"), ...(provider === "kick" ? { code_challenge: pkceChallenge(verifier), code_challenge_method: "S256" } : {}) });
      res.setHeader("Cache-Control", "no-store");
      res.redirect(`${provider === "kick" ? "https://id.kick.com" : "https://discord.com"}/oauth${provider === "kick" ? "" : "2"}/authorize?${query}`);
    } catch (error) { console.warn("[OAuth start]", error instanceof Error ? error.message : error); res.status(503).send("Account linking isn't configured."); }
  });
  app.get("/api/links/:provider/callback", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const provider = req.params.provider;
      if (!safeProvider(provider)) return res.status(404).send("Provider not found.");
      const cookie = readCookie(req, COOKIE);
      res.clearCookie(COOKIE, { ...cookieOptions, maxAge: 0 });
      const state = JSON.parse(decryptLinkSecret(cookie)) as { provider: Provider; nonce: string; verifier: string; userId: number; sessionId: string; created: number };
      const snapshot = await readAuthSnapshot(req, res);
      if (!snapshot.user || snapshot.user.status !== "approved" || snapshot.user.mfaRequired || state.userId !== snapshot.user.id || state.sessionId !== snapshot.user.sessionId || state.provider !== provider || state.nonce !== req.query.state || Date.now() - state.created > 600_000 || !req.query.code || typeof req.query.code !== "string") throw new Error("Invalid or expired linking request.");
      const { clientId, secret } = config(provider);
      const token = await tokenRequest(provider === "kick" ? "https://id.kick.com/oauth/token" : "https://discord.com/api/v10/oauth2/token", { grant_type: "authorization_code", client_id: clientId, client_secret: secret, redirect_uri: callback(provider), code: req.query.code, ...(provider === "kick" ? { code_verifier: state.verifier } : {}) });
      const identity = await fetchIdentity(provider, token.access_token);
      const db = await requireDb();
      const [assigned] = await db.select().from(linkedAccounts).where(and(eq(linkedAccounts.provider, provider), eq(linkedAccounts.providerUserId, identity.id)));
      if (assigned && assigned.userId !== snapshot.user.id) throw new Error("This account is linked to another member.");
      // Replace old identity only after fresh, verified OAuth flow; don't allow ID impersonation.
      const encryptedAccessToken = provider === "kick" ? encryptLinkSecret(token.access_token) : null;
      const encryptedRefreshToken = provider === "kick" && token.refresh_token ? encryptLinkSecret(token.refresh_token) : null;
      const values = { providerUserId: identity.id, username: identity.username, encryptedAccessToken, encryptedRefreshToken, tokenExpiresAt: token.expires_in ? new Date(Date.now() + Math.max(60, Number(token.expires_in)) * 1000) : null };
      await db.insert(linkedAccounts).values({ userId: snapshot.user.id, provider, ...values }).onConflictDoUpdate({ target: [linkedAccounts.userId, linkedAccounts.provider], set: values });
      await audit(snapshot.user.id, "account.link", provider, identity.id);
      res.redirect("/security?linked=1");
    } catch (error) {
      console.warn("[OAuth callback]", error instanceof Error ? error.message : error);
      res.redirect("/security?linked=error");
    }
  });
}
export const accountsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const rows = await db.select({ provider: linkedAccounts.provider, providerUserId: linkedAccounts.providerUserId, username: linkedAccounts.username, connectedAt: linkedAccounts.connectedAt }).from(linkedAccounts).where(eq(linkedAccounts.userId, ctx.user.id));
    return { rows, configured: { discord: Boolean(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET), kick: Boolean(process.env.KICK_CLIENT_ID && process.env.KICK_CLIENT_SECRET) } };
  }),
  disconnect: protectedProcedure.input(z.object({ provider: z.enum(["discord", "kick"]) })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    await db.delete(linkedAccounts).where(and(eq(linkedAccounts.userId, ctx.user.id), eq(linkedAccounts.provider, input.provider)));
    await audit(ctx.user.id, "account.unlink", input.provider);
    return { success: true };
  }),
});

export async function accessKickBroadcaster() {
  const broadcasterId = String(process.env.KICK_BROADCASTER_USER_ID || "");
  if (!/^\d+$/.test(broadcasterId)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Configure KICK_BROADCASTER_USER_ID." });
  const db = await requireDb();
  const [row] = await db.select().from(linkedAccounts).where(and(eq(linkedAccounts.provider, "kick"), eq(linkedAccounts.providerUserId, broadcasterId)));
  if (!row?.encryptedAccessToken) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The broadcaster must link their own Kick account with channel rewards scopes." });
  let token = decryptLinkSecret(row.encryptedAccessToken);
  if (row.tokenExpiresAt && row.tokenExpiresAt.getTime() <= Date.now() + 90_000) {
    if (!row.encryptedRefreshToken) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Broadcaster must relink Kick." });
    const { clientId, secret } = config("kick");
    const rotated = await tokenRequest("https://id.kick.com/oauth/token", { grant_type: "refresh_token", client_id: clientId, client_secret: secret, refresh_token: decryptLinkSecret(row.encryptedRefreshToken) });
    token = rotated.access_token;
    await db.update(linkedAccounts).set({ encryptedAccessToken: encryptLinkSecret(rotated.access_token), encryptedRefreshToken: rotated.refresh_token ? encryptLinkSecret(rotated.refresh_token) : row.encryptedRefreshToken, tokenExpiresAt: new Date(Date.now() + (Number(rotated.expires_in) || 3600) * 1000) }).where(eq(linkedAccounts.id, row.id));
  }
  return token;
}
async function rewardsRequest(path: string, method = "GET", body?: unknown) {
  const token = await accessKickBroadcaster();
  const response = await fetch(`https://api.kick.com/public/v1/channels/rewards${path}`, { method, headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new TRPCError({ code: "BAD_GATEWAY", message: `Kick rewards API returned ${response.status}; verify broadcaster scopes.` });
  return response.json() as Promise<unknown>;
}
const ulid = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/i);
export const rewardsRouter = router({
  pending: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin" && !ctx.user.permissions.includes("manageRewards")) throw new TRPCError({ code: "FORBIDDEN" });
    return rewardsRequest("/redemptions?status=pending");
  }),
  decide: protectedProcedure.input(z.object({ ids: z.array(ulid).min(1).max(25).refine(x => new Set(x).size === x.length), action: z.enum(["accept", "reject"]) })).mutation(async ({ ctx, input }) => {
    if (ctx.user.role !== "admin" && !ctx.user.permissions.includes("manageRewards")) throw new TRPCError({ code: "FORBIDDEN" });
    const response = await rewardsRequest(`/redemptions/${input.action}`, "POST", { ids: input.ids });
    await audit(ctx.user.id, `kick.reward.${input.action}`, "redemption", undefined, `${input.ids.length} reward requests`);
    return response;
  }),
});
