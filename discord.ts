import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import * as db from "./db";

const DISCORD_API = "https://discord.com/api/v10";
const POLL_MS = 10_000;
let polling = false;
let started = false;

type DiscordMessage = {
  content?: string;
  author?: { bot?: boolean };
  embeds?: Array<{ description?: string }>;
};

type ParsedStatus = { isLive: boolean; badge: string; viewerCount: number };

function encryptionKey() {
  const encoded = process.env.DISCORD_TOKEN_ENCRYPTION_KEY;
  if (!encoded) throw new Error("Discord token encryption key is not configured.");
  const key = Buffer.from(encoded.trim(), "base64");
  if (key.length !== 32) throw new Error("Discord token encryption key must decode to 32 bytes.");
  return key;
}

function encryptToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const record = { v: 1, iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), data: encrypted.toString("base64url") };
  return JSON.stringify(record);
}

function decryptToken(value: string) {
  const record = JSON.parse(value) as { v?: number; iv?: string; tag?: string; data?: string };
  if (record.v !== 1 || !record.iv || !record.tag || !record.data) throw new Error("Stored bot credential is invalid.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(record.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(record.tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(record.data, "base64url")), decipher.final()]).toString("utf8");
}

function normalizedToken(token: string) {
  return token.trim().replace(/^Bot\s+/i, "");
}

function validateChannelId(channelId: string) {
  if (!/^\d{17,20}$/.test(channelId)) throw new Error("Enter a valid Discord channel ID (17–20 digits).");
}

async function discordFetch(path: string, token: string) {
  const response = await fetch(`${DISCORD_API}${path}`, {
    headers: { Authorization: `Bot ${normalizedToken(token)}`, Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error("Discord rejected the bot token. Check it and try again.");
    if (response.status === 403 || response.status === 404) throw new Error("The bot cannot read this channel. Check the channel ID and its View Channel / Read Message History permissions.");
    if (response.status === 429) throw new Error("Discord rate-limited the connection. It will retry automatically.");
    throw new Error(`Discord request failed (${response.status}).`);
  }
  return response.json() as Promise<unknown>;
}

function parseJsonContent(raw: string | undefined): unknown {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

function parseStatus(messages: DiscordMessage[]): ParsedStatus | null {
  for (const message of messages) {
    if (!message.author?.bot) continue;
    const candidate = parseJsonContent(message.content) ?? parseJsonContent(message.embeds?.find(embed => embed.description)?.description);
    if (!candidate || typeof candidate !== "object") continue;
    const data = candidate as Record<string, unknown>;
    const rawBadge = typeof data.badge === "string" ? data.badge.trim() : "";
    const explicitLive = typeof data.isLive === "boolean" ? data.isLive : undefined;
    const badge = (rawBadge || (explicitLive === false ? "OFFLINE" : explicitLive === true ? "LIVE" : "UNKNOWN")).slice(0, 40);
    const countValue = data.viewerCount ?? data.viewers ?? 0;
    const viewerCount = typeof countValue === "number" ? countValue : Number(countValue);
    if (!Number.isFinite(viewerCount) || viewerCount < 0) continue;
    const badgeMeansLive = /^(live|streaming|online|on air)$/i.test(badge);
    const isLive = explicitLive ?? badgeMeansLive;
    return { isLive, badge: isLive ? (rawBadge || "LIVE") : (rawBadge || "OFFLINE"), viewerCount: Math.floor(viewerCount) };
  }
  return null;
}

async function verifyBotAccess(token: string, channelId: string) {
  validateChannelId(channelId);
  const channel = await discordFetch(`/channels/${channelId}`, token) as { id?: string };
  if (channel.id !== channelId) throw new Error("Discord did not return the requested channel.");
  await discordFetch(`/channels/${channelId}/messages?limit=5`, token);
}

export async function saveDiscordIntegration(tokenInput: string, channelIdInput: string) {
  const token = normalizedToken(tokenInput);
  const channelId = channelIdInput.trim();
  if (!token || token.length > 512) throw new Error("Enter a valid Discord bot token.");
  await verifyBotAccess(token, channelId);
  const encrypted = encryptToken(token);
  await db.saveDiscordSettings(channelId, encrypted);
}

export async function getPublicDiscordConfig() {
  const settings = await db.getDiscordSettings();
  if (!settings) return { configured: false, channelId: "", connected: false, lastError: null as string | null, checkedAt: null as Date | null };
  return { configured: true, channelId: settings.channelId, connected: settings.connected, lastError: settings.lastError, checkedAt: settings.checkedAt };
}

export async function pollDiscordOnce() {
  if (polling) return;
  polling = true;
  try {
    const settings = await db.getDiscordSettings();
    if (!settings) return;
    const token = decryptToken(settings.encryptedToken);
    const messages = await discordFetch(`/channels/${settings.channelId}/messages?limit=20`, token) as DiscordMessage[];
    if (!Array.isArray(messages)) throw new Error("Discord returned an unexpected channel response.");
    const status = parseStatus(messages);
    if (status && process.env.KICK_WEBHOOK_PRIORITY !== "1") await db.setStreamStatus(status);
    await db.updateDiscordHealth(true, status ? null : "Connected; waiting for a bot JSON status message with badge and viewerCount.");
  } catch (error) {
    const safeMessage = error instanceof Error ? error.message : "Discord connection failed.";
    try { await db.updateDiscordHealth(false, safeMessage); } catch { /* a missing database must not stop the process */ }
  } finally {
    polling = false;
  }
}

export function startDiscordPolling() {
  if (started) return;
  started = true;
  const loop = async () => {
    await pollDiscordOnce();
    setTimeout(loop, POLL_MS).unref?.();
  };
  void loop();
}

// Server-only Discord REST client for managed voice rooms and optional notifications.
// Bot token never appears in frontend responses.
export async function discordApi<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const settings = await db.getDiscordSettings();
  if (!settings) throw new Error("Connect a Discord bot before managing voice channels.");
  const token = decryptToken(settings.encryptedToken);
  const response = await fetch(`${DISCORD_API}${path}`, {
    method: init.method || "GET",
    headers: { Authorization: `Bot ${normalizedToken(token)}`, Accept: "application/json", ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error("Invalid Discord bot token.");
    if (response.status === 403) throw new Error("Discord denied this operation. Give the bot Manage Channels (and Manage Roles for room locks).");
    if (response.status === 404) throw new Error("The Discord channel or server no longer exists or isn't visible to the bot.");
    if (response.status === 429) throw new Error("Discord rate-limited this operation. Retry later.");
    throw new Error(`Discord API error (${response.status}).`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function tryDiscordAlert(title: string, description: string) {
  try {
    const { getPortalSettings } = await import("./portalFeatures");
    const settings = await getPortalSettings();
    if (!settings.discordAlertsChannelId) return;
    const message = `**${title.replace(/[@`]/g, "")}**\n${description.replace(/[@`]/g, "")}`.slice(0, 1900);
    await discordApi(`/channels/${settings.discordAlertsChannelId}/messages`, { method: "POST", body: { content: message, allowed_mentions: { parse: [] } } });
  } catch (error) {
    console.warn("[Discord alerts] Delivery failed:", error instanceof Error ? error.message : "unknown error");
  }
}

/** Server-only decrypted token; NEVER expose from a public route. */
export async function getDiscordBotToken() {
  const settings = await db.getDiscordSettings();
  if (!settings) throw new Error("Discord bot is not configured.");
  return decryptToken(settings.encryptedToken);
}
