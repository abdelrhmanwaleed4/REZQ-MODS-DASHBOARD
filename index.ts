/** Vercel Node.js Function; handles all /api/* paths via vercel.json rewrites. */
import { createHttpApp } from "../server/_core/httpApp";
const app = createHttpApp();
export default app;
