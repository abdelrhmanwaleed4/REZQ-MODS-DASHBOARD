# REZK MODS | Advanced Operations & Discord Voice Upgrade

## Requested exclusions
- No new **daily task assignment** system.
- No new **shift scheduling / standby roster** system.
- Existing base-version `team` (main/reserve) field remains for backwards-compatible reports, but there is no automatic shift assignment.

## New pages and working server endpoints

| Path | What was added | Access |
|---|---|---|
| `/voice` | Discord-managed voice creation, administrator-adoption of existing rooms, renaming, capacity, lock/unlock and deletion | Read: approved; operations controlled by `createVoiceRooms`, `manageVoiceRooms`, `deleteVoiceRooms` independently |
| `/kick` | Operations center, live state, signed Kick events and website check-ins | `viewReports` |
| `/performance` | Weighted weekly/monthly scoreboard and personal moderator profile | Approved members; other people's private profile data requires management permission |
| `/incidents` | Confidential incident forms, evidence links, triage and resolution | Own submissions or `manageReports` |
| `/academy` | Moderator quiz, secure server scoring, attempt history and question bank | Approved members; question editor requires `manageAcademy` |
| `/notifications` | Member-specific notifications, unread count and read controls | Own account only |
| `/security` | Login session listing/revocation and opt-in admin TOTP | Own account; TOTP is admin only |
| `/audit` | Actor/time/target audit history | `viewAudit` |
| `/settings` | Default points, promotion levels, attendance target, pass threshold, Kick slug | Administrator only |

### Voice safety / Discord API prerequisites
1. Use the existing **Discord** page to save an actual bot token and a readable status channel. Make sure `DISCORD_TOKEN_ENCRYPTION_KEY` is a **32-byte base64 value** kept only in the server's secrets.
2. Give the bot **Manage Channels** to create, rename and delete channels, plus **Manage Roles** if you want room lock/unlock.
3. In `/voice`, as administrator, choose the Discord server and the voice category **from dropdowns**, then save. Set an optional text channel for Discord staff alerts. The bot must already be in that server. Admins may also **explicitly adopt** an existing voice room from that category, with a separate confirmation that delegated role holders can subsequently delete it.
4. In `/ranks`, delegate the three *separate* website permissions. **They do not change Discord's native role permissions.** The website performs the operation using the server-side bot only after checking the account's website role permissions.
5. Delete operates **only on tracked voice channels: created by the website or explicitly adopted by an administrator**. Other existing Discord rooms cannot be deleted from this portal. There is an explicit confirmation. Discord channel deletion cannot be undone and disconnects people currently inside it.
6. No gateway/client voice state connection is implemented; this feature manages channels over Discord REST. It does **not** claim to track Discord speaker activity or automatically generate temporary rooms on voice join.

### Kick direct integration
- Official signed webhook endpoint: `POST https://YOUR_PRODUCTION_DOMAIN/api/kick/webhook`.
- Webhook uses raw-body signature validation and the official Kick RSA public key; timestamps outside 5 minutes, replays and events for other channel slugs are rejected/ignored. Only limited non-chat summaries are retained.
- After deployment, register the public webhook URL in the **Kick Developer** application and enable webhooks. For an automated subscription request using **app access token**, set these **server-side** secrets:
  - `KICK_CLIENT_ID`
  - `KICK_CLIENT_SECRET`
  - `KICK_BROADCASTER_USER_ID` (numeric Kick streamer identifier, **not** a Discord ID)
  - `KICK_WEBHOOK_PRIORITY=1` to prevent the old Discord status poller from overwriting the signed Kick live/offline state.
- On `/kick`, admin clicks **Subscribe Kick Events** after configuration. This requests livestream status, metadata and moderation-ban events from Kick. An app may need relevant authorization/approval; production delivery depends on Kick and your public endpoint.
- The API also attempts a read-only viewer-count refresh once per minute if Kick credentials are present. A missing/failed API result never forcibly marks a stream offline.
- Performing bans, removing messages, tying a moderator's Kick identity to their portal account or guaranteeing their actual live moderation presence requires **separate user-authorized Kick OAuth scopes and account identity linking**. These capabilities are **not** implemented or misrepresented as available.

### Attendance and scoring: transparent limitations
- Check-in is available only while LIVE is reported. In the browser, an authenticated presence pulse is sent every 30 seconds **only when the page is visible**. The server caps each pulse credit at 45 seconds and uses conditional DB writes to reduce double counting. Background/inactive tabs do not continue earning unlimited time.
- This is **website foreground presence**, not evidence of active moderation on Kick, nor verified Discord call hours. The original wall-clock `durationSeconds` is retained; new `verifiedSeconds` is used for new dashboard reporting. Old attendance records may show zero verified minutes (no retroactive assertion).
- Performance score is capped at 100: up to 40 for presence vs configured target, up to 35 for points vs configured threshold, up to 25 for no active disciplinary warnings/strikes. It is a planning aid, not a reliable independent evaluation of moderation performance.
- Promotion thresholds calculate eligibility only; they **never auto-grant privileged site ranks**. Crossing a threshold creates an in-site notification and attempts a Discord staff alert when configured.

### Security and sessions
- The site now uses session IDs persisted in `login_sessions` and checks revocation on requests. **Existing pre-upgrade JWT cookies will no longer validate**, so members need to log in again after deployment.
- Admin TOTP is opt-in from `/security`, using RFC 6238-style six-digit codes. New login sessions require a valid TOTP if enabled. The current bootstrap admin email is now read from `INITIAL_ADMIN_EMAIL` server environment variable rather than shipped in public code; preserve/set it **before first installation** if bootstrapping the original admin account. Existing admin database roles remain.
- TOTP secrets are encrypted with a key derived from `APP_SESSION_SECRET`. Changing this key invalidates stored TOTP secrets and all sessions, so maintain encrypted backups and an operator recovery plan. In-memory failed-code throttling must be complemented by a shared rate limiter/load-balancer policy on multi-instance hosting.
- Incident reports are private by database queries; never use unaudited frontend-only restrictions for sensitive access. Audit records contain only actor, action, target and brief reason; secrets are never deliberately logged.

## Installation (important)
1. **Back up MySQL** and the server-only secrets, including a tested restore procedure.
2. Node 22+, pnpm 10. Run `pnpm install --frozen-lockfile` (if lockfile version mismatch, update lockfile in a controlled development environment).
3. Set `DATABASE_URL`, `APP_SESSION_SECRET`, `PUBLIC_APP_ORIGIN`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `DISCORD_TOKEN_ENCRYPTION_KEY`, and if needed `INITIAL_ADMIN_EMAIL` on your hosting provider. Optionally add Kick credentials above.
4. Apply the **existing** `0000`, `0001`, `0002` migrations if installing fresh; if upgrading from previous ZIP, apply **only pending** `0003_portal_features.sql` through `pnpm db:migrate`. **Never reset the database.** Verify migration status before deploying a rolling release.
5. Run `pnpm check`, `pnpm test`, `pnpm build` and `pnpm start` before publishing. Test with a real development database, test Discord server and Kick app.
6. Re-login and configure the voice server/category in `/voice`. Grant only the website permissions required. Test standard-member vs delegated-manager access, and TOTP recovery, before broad rollout.

## Validation completed in this handoff
- Complete JS/TS/TSX parser pass across source and test files: successful.
- Isolated cryptographic/scoring smoke checks: see `newFeatures.test.ts` for permanent Vitest regression cases.
- **Not completed**: a full dependency install/build/typecheck, MySQL migration against live data, Discord REST end-to-end actions, Kick OAuth/webhook delivery, and browser integration tests. No credentials, MySQL server or accessible full dependency installation were provided in this handoff environment. This is a development upgrade, not a claim that every integration has been production-tested.

All four original uploaded images in `client/public/branding` are preserved without re-encoding, redrawing or cropping.
