import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import * as schema from "@shared/schema";
import path from "path";

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX || 10),
  connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS || 5_000),
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30_000),
  maxUses: Number(process.env.DB_CONNECTION_MAX_USES || 7_500),
  allowExitOnIdle: false,
});

export const db = drizzle(pool, { schema });

export async function runAppMigrations() {
  // Publish applies the production schema independently of Drizzle's journal.
  // Replaying SQL here can collide with already-published constraints.
  if (process.env.NODE_ENV === "production") return;
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "migrations") });
}
