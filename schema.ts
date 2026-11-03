import { boolean, index, integer, pgTable, primaryKey, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: varchar("role", { length: 32, enum: ["user", "admin"] }).default("user").notNull(),
  team: varchar("team", { length: 32, enum: ["main", "reserve"] }).default("reserve").notNull(),
  status: varchar("status", { length: 32, enum: ["pending", "approved", "banned"] }).default("pending").notNull(),
  passwordHash: varchar("passwordHash", { length: 255 }),
  emailVerified: boolean("emailVerified").default(false).notNull(),
  sessionVersion: integer("sessionVersion").default(0).notNull(),
  totpSecret: text("totpSecret"),
  totpEnabled: boolean("totpEnabled").default(false).notNull(),
  banReason: text("banReason"),
  bannedAt: timestamp("bannedAt", { withTimezone: true }),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
  lastSignedIn: timestamp("lastSignedIn", { withTimezone: true }).defaultNow().notNull(),
}, table => [uniqueIndex("users_email_unique").on(table.email)]);

export const ranks = pgTable("ranks", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 80 }).notNull(),
  description: text("description"),
  color: varchar("color", { length: 32 }).default("#A9F4FF").notNull(),
  permissions: text("permissions").notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
}, table => [uniqueIndex("ranks_name_unique").on(table.name)]);

export const userRanks = pgTable("user_ranks", {
  userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  rankId: integer("rankId").notNull().references(() => ranks.id, { onDelete: "cascade" }),
  assignedAt: timestamp("assignedAt", { withTimezone: true }).defaultNow().notNull(),
}, table => [primaryKey({ columns: [table.userId, table.rankId] })]);

export const discordSettings = pgTable("discord_settings", {
  id: integer("id").primaryKey(),
  channelId: varchar("channelId", { length: 24 }).notNull(),
  encryptedToken: text("encryptedToken").notNull(),
  connected: boolean("connected").default(false).notNull(),
  lastError: text("lastError"),
  checkedAt: timestamp("checkedAt", { withTimezone: true }),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
});

export const streamState = pgTable("stream_state", {
  id: integer("id").primaryKey(),
  isLive: boolean("isLive").default(false).notNull(),
  badge: varchar("badge", { length: 40 }).default("OFFLINE").notNull(),
  viewerCount: integer("viewerCount").default(0).notNull(),
  sessionEpoch: integer("sessionEpoch").default(0).notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Rank = typeof ranks.$inferSelect;
export type InsertRank = typeof ranks.$inferInsert;
export type StreamState = typeof streamState.$inferSelect;

// Time is recorded by explicit website check-in/check-out, not by Discord/Kick telemetry.
// A nullable unique activeUserId guarantees at most one active session per member,
// including during concurrent requests to separate app instances.
export const attendanceSessions = pgTable("attendance_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  activeUserId: integer("activeUserId").unique(),
  startedAt: timestamp("startedAt", { withTimezone: true }).defaultNow().notNull(),
  endedAt: timestamp("endedAt", { withTimezone: true }),
  durationSeconds: integer("durationSeconds").default(0).notNull(),
  verifiedSeconds: integer("verifiedSeconds").default(0).notNull(),
  lastPulseAt: timestamp("lastPulseAt", { withTimezone: true }),
  endReason: varchar("endReason", { length: 32, enum: ["manual", "stream_end"] }).default("manual").notNull(),
}, table => [index("attendance_user_end_idx").on(table.userId, table.endedAt)]);

export const pointEvents = pgTable("point_events", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  actorId: integer("actorId").notNull().references(() => users.id),
  delta: integer("delta").notNull(),
  reason: varchar("reason", { length: 500 }).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
}, table => [index("points_user_date_idx").on(table.userId, table.createdAt)]);

export const absenceRequests = pgTable("absence_requests", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: varchar("kind", { length: 32, enum: ["leave", "excuse"] }).notNull(),
  startDate: varchar("startDate", { length: 10 }).notNull(),
  endDate: varchar("endDate", { length: 10 }).notNull(),
  reason: varchar("reason", { length: 1000 }).notNull(),
  status: varchar("status", { length: 32, enum: ["pending", "approved", "rejected"] }).default("pending").notNull(),
  reviewedBy: integer("reviewedBy").references(() => users.id),
  reviewedAt: timestamp("reviewedAt", { withTimezone: true }),
  reviewedNote: varchar("reviewedNote", { length: 500 }),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
}, table => [index("absence_user_created_idx").on(table.userId, table.createdAt)]);

export const disciplinaryActions = pgTable("disciplinary_actions", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  actorId: integer("actorId").notNull().references(() => users.id),
  level: varchar("level", { length: 32, enum: ["notice", "warning", "strike"] }).notNull(),
  reason: varchar("reason", { length: 1000 }).notNull(),
  evidenceUrl: varchar("evidenceUrl", { length: 1000 }),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  rescindedAt: timestamp("rescindedAt", { withTimezone: true }),
  rescindedBy: integer("rescindedBy").references(() => users.id),
}, table => [index("discipline_user_created_idx").on(table.userId, table.createdAt)]);

// Only explicitly tracked voice channels may be deleted: portal-created or administrator-adopted.
export const managedVoiceRooms = pgTable("managed_voice_rooms", {
  id: serial("id").primaryKey(),
  channelId: varchar("channelId", { length: 24 }).notNull().unique(),
  guildId: varchar("guildId", { length: 24 }).notNull(),
  categoryId: varchar("categoryId", { length: 24 }),
  name: varchar("name", { length: 80 }).notNull(),
  userLimit: integer("userLimit").default(0).notNull(),
  locked: boolean("locked").default(false).notNull(),
  source: varchar("source", { length: 32, enum: ["portal", "adopted"] }).default("portal").notNull(),
  createdBy: integer("createdBy").notNull().references(() => users.id),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deletedAt", { withTimezone: true }),
  deletedBy: integer("deletedBy").references(() => users.id),
}, table => [index("voice_guild_idx").on(table.guildId)]);

export const portalSettings = pgTable("portal_settings", {
  id: integer("id").primaryKey(),
  pointsPerActivity: integer("pointsPerActivity").default(15).notNull(),
  elitePoints: integer("elitePoints").default(150).notNull(),
  subLeaderPoints: integer("subLeaderPoints").default(400).notNull(),
  leadershipPoints: integer("leadershipPoints").default(800).notNull(),
  attendanceTargetMinutes: integer("attendanceTargetMinutes").default(180).notNull(),
  examPassingPercent: integer("examPassingPercent").default(70).notNull(),
  voiceGuildId: varchar("voiceGuildId", { length: 24 }),
  voiceCategoryId: varchar("voiceCategoryId", { length: 24 }),
  kickChannelSlug: varchar("kickChannelSlug", { length: 80 }).default("es_hisham").notNull(),
  discordAlertsChannelId: varchar("discordAlertsChannelId", { length: 24 }),
});

export const userNotifications = pgTable("user_notifications", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: varchar("kind", { length: 40 }).notNull(),
  title: varchar("title", { length: 150 }).notNull(),
  message: varchar("message", { length: 500 }).notNull(),
  readAt: timestamp("readAt", { withTimezone: true }),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
}, table => [index("notifications_user_idx").on(table.userId, table.createdAt)]);

export const auditEvents = pgTable("audit_events", {
  id: serial("id").primaryKey(),
  actorId: integer("actorId").references(() => users.id),
  action: varchar("action", { length: 90 }).notNull(),
  targetType: varchar("targetType", { length: 40 }).notNull(),
  targetId: varchar("targetId", { length: 80 }),
  details: varchar("details", { length: 500 }),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
}, table => [index("audit_created_idx").on(table.createdAt)]);

export const incidentReports = pgTable("incident_reports", {
  id: serial("id").primaryKey(),
  reporterId: integer("reporterId").notNull().references(() => users.id, { onDelete: "cascade" }),
  category: varchar("category", { length: 32, enum: ["conduct", "technical", "appeal", "other"] }).notNull(),
  description: varchar("description", { length: 2000 }).notNull(),
  evidenceUrl: varchar("evidenceUrl", { length: 1000 }),
  status: varchar("status", { length: 32, enum: ["open", "reviewing", "resolved", "rejected"] }).default("open").notNull(),
  reviewerId: integer("reviewerId").references(() => users.id),
  response: varchar("response", { length: 1000 }),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
}, table => [index("incident_created_idx").on(table.createdAt)]);

export const academyQuestions = pgTable("academy_questions", {
  id: serial("id").primaryKey(),
  question: varchar("question", { length: 500 }).notNull(),
  optionsJson: text("optionsJson").notNull(),
  correctIndex: integer("correctIndex").notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  createdBy: integer("createdBy").notNull().references(() => users.id),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
});

export const academyAttempts = pgTable("academy_attempts", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  score: integer("score").notNull(),
  total: integer("total").notNull(),
  passed: boolean("passed").notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
}, table => [index("academy_user_idx").on(table.userId, table.createdAt)]);

export const kickEventLog = pgTable("kick_event_log", {
  messageId: varchar("messageId", { length: 80 }).primaryKey(),
  type: varchar("type", { length: 80 }).notNull(),
  summary: varchar("summary", { length: 500 }).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
});

export const loginSessions = pgTable("login_sessions", {
  id: varchar("id", { length: 64 }).primaryKey(),
  userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  userAgent: varchar("userAgent", { length: 300 }),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revokedAt", { withTimezone: true }),
}, table => [index("session_user_idx").on(table.userId)]);

// REZK MODS V3 additions: safe, auditable operations and optional platform integrations.
export const linkedAccounts = pgTable("linked_accounts", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: varchar("provider", { length: 32, enum: ["discord", "kick"] }).notNull(),
  providerUserId: varchar("providerUserId", { length: 80 }).notNull(),
  username: varchar("username", { length: 100 }).notNull(),
  encryptedAccessToken: text("encryptedAccessToken"),
  encryptedRefreshToken: text("encryptedRefreshToken"),
  tokenExpiresAt: timestamp("tokenExpiresAt", { withTimezone: true }),
  connectedAt: timestamp("connectedAt", { withTimezone: true }).defaultNow().notNull(),
}, table => [uniqueIndex("linked_provider_user_idx").on(table.provider, table.providerUserId), uniqueIndex("linked_owner_provider_idx").on(table.userId, table.provider)]);

export const temporaryVoiceConfig = pgTable("temporary_voice_config", {
  id: integer("id").primaryKey(),
  enabled: boolean("enabled").default(false).notNull(),
  guildId: varchar("guildId", { length: 24 }),
  triggerChannelId: varchar("triggerChannelId", { length: 24 }),
  categoryId: varchar("categoryId", { length: 24 }),
  defaultUserLimit: integer("defaultUserLimit").default(0).notNull(),
  maxRooms: integer("maxRooms").default(20).notNull(),
});
export const temporaryVoiceRooms = pgTable("temporary_voice_rooms", {
  channelId: varchar("channelId", { length: 24 }).primaryKey(),
  guildId: varchar("guildId", { length: 24 }).notNull(),
  ownerDiscordId: varchar("ownerDiscordId", { length: 24 }).notNull(),
  name: varchar("name", { length: 80 }).notNull(),
  locked: boolean("locked").default(false).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deletedAt", { withTimezone: true }),
}, t => [index("temp_voice_guild_idx").on(t.guildId)]);
export const moderationCases = pgTable("moderation_cases", {
  id: serial("id").primaryKey(),
  platform: varchar("platform", { length: 32, enum: ["kick", "discord", "internal"] }).notNull(),
  subject: varchar("subject", { length: 120 }).notNull(),
  action: varchar("action", { length: 32, enum: ["warn", "timeout", "ban", "unban", "delete_message", "note"] }).notNull(),
  reason: varchar("reason", { length: 1000 }).notNull(),
  evidenceUrl: varchar("evidenceUrl", { length: 1000 }),
  actorId: integer("actorId").references(() => users.id),
  externalEventId: varchar("externalEventId", { length: 80 }).unique(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
}, t => [index("mod_case_subject_idx").on(t.platform, t.subject)]);
export const automodRules = pgTable("automod_rules", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 80 }).notNull(),
  platform: varchar("platform", { length: 32, enum: ["kick", "discord"] }).notNull(),
  kind: varchar("kind", { length: 32, enum: ["word", "link", "flood"] }).notNull(),
  pattern: varchar("pattern", { length: 200 }).notNull(),
  action: varchar("action", { length: 32, enum: ["log", "alert", "delete"] }).notNull().default("alert"),
  enabled: boolean("enabled").default(true).notNull(),
  createdBy: integer("createdBy").notNull().references(() => users.id),
});
export const automodHits = pgTable("automod_hits", {
  id: serial("id").primaryKey(),
  ruleId: integer("ruleId").notNull().references(() => automodRules.id),
  eventId: varchar("eventId", { length: 80 }).notNull(),
  platform: varchar("platform", { length: 20 }).notNull(),
  actorHash: varchar("actorHash", { length: 64 }),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
}, t => [uniqueIndex("automod_dedupe_idx").on(t.ruleId, t.eventId)]);
export const punishmentAppeals = pgTable("punishment_appeals", {
  id: serial("id").primaryKey(),
  requesterId: integer("requesterId").notNull().references(() => users.id),
  caseId: integer("caseId").notNull().references(() => moderationCases.id),
  reason: varchar("reason", { length: 1500 }).notNull(),
  status: varchar("status", { length: 32, enum: ["pending", "accepted", "rejected"] }).default("pending").notNull(),
  reviewerId: integer("reviewerId").references(() => users.id),
  decision: varchar("decision", { length: 1000 }),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  reviewedAt: timestamp("reviewedAt", { withTimezone: true }),
});
export const streamSamples = pgTable("stream_samples", {
  id: serial("id").primaryKey(),
  streamEpoch: integer("streamEpoch").notNull(),
  viewerCount: integer("viewerCount").notNull(),
  isLive: boolean("isLive").notNull(),
  sampledAt: timestamp("sampledAt", { withTimezone: true }).defaultNow().notNull(),
}, t => [index("samples_epoch_date_idx").on(t.streamEpoch, t.sampledAt)]);
export const knowledgeArticles = pgTable("knowledge_articles", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 160 }).notNull(),
  body: text("body").notNull(),
  published: boolean("published").default(true).notNull(),
  createdBy: integer("createdBy").notNull().references(() => users.id),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
});
export const staffAnnouncements = pgTable("staff_announcements", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 160 }).notNull(),
  body: text("body").notNull(),
  createdBy: integer("createdBy").notNull().references(() => users.id),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
});
export const announcementReads = pgTable("announcement_reads", {
  announcementId: integer("announcementId").notNull().references(() => staffAnnouncements.id, { onDelete: "cascade" }),
  userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  readAt: timestamp("readAt", { withTimezone: true }).defaultNow().notNull(),
}, t => [primaryKey({ columns: [t.announcementId, t.userId] })]);
export const staffMessages = pgTable("staff_messages", {
  id: serial("id").primaryKey(),
  authorId: integer("authorId").notNull().references(() => users.id),
  body: varchar("body", { length: 1500 }).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
});
export const streamBookmarks = pgTable("stream_bookmarks", {
  id: serial("id").primaryKey(),
  streamEpoch: integer("streamEpoch").notNull(),
  label: varchar("label", { length: 200 }).notNull(),
  note: varchar("note", { length: 1000 }),
  createdBy: integer("createdBy").notNull().references(() => users.id),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
});
export const automationRules = pgTable("automation_rules", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 120 }).notNull(),
  event: varchar("event", { length: 32, enum: ["stream_started", "stream_ended", "case_created", "appeal_created", "voice_created", "reward_pending"] }).notNull(),
  action: varchar("action", { length: 32, enum: ["notify_admins", "discord_alert"] }).notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  createdBy: integer("createdBy").notNull().references(() => users.id),
});
export const sensitiveApprovals = pgTable("sensitive_approvals", {
  id: serial("id").primaryKey(),
  action: varchar("action", { length: 32, enum: ["delete_adopted_voice", "restore_config", "rank_save_high", "rank_assign_high", "rank_unassign_high"] }).notNull(),
  payload: text("payload").notNull(),
  requestedBy: integer("requestedBy").notNull().references(() => users.id),
  approvedBy: integer("approvedBy").references(() => users.id),
  status: varchar("status", { length: 32, enum: ["pending", "executing", "completed", "rejected", "failed"] }).default("pending").notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  resolvedAt: timestamp("resolvedAt", { withTimezone: true }),
}, t => [index("approvals_status_idx").on(t.status)]);
