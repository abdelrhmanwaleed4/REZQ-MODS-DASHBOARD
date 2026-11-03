import type { CookieOptions, Request } from "express";

export function getSessionCookieOptions(_req: Request): CookieOptions {
  // Session cookie is first-party and HTTP-only on our HTTPS Vercel origin.
  return { httpOnly: true, path: "/", sameSite: "lax", secure: true };
}
