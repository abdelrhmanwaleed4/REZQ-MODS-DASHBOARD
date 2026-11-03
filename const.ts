/** The current app uses Supabase Auth (Google/email), not Manus login. */
export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
export function startLogin() { window.location.assign("/login"); }
