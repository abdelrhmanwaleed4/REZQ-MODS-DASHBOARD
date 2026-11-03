import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { users } from "../drizzle/schema";
import { issueSession } from "./_core/appAuth";
import { adminProcedure, publicProcedure, router } from "./_core/trpc";
import { audit, requireDb } from "./portalFeatures";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32(bytes: Buffer) {
  let bits = 0, value = 0, output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { output += alphabet[(value >>> (bits -= 5)) & 31]; }
  }
  if (bits) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}
function unbase32(input: string) {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of input.toUpperCase().replace(/\s|=/g, "")) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) throw new Error("Invalid TOTP secret");
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits -= 8)) & 255); }
  }
  return Buffer.from(out);
}
function secretKey() {
  if (!process.env.APP_SESSION_SECRET || process.env.APP_SESSION_SECRET.length < 32) throw new Error("APP_SESSION_SECRET not configured");
  return createHash("sha256").update("kickmod-mfa:" + process.env.APP_SESSION_SECRET).digest();
}
function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}
function decrypt(value: string) {
  const [iv, tag, data] = value.split(".");
  if (!iv || !tag || !data) throw new Error("Invalid MFA secret record");
  const decipher = createDecipheriv("aes-256-gcm", secretKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
function otp(secret: string, counter: number) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", unbase32(secret)).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const number = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(number).padStart(6, "0");
}
export function validateTotp(secret: string, code: string, epoch = Date.now()) {
  if (!/^\d{6}$/.test(code)) return false;
  const counter = Math.floor(epoch / 30_000);
  return [-1, 0, 1].some(step => timingSafeEqual(Buffer.from(otp(secret, counter + step)), Buffer.from(code)));
}
// In-memory throttle adds friction; use a shared Redis limiter for clustered production deployments.
const failures = new Map<number, { count: number; until: number }>();
function throttle(id: number) {
  const state = failures.get(id);
  if (state && state.count >= 5 && Date.now() < state.until) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many codes. Try again later." });
}
function failed(id: number) {
  const now = Date.now(), state = failures.get(id);
  failures.set(id, { count: (state?.until && state.until > now ? state.count : 0) + 1, until: now + 10 * 60_000 });
}

export const mfaRouter = router({
  begin: adminProcedure.mutation(async ({ ctx }) => {
    const db = await requireDb();
    const [account] = await db.select().from(users).where(eq(users.id, ctx.user.id));
    if (account.totpEnabled) throw new TRPCError({ code: "CONFLICT", message: "MFA already enabled." });
    const secret = base32(randomBytes(20));
    await db.update(users).set({ totpSecret: encrypt(secret) }).where(eq(users.id, account.id));
    const issuer = encodeURIComponent("REZK MODS");
    const label = encodeURIComponent(account.email || `user${account.id}`);
    return { secret, url: `otpauth://totp/${issuer}:${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30` };
  }),
  enable: adminProcedure.input(z.object({ code: z.string().regex(/^\d{6}$/) })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    const [account] = await db.select().from(users).where(eq(users.id, ctx.user.id));
    if (!account.totpSecret || account.totpEnabled) throw new TRPCError({ code: "PRECONDITION_FAILED" });
    throttle(account.id);
    if (!validateTotp(decrypt(account.totpSecret), input.code)) { failed(account.id); throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid authenticator code." }); }
    failures.delete(account.id);
    await db.update(users).set({ totpEnabled: true, sessionVersion: account.sessionVersion + 1 }).where(eq(users.id, account.id));
    const [updated] = await db.select().from(users).where(eq(users.id, account.id));
    await issueSession(ctx.res, updated, ctx.req.get("user-agent"), true);
    await audit(account.id, "security.mfa.enable", "user", account.id);
    return { success: true };
  }),
  verify: publicProcedure.input(z.object({ code: z.string().regex(/^\d{6}$/) })).mutation(async ({ ctx, input }) => {
    if (!ctx.user || ctx.user.role !== "admin" || !ctx.user.mfaRequired) throw new TRPCError({ code: "FORBIDDEN" });
    const db = await requireDb();
    const [account] = await db.select().from(users).where(eq(users.id, ctx.user.id));
    if (!account?.totpSecret || !account.totpEnabled) throw new TRPCError({ code: "FORBIDDEN" });
    throttle(account.id);
    if (!validateTotp(decrypt(account.totpSecret), input.code)) { failed(account.id); throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid authenticator code." }); }
    failures.delete(account.id);
    await issueSession(ctx.res, account, ctx.req.get("user-agent"), true);
    return { success: true };
  }),
  state: publicProcedure.query(({ ctx }) => ({ required: Boolean(ctx.user?.mfaRequired), enabled: Boolean(ctx.user?.mfaEnabled) })),
});
