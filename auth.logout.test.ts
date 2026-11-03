import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { APP_SESSION_COOKIE } from "./_core/appAuth";
import type { TrpcContext } from "./_core/context";

type CookieCall = {
  name: string;
  options: Record<string, unknown>;
};

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): { ctx: TrpcContext; clearedCookies: CookieCall[] } {
  const clearedCookies: CookieCall[] = [];

  const user: AuthenticatedUser = {
    id: 1,
    email: "sample@example.com",
    name: "Sample User",
    loginMethod: "google",
    role: "user",
    status: "approved",
    createdAt: new Date(),
    lastSignedIn: new Date(),
    permissions: [],
    ranks: [],
    sessionId: "00000000000000000000000000000000",
    mfaEnabled: false,
    mfaRequired: false,
  };

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    sessionRevokedReason: null,
    res: {
      clearCookie: (name: string, options: Record<string, unknown>) => {
        clearedCookies.push({ name, options });
      },
    } as TrpcContext["res"],
  };

  return { ctx, clearedCookies };
}

describe("auth.logout", () => {
  it("clears the session cookie and reports success", async () => {
    const { ctx, clearedCookies } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.auth.logout();

    expect(result).toEqual({ success: true });
    expect(clearedCookies).toHaveLength(1);
    expect(clearedCookies[0]?.name).toBe(APP_SESSION_COOKIE);
    expect(clearedCookies[0]?.options).toMatchObject({
      maxAge: 0,
      secure: true,
      sameSite: "lax",
      httpOnly: true,
      path: "/",
    });
  });
});
