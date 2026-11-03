/** Supabase PostgreSQL connection for short-lived Vercel Functions.
 * Use the Supabase transaction pooler URL, not a MySQL connection string.
 * No database credentials are ever included in the browser bundle.
 */
import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../drizzle/schema";

let pool: Pool | undefined;
let database: NodePgDatabase<typeof schema> | undefined;

export function getPostgresDb() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;
  if (!database) {
    const parsed = new URL(connectionString);
    if (!/^postgres(?:ql)?:$/.test(parsed.protocol)) throw new Error("DATABASE_URL must be a PostgreSQL URL from Supabase");
    const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    pool = new Pool({
      connectionString,
      max: 1,
      idleTimeoutMillis: 15_000,
      connectionTimeoutMillis: 10_000,
      ssl: local ? false : { rejectUnauthorized: true },
    });
    pool.on("error", error => console.error("[Postgres] idle connection error", error.message));
    database = drizzle(pool, { schema });
  }
  return database;
}
