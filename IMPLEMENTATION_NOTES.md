# Kick REZK MODS | Staff operations upgrade

## Added modules
- Attendance: manual website check-in/out, unique active session per member, auto-close on trusted LIVE→OFFLINE transitions, 12-hour per-session cap. **This does not verify Kick or Discord activity.**
- Points: append-only task ledger with actor/reason; default UI offers +15 points per task, admin-only negative corrections, no self-awards. Calculated milestones: 150 Elite Staff, 400 Sub-Leader, 800 higher leadership. **Milestones do not automatically grant security roles.**
- Daily excuses and leave requests (max 30 days) with server-side admin approval/rejection and review notes.
- Disciplinary log with notices, warnings, strikes, evidence URLs and recorded rescission instead of deletion.
- Qatar-timezone weekly/monthly performance reports, team classification (main/reserve), historical periods and UTF-8 CSV export.
- Server-side checks for all new mutations and read scopes; delegated rank manager privilege escalation blocked for create/edit/assign/unassign.

## Deploy/migrate
1. Back up MySQL before changing schema. Keep `.env` and Discord secrets off Git/chat. No secrets are shipped in this ZIP.
2. From project root, install dependencies with `pnpm install --frozen-lockfile` using Node.js 22+ and pnpm 10.
3. Set `DATABASE_URL`, `APP_SESSION_SECRET`, `PUBLIC_APP_ORIGIN`, Google OAuth keys and `DISCORD_TOKEN_ENCRYPTION_KEY` on the **server** as described by Manus. Do not add them to client code.
4. Run `pnpm db:migrate` before launching the new server. Migration `0002_staff_operations.sql` adds new tables and `users.team`. **Do not run a full database reset.**
5. Run `pnpm check`, `pnpm test`, and `pnpm build` in a connected Node environment, then run `pnpm start`.
6. In the Ranks screen, grant `manageAttendance`, `managePoints`, `manageLeaves`, `manageDiscipline`, `viewReports` selectively. Existing ranks do not gain these new rights automatically. Admin has full rights.
7. Set main/reserve from Users (admin-only). Existing members start as reserve by default; manually assign main team members.

## Security/quality notes
- No actual production/database credentials were available to test Google OAuth or Discord API connectivity. This archive is source code, not a deployed/live system.
- Validating live hours in Kick/Discord requires an authenticated integration capable of verifying actual platform activities, which is intentionally not pretended here.
- Reports count sessions by check-out time. Approved leave requests overlapping a report window are counted as *requests*, not days. Current reports show at most 12 historical periods.
- Attendance history is capped at 250 recent entries; points ledger at 100; leave and disciplinary logs at 200. Totals in points are computed from the complete ledger.
- Permissions apply on the server, including mutations; UI navigation visibility is supplementary, not access control.

## QA performed in offline handoff environment
- Verified TS / TSX syntax of modified source files with the TypeScript 5.9 parser.
- Executed 11 isolated logic checks: permission boundaries, point milestones, date validation, Qatar week start, and prior-month boundaries. All passed.
- A full `pnpm check`, Vitest integration suite, `pnpm build`, and database / OAuth / Discord end-to-end verification could not run here because this container has no project dependencies, MySQL or live API credentials. Run them before production; there is no honest basis to claim bug-free or production-tested operation yet.
