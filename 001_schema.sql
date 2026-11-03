-- REZK MODS | Fresh install schema for Supabase PostgreSQL

-- Run in Supabase SQL Editor as the project database owner.

-- This creates application tables; Supabase Auth continues to own auth.users.

-- RLS enabled without direct-client policies: app data is accessible only from server-side API.

BEGIN;

CREATE TABLE IF NOT EXISTS public."users" (
  "id" SERIAL PRIMARY KEY,
  "openId" VARCHAR(64) NOT NULL,
  "name" TEXT,
  "email" VARCHAR(320),
  "loginMethod" VARCHAR(64),
  "role" VARCHAR(32) NOT NULL DEFAULT 'user',
  "team" VARCHAR(32) NOT NULL DEFAULT 'reserve',
  "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
  "passwordHash" VARCHAR(255),
  "emailVerified" BOOLEAN NOT NULL DEFAULT FALSE,
  "sessionVersion" INTEGER NOT NULL DEFAULT 0,
  "totpSecret" TEXT,
  "totpEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "banReason" TEXT,
  "bannedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "lastSignedIn" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("openId"),
  CHECK ("role" IN ('user','admin')),
  CHECK ("team" IN ('main','reserve')),
  CHECK ("status" IN ('pending','approved','banned'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "users_email_unique" ON public."users" ("email");

ALTER TABLE public."users" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."ranks" (
  "id" SERIAL PRIMARY KEY,
  "name" VARCHAR(80) NOT NULL,
  "description" TEXT,
  "color" VARCHAR(32) NOT NULL DEFAULT '#A9F4FF',
  "permissions" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "ranks_name_unique" ON public."ranks" ("name");

ALTER TABLE public."ranks" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."user_ranks" (
  "userId" INTEGER NOT NULL REFERENCES public."users"("id") ON DELETE CASCADE,
  "rankId" INTEGER NOT NULL REFERENCES public."ranks"("id") ON DELETE CASCADE,
  "assignedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("userId", "rankId")
);

ALTER TABLE public."user_ranks" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."discord_settings" (
  "id" INTEGER PRIMARY KEY,
  "channelId" VARCHAR(24) NOT NULL,
  "encryptedToken" TEXT NOT NULL,
  "connected" BOOLEAN NOT NULL DEFAULT FALSE,
  "lastError" TEXT,
  "checkedAt" TIMESTAMPTZ,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public."discord_settings" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."stream_state" (
  "id" INTEGER PRIMARY KEY,
  "isLive" BOOLEAN NOT NULL DEFAULT FALSE,
  "badge" VARCHAR(40) NOT NULL DEFAULT 'OFFLINE',
  "viewerCount" INTEGER NOT NULL DEFAULT 0,
  "sessionEpoch" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public."stream_state" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."attendance_sessions" (
  "id" SERIAL PRIMARY KEY,
  "userId" INTEGER NOT NULL REFERENCES public."users"("id") ON DELETE CASCADE,
  "activeUserId" INTEGER,
  "startedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "endedAt" TIMESTAMPTZ,
  "durationSeconds" INTEGER NOT NULL DEFAULT 0,
  "verifiedSeconds" INTEGER NOT NULL DEFAULT 0,
  "lastPulseAt" TIMESTAMPTZ,
  "endReason" VARCHAR(32) NOT NULL DEFAULT 'manual',
  UNIQUE ("activeUserId"),
  CHECK ("endReason" IN ('manual','stream_end'))
);

CREATE INDEX IF NOT EXISTS "attendance_user_end_idx" ON public."attendance_sessions" ("userId", "endedAt");

ALTER TABLE public."attendance_sessions" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."point_events" (
  "id" SERIAL PRIMARY KEY,
  "userId" INTEGER NOT NULL REFERENCES public."users"("id") ON DELETE CASCADE,
  "actorId" INTEGER NOT NULL REFERENCES public."users"("id"),
  "delta" INTEGER NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "points_user_date_idx" ON public."point_events" ("userId", "createdAt");

ALTER TABLE public."point_events" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."absence_requests" (
  "id" SERIAL PRIMARY KEY,
  "userId" INTEGER NOT NULL REFERENCES public."users"("id") ON DELETE CASCADE,
  "kind" VARCHAR(32) NOT NULL,
  "startDate" VARCHAR(10) NOT NULL,
  "endDate" VARCHAR(10) NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
  "reviewedBy" INTEGER REFERENCES public."users"("id"),
  "reviewedAt" TIMESTAMPTZ,
  "reviewedNote" VARCHAR(500),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ("kind" IN ('leave','excuse')),
  CHECK ("status" IN ('pending','approved','rejected'))
);

CREATE INDEX IF NOT EXISTS "absence_user_created_idx" ON public."absence_requests" ("userId", "createdAt");

ALTER TABLE public."absence_requests" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."disciplinary_actions" (
  "id" SERIAL PRIMARY KEY,
  "userId" INTEGER NOT NULL REFERENCES public."users"("id") ON DELETE CASCADE,
  "actorId" INTEGER NOT NULL REFERENCES public."users"("id"),
  "level" VARCHAR(32) NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "evidenceUrl" VARCHAR(1000),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "rescindedAt" TIMESTAMPTZ,
  "rescindedBy" INTEGER REFERENCES public."users"("id"),
  CHECK ("level" IN ('notice','warning','strike'))
);

CREATE INDEX IF NOT EXISTS "discipline_user_created_idx" ON public."disciplinary_actions" ("userId", "createdAt");

ALTER TABLE public."disciplinary_actions" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."managed_voice_rooms" (
  "id" SERIAL PRIMARY KEY,
  "channelId" VARCHAR(24) NOT NULL,
  "guildId" VARCHAR(24) NOT NULL,
  "categoryId" VARCHAR(24),
  "name" VARCHAR(80) NOT NULL,
  "userLimit" INTEGER NOT NULL DEFAULT 0,
  "locked" BOOLEAN NOT NULL DEFAULT FALSE,
  "source" VARCHAR(32) NOT NULL DEFAULT 'portal',
  "createdBy" INTEGER NOT NULL REFERENCES public."users"("id"),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "deletedAt" TIMESTAMPTZ,
  "deletedBy" INTEGER REFERENCES public."users"("id"),
  UNIQUE ("channelId"),
  CHECK ("source" IN ('portal','adopted'))
);

CREATE INDEX IF NOT EXISTS "voice_guild_idx" ON public."managed_voice_rooms" ("guildId");

ALTER TABLE public."managed_voice_rooms" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."portal_settings" (
  "id" INTEGER PRIMARY KEY,
  "pointsPerActivity" INTEGER NOT NULL DEFAULT 15,
  "elitePoints" INTEGER NOT NULL DEFAULT 150,
  "subLeaderPoints" INTEGER NOT NULL DEFAULT 400,
  "leadershipPoints" INTEGER NOT NULL DEFAULT 800,
  "attendanceTargetMinutes" INTEGER NOT NULL DEFAULT 180,
  "examPassingPercent" INTEGER NOT NULL DEFAULT 70,
  "voiceGuildId" VARCHAR(24),
  "voiceCategoryId" VARCHAR(24),
  "kickChannelSlug" VARCHAR(80) NOT NULL DEFAULT 'es_hisham',
  "discordAlertsChannelId" VARCHAR(24)
);

ALTER TABLE public."portal_settings" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."user_notifications" (
  "id" SERIAL PRIMARY KEY,
  "userId" INTEGER NOT NULL REFERENCES public."users"("id") ON DELETE CASCADE,
  "kind" VARCHAR(40) NOT NULL,
  "title" VARCHAR(150) NOT NULL,
  "message" VARCHAR(500) NOT NULL,
  "readAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "notifications_user_idx" ON public."user_notifications" ("userId", "createdAt");

ALTER TABLE public."user_notifications" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."audit_events" (
  "id" SERIAL PRIMARY KEY,
  "actorId" INTEGER REFERENCES public."users"("id"),
  "action" VARCHAR(90) NOT NULL,
  "targetType" VARCHAR(40) NOT NULL,
  "targetId" VARCHAR(80),
  "details" VARCHAR(500),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "audit_created_idx" ON public."audit_events" ("createdAt");

ALTER TABLE public."audit_events" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."incident_reports" (
  "id" SERIAL PRIMARY KEY,
  "reporterId" INTEGER NOT NULL REFERENCES public."users"("id") ON DELETE CASCADE,
  "category" VARCHAR(32) NOT NULL,
  "description" VARCHAR(2000) NOT NULL,
  "evidenceUrl" VARCHAR(1000),
  "status" VARCHAR(32) NOT NULL DEFAULT 'open',
  "reviewerId" INTEGER REFERENCES public."users"("id"),
  "response" VARCHAR(1000),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ("category" IN ('conduct','technical','appeal','other')),
  CHECK ("status" IN ('open','reviewing','resolved','rejected'))
);

CREATE INDEX IF NOT EXISTS "incident_created_idx" ON public."incident_reports" ("createdAt");

ALTER TABLE public."incident_reports" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."academy_questions" (
  "id" SERIAL PRIMARY KEY,
  "question" VARCHAR(500) NOT NULL,
  "optionsJson" TEXT NOT NULL,
  "correctIndex" INTEGER NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdBy" INTEGER NOT NULL REFERENCES public."users"("id"),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public."academy_questions" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."academy_attempts" (
  "id" SERIAL PRIMARY KEY,
  "userId" INTEGER NOT NULL REFERENCES public."users"("id") ON DELETE CASCADE,
  "score" INTEGER NOT NULL,
  "total" INTEGER NOT NULL,
  "passed" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "academy_user_idx" ON public."academy_attempts" ("userId", "createdAt");

ALTER TABLE public."academy_attempts" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."kick_event_log" (
  "messageId" VARCHAR(80) PRIMARY KEY,
  "type" VARCHAR(80) NOT NULL,
  "summary" VARCHAR(500) NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public."kick_event_log" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."login_sessions" (
  "id" VARCHAR(64) PRIMARY KEY,
  "userId" INTEGER NOT NULL REFERENCES public."users"("id") ON DELETE CASCADE,
  "userAgent" VARCHAR(300),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "revokedAt" TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS "session_user_idx" ON public."login_sessions" ("userId");

ALTER TABLE public."login_sessions" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."linked_accounts" (
  "id" SERIAL PRIMARY KEY,
  "userId" INTEGER NOT NULL REFERENCES public."users"("id") ON DELETE CASCADE,
  "provider" VARCHAR(32) NOT NULL,
  "providerUserId" VARCHAR(80) NOT NULL,
  "username" VARCHAR(100) NOT NULL,
  "encryptedAccessToken" TEXT,
  "encryptedRefreshToken" TEXT,
  "tokenExpiresAt" TIMESTAMPTZ,
  "connectedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ("provider" IN ('discord','kick'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "linked_provider_user_idx" ON public."linked_accounts" ("provider", "providerUserId");

CREATE UNIQUE INDEX IF NOT EXISTS "linked_owner_provider_idx" ON public."linked_accounts" ("userId", "provider");

ALTER TABLE public."linked_accounts" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."temporary_voice_config" (
  "id" INTEGER PRIMARY KEY,
  "enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "guildId" VARCHAR(24),
  "triggerChannelId" VARCHAR(24),
  "categoryId" VARCHAR(24),
  "defaultUserLimit" INTEGER NOT NULL DEFAULT 0,
  "maxRooms" INTEGER NOT NULL DEFAULT 20
);

ALTER TABLE public."temporary_voice_config" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."temporary_voice_rooms" (
  "channelId" VARCHAR(24) PRIMARY KEY,
  "guildId" VARCHAR(24) NOT NULL,
  "ownerDiscordId" VARCHAR(24) NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "locked" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "deletedAt" TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS "temp_voice_guild_idx" ON public."temporary_voice_rooms" ("guildId");

ALTER TABLE public."temporary_voice_rooms" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."moderation_cases" (
  "id" SERIAL PRIMARY KEY,
  "platform" VARCHAR(32) NOT NULL,
  "subject" VARCHAR(120) NOT NULL,
  "action" VARCHAR(32) NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "evidenceUrl" VARCHAR(1000),
  "actorId" INTEGER REFERENCES public."users"("id"),
  "externalEventId" VARCHAR(80),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ("platform" IN ('kick','discord','internal')),
  CHECK ("action" IN ('warn','timeout','ban','unban','delete_message','note')),
  UNIQUE ("externalEventId")
);

CREATE INDEX IF NOT EXISTS "mod_case_subject_idx" ON public."moderation_cases" ("platform", "subject");

ALTER TABLE public."moderation_cases" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."automod_rules" (
  "id" SERIAL PRIMARY KEY,
  "name" VARCHAR(80) NOT NULL,
  "platform" VARCHAR(32) NOT NULL,
  "kind" VARCHAR(32) NOT NULL,
  "pattern" VARCHAR(200) NOT NULL,
  "action" VARCHAR(32) NOT NULL DEFAULT 'alert',
  "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdBy" INTEGER NOT NULL REFERENCES public."users"("id"),
  CHECK ("platform" IN ('kick','discord')),
  CHECK ("kind" IN ('word','link','flood')),
  CHECK ("action" IN ('log','alert','delete'))
);

ALTER TABLE public."automod_rules" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."automod_hits" (
  "id" SERIAL PRIMARY KEY,
  "ruleId" INTEGER NOT NULL REFERENCES public."automod_rules"("id"),
  "eventId" VARCHAR(80) NOT NULL,
  "platform" VARCHAR(20) NOT NULL,
  "actorHash" VARCHAR(64),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "automod_dedupe_idx" ON public."automod_hits" ("ruleId", "eventId");

ALTER TABLE public."automod_hits" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."punishment_appeals" (
  "id" SERIAL PRIMARY KEY,
  "requesterId" INTEGER NOT NULL REFERENCES public."users"("id"),
  "caseId" INTEGER NOT NULL REFERENCES public."moderation_cases"("id"),
  "reason" VARCHAR(1500) NOT NULL,
  "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
  "reviewerId" INTEGER REFERENCES public."users"("id"),
  "decision" VARCHAR(1000),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "reviewedAt" TIMESTAMPTZ,
  CHECK ("status" IN ('pending','accepted','rejected'))
);

ALTER TABLE public."punishment_appeals" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."stream_samples" (
  "id" SERIAL PRIMARY KEY,
  "streamEpoch" INTEGER NOT NULL,
  "viewerCount" INTEGER NOT NULL,
  "isLive" BOOLEAN NOT NULL,
  "sampledAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "samples_epoch_date_idx" ON public."stream_samples" ("streamEpoch", "sampledAt");

ALTER TABLE public."stream_samples" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."knowledge_articles" (
  "id" SERIAL PRIMARY KEY,
  "title" VARCHAR(160) NOT NULL,
  "body" TEXT NOT NULL,
  "published" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdBy" INTEGER NOT NULL REFERENCES public."users"("id"),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public."knowledge_articles" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."staff_announcements" (
  "id" SERIAL PRIMARY KEY,
  "title" VARCHAR(160) NOT NULL,
  "body" TEXT NOT NULL,
  "createdBy" INTEGER NOT NULL REFERENCES public."users"("id"),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public."staff_announcements" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."announcement_reads" (
  "announcementId" INTEGER NOT NULL REFERENCES public."staff_announcements"("id") ON DELETE CASCADE,
  "userId" INTEGER NOT NULL REFERENCES public."users"("id") ON DELETE CASCADE,
  "readAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("announcementId", "userId")
);

ALTER TABLE public."announcement_reads" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."staff_messages" (
  "id" SERIAL PRIMARY KEY,
  "authorId" INTEGER NOT NULL REFERENCES public."users"("id"),
  "body" VARCHAR(1500) NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public."staff_messages" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."stream_bookmarks" (
  "id" SERIAL PRIMARY KEY,
  "streamEpoch" INTEGER NOT NULL,
  "label" VARCHAR(200) NOT NULL,
  "note" VARCHAR(1000),
  "createdBy" INTEGER NOT NULL REFERENCES public."users"("id"),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public."stream_bookmarks" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."automation_rules" (
  "id" SERIAL PRIMARY KEY,
  "title" VARCHAR(120) NOT NULL,
  "event" VARCHAR(32) NOT NULL,
  "action" VARCHAR(32) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdBy" INTEGER NOT NULL REFERENCES public."users"("id"),
  CHECK ("event" IN ('stream_started','stream_ended','case_created','appeal_created','voice_created','reward_pending')),
  CHECK ("action" IN ('notify_admins','discord_alert'))
);

ALTER TABLE public."automation_rules" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public."sensitive_approvals" (
  "id" SERIAL PRIMARY KEY,
  "action" VARCHAR(32) NOT NULL,
  "payload" TEXT NOT NULL,
  "requestedBy" INTEGER NOT NULL REFERENCES public."users"("id"),
  "approvedBy" INTEGER REFERENCES public."users"("id"),
  "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "resolvedAt" TIMESTAMPTZ,
  CHECK ("action" IN ('delete_adopted_voice','restore_config','rank_save_high','rank_assign_high','rank_unassign_high')),
  CHECK ("status" IN ('pending','executing','completed','rejected','failed'))
);

CREATE INDEX IF NOT EXISTS "approvals_status_idx" ON public."sensitive_approvals" ("status");

ALTER TABLE public."sensitive_approvals" ENABLE ROW LEVEL SECURITY;

COMMIT;
