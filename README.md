# REZK MODS V3 · Vercel + Supabase

Converted from the earlier MySQL + long-running Express deployment to a Vite frontend,
Vercel Node.js API Function, Supabase PostgreSQL and Supabase Auth (Google/email).

**Start with [DEPLOY_VERCEL_SUPABASE_AR.md](DEPLOY_VERCEL_SUPABASE_AR.md)** for the complete Arabic setup instructions, environment variables, security precautions and limitations.

## Quick setup

1. Create a fresh Supabase project and execute `supabase/001_schema.sql` in the Supabase SQL Editor.
2. Configure Supabase Auth (email and optionally Google). For Google the redirect URI is
   `https://PROJECT_REF.supabase.co/auth/v1/callback`.
3. Add all variables from `.env.example` in Vercel Project Settings, replacing placeholders.
4. Import the repository to Vercel, choose Vite, Node 22, `npm install`,
   `npm run build:static`, and output `dist/public`.
5. Test `/api/health`, `/login`, a verified admin account and a newly registered pending account.

Local commands: `npm install`, `npm run dev`, `npm run check`, `npm test`, `npm run build:static`.

**Important limitations:** The Discord Gateway, Join-to-Create instant room events,
Discord realtime AutoMod and background polling require an independent always-on
worker. They cannot run constantly on Vercel Functions; the rest of the normal HTTP
features are prepared for Vercel. Existing MySQL data is **not** migrated automatically.

The code migration has undergone syntax and static schema inspections, but a complete
production build and integrations need to be tested after dependencies are installed.
