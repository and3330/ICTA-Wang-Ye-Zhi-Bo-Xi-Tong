import type { Express } from "express";
import { eq, sql } from "drizzle-orm";
import { db } from "./db";
import { users } from "@shared/schema";
import {
  inFlightOperationCount,
  isAcceptingWork,
  schedulerMetrics,
} from "./operationsRuntime";

const READINESS_TIMEOUT_MS = 2_000;
let stripeReady = process.env.NODE_ENV !== "production";

export function setStripeReady(ready: boolean): void {
  stripeReady = ready;
}

async function databaseReady(): Promise<boolean> {
  try {
    await Promise.race([
      db.execute(sql`select 1`),
      new Promise((_, reject) => setTimeout(() => reject(new Error("database readiness timeout")), READINESS_TIMEOUT_MS)),
    ]);
    return true;
  } catch {
    return false;
  }
}

export async function businessOperationMetrics() {
  const result = await db.execute(sql`
    SELECT
      COALESCE((SELECT EXTRACT(EPOCH FROM (now() - MIN(scheduled_for)))
        FROM email_reminders WHERE status = 'pending' AND scheduled_for <= now()), 0)::bigint
        AS email_queue_oldest_age_seconds,
      (SELECT COUNT(*) FROM email_reminders
        WHERE status = 'failed' AND attempt_count >= 5)::bigint AS email_exhausted_jobs,
      COALESCE((SELECT EXTRACT(EPOCH FROM (now() - MIN(next_attempt_at)))
        FROM webhook_deliveries
        WHERE status IN ('pending', 'retry') AND next_attempt_at <= now()), 0)::bigint
        AS callback_queue_oldest_age_seconds,
      (SELECT COUNT(*) FROM webhook_deliveries WHERE status = 'failed')::bigint
        AS callback_failures
  `);
  const row = result.rows[0] as Record<string, string | number | null>;
  return {
    emailQueueOldestAgeSeconds: Number(row?.email_queue_oldest_age_seconds ?? 0),
    emailExhaustedJobs: Number(row?.email_exhausted_jobs ?? 0),
    callbackQueueOldestAgeSeconds: Number(row?.callback_queue_oldest_age_seconds ?? 0),
    callbackFailures: Number(row?.callback_failures ?? 0),
    scheduler: schedulerMetrics(),
    inFlightOperations: inFlightOperationCount(),
  };
}

export function registerOperationsHealth(app: Express): void {
  app.get("/health/live", (_req, res) => res.json({ status: "ok" }));
  app.get("/health/ready", async (_req, res) => {
    const database = await databaseReady();
    const ready = database && stripeReady && isAcceptingWork();
    res.status(ready ? 200 : 503).json({
      status: ready ? "ready" : "not_ready",
      dependencies: { database, stripe: stripeReady },
      acceptingWork: isAcceptingWork(),
    });
  });
  app.get("/health/operations", async (req, res) => {
    try {
      const userId = req.session?.userId;
      if (!userId) return res.status(401).json({ status: "unauthorized" });
      const [user] = await db.select({ isSuperAdmin: users.isSuperAdmin })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!user?.isSuperAdmin) return res.status(403).json({ status: "forbidden" });
      res.json({ status: "ok", ...(await businessOperationMetrics()) });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });
}