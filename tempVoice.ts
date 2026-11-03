/** Temporary Discord voice rooms through an optional single-instance Gateway listener. */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { linkedAccounts, temporaryVoiceConfig, temporaryVoiceRooms } from "../drizzle/schema";
import { discordApi } from "./discord";
import { adminProcedure, protectedProcedure, router } from "./_core/trpc";
import { audit, requireDb } from "./portalFeatures";
import { fireAutomation } from "./advancedOps";

const snowflake = z.string().regex(/^\d{17,20}$/);
type VoiceState = { guild_id?: string; user_id?: string; channel_id?: string | null };
const voices = new Map<string, Set<string>>(); // channelId -> user ids; from authoritative GUILD_CREATE / VOICE_STATE_UPDATE
const memberships = new Map<string, string>(); // guild:user -> channel id
const pending = new Set<string>();
const closing = new Set<string>();
let startRequested = false;

export async function getTempConfig() {
  const db = await requireDb();
  await db.insert(temporaryVoiceConfig).values({ id: 1 }).onConflictDoNothing({ target: temporaryVoiceConfig.id });
  const [row] = await db.select().from(temporaryVoiceConfig).where(eq(temporaryVoiceConfig.id, 1));
  return row;
}
const activeRooms = async () => (await requireDb()).select().from(temporaryVoiceRooms).where(isNull(temporaryVoiceRooms.deletedAt));

export const tempVoiceRouter = router({
  config: protectedProcedure.query(async () => {
    const config = await getTempConfig();
    return { ...config, gatewayEnabled: process.env.DISCORD_GATEWAY_ENABLED === "1" };
  }),
  configure: adminProcedure.input(z.object({ enabled: z.boolean(), guildId: snowflake, triggerChannelId: snowflake, categoryId: snowflake, defaultUserLimit: z.number().int().min(0).max(99), maxRooms: z.number().int().min(1).max(50) })).mutation(async ({ ctx, input }) => {
    const channels = await discordApi<Array<{ id: string; type: number; guild_id?: string }>>(`/guilds/${input.guildId}/channels`);
    const trigger = channels.find(c => c.id === input.triggerChannelId && c.type === 2);
    const category = channels.find(c => c.id === input.categoryId && c.type === 4);
    if (!trigger || !category || trigger.guild_id && trigger.guild_id !== input.guildId) throw new TRPCError({ code: "BAD_REQUEST", message: "Select a valid Discord trigger voice channel and category." });
    const db = await requireDb(); await getTempConfig();
    await db.update(temporaryVoiceConfig).set(input).where(eq(temporaryVoiceConfig.id, 1));
    await audit(ctx.user.id, "tempvoice.configure", "guild", input.guildId);
    return { success: true };
  }),
  list: protectedProcedure.query(async () => {
    const rows = await activeRooms();
    return rows.map(r => ({ ...r, approximateMemberCount: voices.get(r.channelId)?.size ?? null }));
  }),
  my: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const [identity] = await db.select().from(linkedAccounts).where(and(eq(linkedAccounts.userId, ctx.user.id), eq(linkedAccounts.provider, "discord"))).limit(1);
    const rooms = await activeRooms();
    return { discordConnected: Boolean(identity), rooms: ctx.user.role === "admin" ? rooms : rooms.filter(r => r.ownerDiscordId === identity?.providerUserId) };
  }),
  update: protectedProcedure.input(z.object({ channelId: snowflake, name: z.string().trim().min(2).max(80).refine(s => !/[\r\n@]/.test(s)), userLimit: z.number().int().min(0).max(99), locked: z.boolean() })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    const [record] = await db.select().from(temporaryVoiceRooms).where(and(eq(temporaryVoiceRooms.channelId, input.channelId), isNull(temporaryVoiceRooms.deletedAt)));
    if (!record) throw new TRPCError({ code: "NOT_FOUND" });
    const [identity] = await db.select().from(linkedAccounts).where(and(eq(linkedAccounts.userId, ctx.user.id), eq(linkedAccounts.provider, "discord")));
    if (ctx.user.role !== "admin" && identity?.providerUserId !== record.ownerDiscordId) throw new TRPCError({ code: "FORBIDDEN", message: "Only room owner can edit." });
    const actual = await discordApi<{ id: string; guild_id: string; type: number; permission_overwrites?: Array<{ id: string; type: number; allow: string; deny: string }> }>(`/channels/${record.channelId}`);
    if (actual.guild_id !== record.guildId || actual.type !== 2) throw new TRPCError({ code: "CONFLICT", message: "Channel mismatch." });
    await discordApi(`/channels/${record.channelId}`, { method: "PATCH", body: { name: input.name, user_limit: input.userLimit } });
    if (record.locked !== input.locked) {
      const existing = actual.permission_overwrites?.find(x => x.id === record.guildId && x.type === 0);
      const connect = 1n << 20n;
      if (!record.locked && ((BigInt(existing?.allow || "0") | BigInt(existing?.deny || "0")) & connect) !== 0n) throw new TRPCError({ code: "CONFLICT", message: "Existing Discord Connect overwrite must be managed in Discord." });
      await discordApi(`/channels/${record.channelId}/permissions/${record.guildId}`, { method: "PUT", body: { type: 0, allow: (BigInt(existing?.allow || "0") & ~connect).toString(), deny: (input.locked ? BigInt(existing?.deny || "0") | connect : BigInt(existing?.deny || "0") & ~connect).toString() } });
    }
    await db.update(temporaryVoiceRooms).set({ name: input.name, locked: input.locked }).where(eq(temporaryVoiceRooms.channelId, record.channelId));
    await audit(ctx.user.id, "tempvoice.update", "voice", record.channelId);
    return { success: true };
  }),
  member: protectedProcedure.input(z.object({ channelId: snowflake, memberId: snowflake, action: z.enum(["allow", "deny", "disconnect"]) })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    const [record] = await db.select().from(temporaryVoiceRooms).where(and(eq(temporaryVoiceRooms.channelId, input.channelId), isNull(temporaryVoiceRooms.deletedAt)));
    if (!record) throw new TRPCError({ code: "NOT_FOUND" });
    const [identity] = await db.select().from(linkedAccounts).where(and(eq(linkedAccounts.userId, ctx.user.id), eq(linkedAccounts.provider, "discord")));
    if (ctx.user.role !== "admin" && identity?.providerUserId !== record.ownerDiscordId) throw new TRPCError({ code: "FORBIDDEN" });
    if (input.memberId === record.ownerDiscordId) throw new TRPCError({ code: "FORBIDDEN", message: "Cannot remove room owner." });
    const actual = await discordApi<{ type: number; guild_id: string }>(`/channels/${record.channelId}`);
    if (actual.type !== 2 || actual.guild_id !== record.guildId) throw new TRPCError({ code: "CONFLICT" });
    if (input.action === "disconnect") {
      if (!voices.get(record.channelId)?.has(input.memberId)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Member is not currently observed in that voice channel." });
      await discordApi(`/guilds/${record.guildId}/members/${input.memberId}`, { method: "PATCH", body: { channel_id: null } });
    } else {
      const connect = (1n << 20n).toString();
      await discordApi(`/channels/${record.channelId}/permissions/${input.memberId}`, { method: "PUT", body: { type: 1, allow: input.action === "allow" ? connect : "0", deny: input.action === "deny" ? connect : "0" } });
    }
    await audit(ctx.user.id, `tempvoice.member.${input.action}`, "voice", record.channelId, `member=${input.memberId}`);
    return { success: true };
  }),
});

function resetPresence() { voices.clear(); memberships.clear(); }
function setState(guildId: string, userId: string, newChannelId: string | null): string | undefined {
  const key = `${guildId}:${userId}`;
  const old = memberships.get(key);
  if (old) voices.get(old)?.delete(userId);
  if (newChannelId) {
    memberships.set(key, newChannelId);
    if (!voices.has(newChannelId)) voices.set(newChannelId, new Set());
    voices.get(newChannelId)!.add(userId);
  } else memberships.delete(key);
  return old;
}

async function joinCreate(guildId: string, userId: string, channelId: string) {
  const cfg = await getTempConfig();
  if (!cfg.enabled || cfg.guildId !== guildId || cfg.triggerChannelId !== channelId || !cfg.categoryId) return;
  const key = `${guildId}:${userId}`;
  if (pending.has(key)) return;
  pending.add(key);
  try {
    const rooms = await activeRooms();
    if (rooms.filter(r => r.guildId === guildId).length >= cfg.maxRooms) return;
    const own = rooms.find(r => r.ownerDiscordId === userId && r.guildId === guildId);
    if (own) {
      await discordApi(`/guilds/${guildId}/members/${userId}`, { method: "PATCH", body: { channel_id: own.channelId } });
      return;
    }
    const name = `🎧・Room ${userId.slice(-4)}`;
    const created = await discordApi<{ id: string }>(`/guilds/${guildId}/channels`, { method: "POST", body: { name, type: 2, parent_id: cfg.categoryId, user_limit: cfg.defaultUserLimit } });
    const db = await requireDb();
    try {
      await db.insert(temporaryVoiceRooms).values({ channelId: created.id, guildId, ownerDiscordId: userId, name });
      await discordApi(`/guilds/${guildId}/members/${userId}`, { method: "PATCH", body: { channel_id: created.id } });
      void fireAutomation("voice_created", `تم إنشاء روم صوتي مؤقت: ${name}`);
    } catch (e) {
      await db.update(temporaryVoiceRooms).set({ deletedAt: new Date() }).where(eq(temporaryVoiceRooms.channelId, created.id));
      try { await discordApi(`/channels/${created.id}`, { method: "DELETE" }); } catch { /* operator can inspect */ }
      throw e;
    }
  } finally { pending.delete(key); }
}
async function removeEmpty(channelId: string) {
  if (closing.has(channelId)) return;
  closing.add(channelId);
  try {
    // Only remove once gateway has seen this channel and verified no occupants.
    if (!voices.has(channelId) || voices.get(channelId)!.size) return;
    const db = await requireDb();
    const [room] = await db.select().from(temporaryVoiceRooms).where(and(eq(temporaryVoiceRooms.channelId, channelId), isNull(temporaryVoiceRooms.deletedAt)));
    if (!room) return;
    await discordApi(`/channels/${room.channelId}`, { method: "DELETE" });
    await db.update(temporaryVoiceRooms).set({ deletedAt: new Date() }).where(eq(temporaryVoiceRooms.channelId, channelId));
  } catch (e) { console.warn("[temp voice cleanup]", e instanceof Error ? e.message : e); }
  finally { closing.delete(channelId); }
}
async function voiceUpdate(state: VoiceState, fromSync = false) {
  if (!state.guild_id || !state.user_id) return;
  const old = setState(state.guild_id, state.user_id, state.channel_id || null);
  if (!fromSync && state.channel_id && state.channel_id !== old) await joinCreate(state.guild_id, state.user_id, state.channel_id);
  if (old && old !== state.channel_id && voices.get(old)?.size === 0) {
    setTimeout(() => { void removeEmpty(old); }, 15_000).unref?.();
  }
}

/** Opt-in gateway: exactly one running instance must own this connection. */
export function startDiscordVoiceGateway() {
  if (startRequested || process.env.DISCORD_GATEWAY_ENABLED !== "1") return;
  startRequested = true;
  let socket: WebSocket | null = null;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let sequence: number | null = null;
  let reconnectDelay = 2000;
  let heartbeatAck = true;
  const automodEnabled = process.env.DISCORD_AUTOMOD_ENABLED === "1";
  const clear = () => { if (heartbeat) clearInterval(heartbeat); heartbeat = undefined; };
  const reconnect = () => setTimeout(() => { void connect(); }, reconnectDelay = Math.min(reconnectDelay * 2, 60_000)).unref?.();
  async function connect() {
    clear(); resetPresence(); sequence = null;
    try {
      const { getDb, getDiscordSettings } = await import("./db");
      const { getDiscordBotToken } = await import("./discord");
      if (!await getDb() || !await getDiscordSettings()) { reconnect(); return; }
      const token = await getDiscordBotToken();
      const gateway = await fetch("https://discord.com/api/v10/gateway/bot", { headers: { Authorization: `Bot ${token}` }, signal: AbortSignal.timeout(8000) });
      if (!gateway.ok) throw new Error(`Discord gateway HTTP ${gateway.status}`);
      const payload = await gateway.json() as { url: string };
      if (!payload.url.startsWith("wss://gateway.discord.gg")) throw new Error("Unexpected Discord Gateway URL.");
      socket = new WebSocket(`${payload.url}?v=10&encoding=json`);
      socket.addEventListener("open", () => { reconnectDelay = 2000; });
      socket.addEventListener("message", event => {
        try {
          const data = JSON.parse(String(event.data)) as { op: number; t?: string; s?: number | null; d?: any };
          if (typeof data.s === "number") sequence = data.s;
          if (data.op === 10) {
            const interval = Number(data.d?.heartbeat_interval) || 45000;
            heartbeatAck = true;
            heartbeat = setInterval(() => {
              if (!heartbeatAck) { socket?.close(); return; }
              heartbeatAck = false;
              socket?.send(JSON.stringify({ op: 1, d: sequence }));
            }, interval);
            socket?.send(JSON.stringify({ op: 2, d: { token, intents: (1 << 0) | (1 << 7) | (automodEnabled ? ((1 << 9) | (1 << 15)) : 0), properties: { os: "linux", browser: "rezkmod", device: "rezkmod" } } }));
          } else if (data.op === 11) heartbeatAck = true;
          else if (data.op === 1) socket?.send(JSON.stringify({ op: 1, d: sequence }));
          else if (data.op === 7 || data.op === 9) socket?.close();
          else if (data.op === 0 && data.t === "GUILD_CREATE") {
            for (const entry of data.d?.voice_states || []) void voiceUpdate({ ...entry, guild_id: data.d.id }, true);
            // Treat server snapshots as authoritative for cleanup, after state refresh.
            void (async () => {
              const rooms = await activeRooms();
              for (const room of rooms.filter(r => r.guildId === data.d.id)) {
                if (!voices.has(room.channelId)) voices.set(room.channelId, new Set());
                if (voices.get(room.channelId)?.size === 0) setTimeout(() => void removeEmpty(room.channelId), 30_000).unref?.();
              }
            })();
          } else if (data.op === 0 && data.t === "VOICE_STATE_UPDATE") void voiceUpdate(data.d).catch(console.warn);
          else if (data.op === 0 && data.t === "MESSAGE_CREATE" && automodEnabled && data.d?.guild_id && !data.d?.author?.bot && typeof data.d?.content === "string") {
            void import("./advancedOps").then(m => m.processDiscordChatEvent(String(data.d.guild_id), String(data.d.channel_id), String(data.d.id), String(data.d.author.id), String(data.d.content))).catch(console.warn);
          }
          else if (data.op === 0 && data.t === "CHANNEL_DELETE") {
            const id = String(data.d?.id || "");
            if (id) void (async () => { const db = await requireDb(); await db.update(temporaryVoiceRooms).set({ deletedAt: new Date() }).where(eq(temporaryVoiceRooms.channelId, id)); })();
          }
        } catch (e) { console.warn("[voice gateway event]", e instanceof Error ? e.message : e); }
      });
      socket.addEventListener("close", () => { clear(); reconnect(); });
      socket.addEventListener("error", () => socket?.close());
    } catch (e) { console.warn("[voice gateway]", e instanceof Error ? e.message : e); reconnect(); }
  }
  void connect();
}
