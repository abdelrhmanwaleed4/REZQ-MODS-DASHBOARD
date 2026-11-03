# Implementation outcomes

## [ ] Google and email authentication with protected sessions
Implement real Google sign-in and email/password sign-in; do not simulate authenticated users. Maintain secure sessions, sign-out, and protected routes. The initial administrator is `abdelrhmanwaleed5004@gmail.com` and must be promoted only after Google confirms that exact address as verified; never promote an unverified email/password claim. Sign-in activation is waiting for protected environment values for Google OAuth and the application session key.

## [ ] Approval waiting screen and access gate
Show newly registered non-admin accounts a waiting-for-approval screen until an admin grants access. Keep unapproved accounts out of protected management pages, and reflect approval changes after they take effect. End-to-end use depends on the real-auth secrets above.

## [ ] Secure admin-only Discord configuration
Provide an admin-only form for a Discord bot token and channel ID. Mask any saved token, never return it to the browser after submission, and protect it server-side. Validate the channel ID and verify bot credentials before saving or reporting the integration connected. The bot token is encrypted server-side in the managed database using an AES-256-GCM key supplied only to the server environment; the token itself is entered through the requested settings form and never exposed to the frontend. End-to-end saving waits for the encryption key and a bot token/channel.

## [ ] Live bot badge and viewer count
Read bot status server-side from the configured Discord channel and update the badge and viewer count live, showing connected, reconnecting, or offline status. Because no existing bot message format was supplied, initially accept a JSON status message containing `badge` and numeric `viewerCount` fields, for example `{"badge":"LIVE","viewerCount":128}`; adjust if the owner supplies the actual message format. A connected bot token and the environment encryption key are required to verify live updates.

## [x] Rank management and role permissions
Add a “Manage Ranks” permission in the Ranks section. Allow users with that permission to create/edit ranks and their permissions, and assign or remove ranks (roles) for approved users. Enforce permissions server-side, not only in the interface. Delegated rank managers may only grant permissions they already hold, cannot assign/remove ranks for themselves, and cannot delete ranks; rank deletion remains administrator-only to prevent self-escalation and lockouts.

## [x] Kick stream link
Place a link to `https://kick.com/es_hisham` at the top of the interface beside the live-stream notification.

## [ ] Stream-end logout
Automatically invalidate every active site session when a live-to-offline stream transition is reported, and return signed-out users to the real sign-in page. The app expects an explicit offline bot update such as `{"badge":"OFFLINE","viewerCount":0}` or `{"isLive":false,"viewerCount":0}`; verify against the bot’s actual message format when available.

## [x] Permanent user bans
Allow authorized administrators to permanently ban a user from site access; deny subsequent email or Google sign-ins, terminate that user’s existing sessions, and enforce the ban on protected endpoints. Do not allow an administrator to ban their own or another administrator account from the user-management screen.
