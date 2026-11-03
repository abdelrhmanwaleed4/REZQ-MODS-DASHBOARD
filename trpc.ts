import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from "@shared/const";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { PermissionId } from "../permissions";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({ transformer: superjson });

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async ({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  if (ctx.user.mfaRequired) throw new TRPCError({ code: "FORBIDDEN", message: "Authenticator verification required." });
  if (ctx.user.status !== "approved") throw new TRPCError({ code: "FORBIDDEN", message: "Account approval is required." });
  return next({ ctx: { ...ctx, user: ctx.user } });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = protectedProcedure.use(t.middleware(async ({ ctx, next }) => {
  if (!ctx.user || ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
  return next({ ctx: { ...ctx, user: ctx.user } });
}));

export const permissionProcedure = (permission: PermissionId) => protectedProcedure.use(
  t.middleware(async ({ ctx, next }) => {
    if (!ctx.user || (ctx.user.role !== "admin" && !ctx.user.permissions.includes(permission))) {
      throw new TRPCError({ code: "FORBIDDEN", message: `Missing permission: ${permission}` });
    }
    return next({ ctx: { ...ctx, user: ctx.user } });
  }),
);
