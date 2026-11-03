/** Express API entrypoint shared by Vercel Functions and a normal Node server.
 * Do not start websocket gateways, intervals, or long-running jobs in a Function.
 */
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { registerKickEvents } from "../kickEvents";
import { registerAccountLinks } from "../accountLinks";
import { registerAppAuthRoutes, guardSameOriginMutation } from "./appAuth";

export function createHttpApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  // Vercel rewrites /api/* to one Function and passes the original suffix in a
  // reserved query parameter. Restore it before Express matches routes,
  // including the raw Kick webhook handler and tRPC endpoints.
  app.use((req, res, next) => {
    const url = new URL(req.url, "http://local.internal");
    const forwarded = url.searchParams.get("__rezk_route");
    if (forwarded === null) return next(); // Direct Node.js development server.
    if (!forwarded || forwarded.length > 1000 || !/^[a-zA-Z0-9_.,\/-]+$/.test(forwarded) || forwarded.startsWith("/")) {
      return res.status(404).json({ message: "Unknown API route" });
    }
    url.searchParams.delete("__rezk_route");
    // Vercel also exposes rewrite variables as query params; don't forward it
    // into application-level input validation by accident.
    url.searchParams.delete("path");
    req.url = `/api/${forwarded}${url.search}`;
    return next();
  });
  // Kick requires the ORIGINAL signed raw request body; it must register first.
  registerKickEvents(app);
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ limit: "64kb", extended: false }));
  app.get("/api/health", (_req, res) => res.set("Cache-Control", "no-store").json({ status: "ok", backend: "vercel-supabase" }));
  app.use("/api/auth", guardSameOriginMutation);
  registerAppAuthRoutes(app);
  registerAccountLinks(app);
  app.use("/api/trpc", guardSameOriginMutation);
  app.use("/api/trpc", (_req, res, next) => { res.setHeader("Cache-Control", "no-store, private"); next(); });
  app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext }));
  return app;
}
