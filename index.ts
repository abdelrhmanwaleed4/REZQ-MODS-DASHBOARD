/** Optional persistent Node entrypoint, NOT invoked by the Vercel deployment. */
import "dotenv/config";
import { createServer } from "node:http";
import { createHttpApp } from "./httpApp";
import { serveStatic, setupVite } from "./vite";
import { startDiscordPolling } from "../discord";
import { startDiscordVoiceGateway } from "../tempVoice";
import { startKickPolling } from "../kickApi";

async function startServer() {
  const app = createHttpApp();
  const server = createServer(app);
  if (process.env.NODE_ENV === "development") await setupVite(app, server);
  else serveStatic(app);
  if (process.env.RUN_PERSISTENT_WORKERS === "1") {
    startDiscordPolling();
    startDiscordVoiceGateway();
    startKickPolling();
  }
  const port = Number(process.env.PORT || "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
  server.on("error", error => { console.error("Server failed:", error.message); process.exit(1); });
  server.listen(port, "0.0.0.0", () => console.log(`REZK Express listening on port ${port}`));
}
startServer().catch(error => { console.error(error); process.exit(1); });
