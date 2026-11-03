/** Official Kick signed webhook receiver. No anonymous status updates accepted. */
import { createPublicKey, verify } from "node:crypto";
import type { Express, Request, Response } from "express";
import express from "express";
import { desc, eq } from "drizzle-orm";
import { kickEventLog, userNotifications, users } from "../drizzle/schema";
import { setStreamStatus } from "./db";
import { getPortalSettings, requireDb } from "./portalFeatures";
import { tryDiscordAlert } from "./discord";
import { fireAutomation, processKickChatEvent, recordStreamSample } from "./advancedOps";
import { moderationCases } from "../drizzle/schema";

let pemCache: { pem: string; expiresAt: number } | null = null;
export async function kickPublicKey() {
  if (pemCache && pemCache.expiresAt > Date.now()) return pemCache.pem;
  const response = await fetch("https://api.kick.com/public/v1/public-key", { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("Unable to fetch Kick public key");
  const text = await response.text();
  let key = text;
  if (!text.startsWith("-----BEGIN")) {
    const data = JSON.parse(text) as { data?: { public_key?: string } | string; public_key?: string };
    key = typeof data.data === "string" ? data.data : data.data?.public_key || data.public_key || "";
  }
  if (!key.startsWith("-----BEGIN PUBLIC KEY-----")) throw new Error("Unexpected Kick public key format");
  createPublicKey(key);
  pemCache = { pem: key, expiresAt: Date.now() + 60 * 60_000 };
  return key;
}

export function verifyKickSignature(messageId: string, timestamp: string, raw: Buffer, signature: string, pem: string) {
  const signed = Buffer.concat([Buffer.from(`${messageId}.${timestamp}.`, "utf8"), raw]);
  return verify("RSA-SHA256", signed, { key: pem, padding: 1 }, Buffer.from(signature, "base64"));
}

export function registerKickEvents(app: Express) {
  app.post("/api/kick/webhook", express.raw({ type: "application/json", limit: "128kb" }), async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    const id = req.get("Kick-Event-Message-Id") || "";
    const timestamp = req.get("Kick-Event-Message-Timestamp") || "";
    const signature = req.get("Kick-Event-Signature") || "";
    const type = req.get("Kick-Event-Type") || "";
    if (!/^[a-zA-Z0-9_-]{10,80}$/.test(id) || !signature || !timestamp || !Buffer.isBuffer(req.body)) return res.status(400).json({ error: "invalid_headers" });
    const instant = Date.parse(timestamp);
    if (!Number.isFinite(instant) || Math.abs(Date.now() - instant) > 5 * 60_000) return res.status(401).json({ error: "stale_event" });
    try {
      let pem = await kickPublicKey();
      let valid = verifyKickSignature(id, timestamp, req.body, signature, pem);
      if (!valid) { pemCache = null; pem = await kickPublicKey(); valid = verifyKickSignature(id, timestamp, req.body, signature, pem); }
      if (!valid) return res.status(401).json({ error: "invalid_signature" });
      const body = JSON.parse(req.body.toString("utf8")) as { broadcaster?: { channel_slug?: string; username?: string }; is_live?: boolean; moderator?: { username?: string }; banned_user?: { username?: string }; sender?: { username?: string; user_id?: number }; content?: string; message_id?: string };
      const config = await getPortalSettings();
      if (body.broadcaster?.channel_slug?.toLowerCase() !== config.kickChannelSlug.toLowerCase()) return res.status(202).json({ ignored: true });
      const db = await requireDb();
      const [already] = await db.select().from(kickEventLog).where(eq(kickEventLog.messageId, id));
      if (already) return res.status(200).json({ duplicate: true });
      // Only structured, non-sensitive summaries; never store chat bodies or credentials.
      let summary = "تم استلام حدث من Kick";
      if (type === "livestream.status.updated") {
        if (typeof body.is_live !== "boolean") return res.status(400).json({ error: "invalid_payload" });
        summary = body.is_live ? "بدأ البث المباشر" : "انتهى البث المباشر";
      } else if (type === "moderation.banned") {
        summary = `حظر بواسطة ${(body.moderator?.username || "moderator").slice(0, 80)} للمستخدم ${(body.banned_user?.username || "member").slice(0, 80)}`;
      } else if (type === "chat.message.sent") {
        // Inspect in memory only; do not archive chat content or viewer IDs.
        const hits = await processKickChatEvent(id, body.sender?.username || String(body.sender?.user_id || "anonymous"), String(body.content || ""), body.message_id);
        await db.insert(kickEventLog).values({ messageId: id, type, summary: hits ? `${hits} AutoMod rule(s) matched` : "Chat event processed without storing content" });
        return res.status(200).json({ accepted: true, stored: false, matchedRules: hits });
      }
      await db.insert(kickEventLog).values({ messageId: id, type: type.slice(0, 80), summary: summary.slice(0, 500) });
      if (type === "channel.reward.redemption.updated") {
        await fireAutomation("reward_pending", `تغيرت حالة مكافأة في قناة ${config.kickChannelSlug}؛ افتح صفحة مكافآت Kick للمراجعة.`);
      }
      if (type === "moderation.banned") {
        await db.insert(moderationCases).values({ platform: "kick", subject: (body.banned_user?.username || "unknown").slice(0, 120), action: "ban", reason: "Verified Kick webhook", externalEventId: id });
      }
      if (type === "livestream.status.updated") {
        // Stream status is authoritative only after signature and broadcaster validation.
        const live = body.is_live as boolean;
        await setStreamStatus({ isLive: live, badge: live ? "LIVE" : "OFFLINE", viewerCount: 0 });
        const latest = await (await import("./db")).getStreamState();
        await recordStreamSample(latest.sessionEpoch, 0, live);
        await fireAutomation(live ? "stream_started" : "stream_ended", `${config.kickChannelSlug}: ${summary}`);
        if (live) {
          const members = await db.select({ id: users.id }).from(users).where(eq(users.status, "approved")).limit(200);
          if (members.length) await db.insert(userNotifications).values(members.map(m => ({ userId: m.id, kind: "stream", title: "بدأ البث المباشر", message: "البث بدأ على Kick؛ راجع لوحة العمليات." })));
        }
        await tryDiscordAlert(live ? "🔴 بدأ بث Kick" : "انتهى بث Kick", `${config.kickChannelSlug}: ${summary}`);
      }
      return res.status(200).json({ received: true });
    } catch (error) {
      console.warn("[Kick webhook]", error instanceof Error ? error.message : "failure");
      return res.status(503).json({ error: "verification_or_storage_unavailable" });
    }
  });
}

export async function getKickEvents() {
  const db = await requireDb();
  return db.select().from(kickEventLog).orderBy(desc(kickEventLog.createdAt)).limit(100);
}
