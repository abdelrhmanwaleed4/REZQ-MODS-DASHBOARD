/** Official Kick app access integration, server-only credentials and limited polling. */
import * as db from "./db";
import { recordStreamSample } from "./advancedOps";

let appToken: { value: string; expiresAt: number } | null = null;
let running = false;
let started = false;
function kickConfig() {
  const clientId = process.env.KICK_CLIENT_ID?.trim();
  const clientSecret = process.env.KICK_CLIENT_SECRET?.trim();
  const broadcasterId = Number(process.env.KICK_BROADCASTER_USER_ID);
  if (!clientId || !clientSecret || !Number.isSafeInteger(broadcasterId) || broadcasterId < 1) {
    throw new Error("Set KICK_CLIENT_ID, KICK_CLIENT_SECRET and KICK_BROADCASTER_USER_ID on the server.");
  }
  return { clientId, clientSecret, broadcasterId };
}

async function accessToken() {
  if (appToken && appToken.expiresAt > Date.now() + 60_000) return appToken.value;
  const config = kickConfig();
  const response = await fetch("https://id.kick.com/oauth/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: config.clientId, client_secret: config.clientSecret }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Kick OAuth app token was rejected (${response.status}).`);
  const payload = await response.json() as { access_token?: string; expires_in?: number };
  if (!payload.access_token) throw new Error("Kick did not return an app token.");
  appToken = { value: payload.access_token, expiresAt: Date.now() + Math.max(120, Math.min(Number(payload.expires_in) || 3600, 86400)) * 1000 };
  return appToken.value;
}

async function kickRequest<T>(path: string, body?: unknown): Promise<T> {
  const token = await accessToken();
  const response = await fetch(`https://api.kick.com${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Kick API rejected ${path.split("?")[0]} (${response.status}).`);
  return response.json() as Promise<T>;
}

export function kickIntegrationConfig() {
  let configured = true;
  try { kickConfig(); } catch { configured = false; }
  return { configured, webhookPath: "/api/kick/webhook", kickPriorityEnabled: process.env.KICK_WEBHOOK_PRIORITY === "1" };
}

export async function subscribeKickEvents() {
  const { broadcasterId } = kickConfig();
  const events = ["livestream.status.updated", "livestream.metadata.updated", "moderation.banned", "chat.message.sent", "channel.reward.redemption.updated"];
  // App access token has the necessary scope for app-based subscriptions.
  return kickRequest<unknown>("/public/v1/events/subscriptions", {
    broadcaster_user_id: broadcasterId, method: "webhook", events: events.map(name => ({ name, version: 1 })),
  });
}

export async function refreshKickViewers() {
  if (running) return;
  running = true;
  try {
    const { broadcasterId } = kickConfig();
    const response = await kickRequest<{ data?: Array<{ viewer_count?: number; is_live?: boolean }> }>(`/public/v1/livestreams?broadcaster_user_id=${broadcasterId}`);
    const current = await db.getStreamState();
    // Never infer offline from a temporarily missing list entry or stale network.
    const live = response.data?.find(row => row.is_live !== false);
    const count = live?.viewer_count;
    if (current.isLive && typeof count === "number" && Number.isFinite(count) && count >= 0) {
      await db.setStreamStatus({ isLive: true, badge: current.badge, viewerCount: Math.floor(count) });
      await recordStreamSample(current.sessionEpoch, Math.floor(count), true);
    }
  } finally { running = false; }
}

export function startKickPolling() {
  if (started || !kickIntegrationConfig().configured) return;
  started = true;
  const loop = async () => {
    try { await refreshKickViewers(); }
    catch (error) { console.warn("[Kick read-only status]", error instanceof Error ? error.message : "failed"); }
    setTimeout(loop, 60_000).unref?.();
  };
  void loop();
}
