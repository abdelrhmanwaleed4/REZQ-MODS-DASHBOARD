import { describe, expect, it } from "vitest";
import { publicPlatformScript } from "./_core/publicConfig";
import { getPostgresDb } from "./db-driver";
import { publicOrigin, readAuthSnapshot } from "./_core/appAuth";

// Conversion regression tests intentionally need no live Supabase or Discord tokens.
describe("Vercel + Supabase integration boundaries", () => {
  it("never serializes database or OAuth secrets to browser script", () => {
    const script = publicPlatformScript();
    expect(script).not.toContain("DATABASE_URL");
    expect(script).not.toContain("CLIENT_SECRET");
    expect(script).not.toContain("service_role");
  });
  it("returns null when no database has been configured", () => {
    const existing = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try { expect(getPostgresDb()).toBeNull(); }
    finally { if (existing !== undefined) process.env.DATABASE_URL = existing; }
  });
  it("requires a signed portal session cookie", async () => {
    const result = await readAuthSnapshot({ headers: {} } as never, { clearCookie: () => undefined } as never);
    expect(result).toEqual({ user: null, sessionRevokedReason: null });
  });
  it("uses an explicitly configured public origin", () => {
    const old = process.env.PUBLIC_APP_ORIGIN;
    const oldVercelEnv = process.env.VERCEL_ENV;
    process.env.PUBLIC_APP_ORIGIN = "https://rezk.example";
    delete process.env.VERCEL_ENV;
    try { expect(publicOrigin()).toBe("https://rezk.example"); }
    finally { if (old === undefined) delete process.env.PUBLIC_APP_ORIGIN; else process.env.PUBLIC_APP_ORIGIN = old;
      if (oldVercelEnv === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = oldVercelEnv; }
  });
});
