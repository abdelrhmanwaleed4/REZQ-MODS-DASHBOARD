import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { readAuthSnapshot, type SafeUser } from "./appAuth";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: SafeUser | null;
  sessionRevokedReason: "stream-ended" | "banned" | "session-revoked" | null;
};

export async function createContext(opts: CreateExpressContextOptions): Promise<TrpcContext> {
  const auth = await readAuthSnapshot(opts.req, opts.res);
  return { req: opts.req, res: opts.res, user: auth.user, sessionRevokedReason: auth.sessionRevokedReason };
}
