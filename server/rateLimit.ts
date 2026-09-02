import type { RequestHandler } from "express";
import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "./db";

export type RateLimitOptions = { namespace: string; limit: number; windowSeconds: number };

export function postgresRateLimit(options: RateLimitOptions): RequestHandler {
  return async (req, res, next) => {
    try {
      const identity = req.session?.userId || req.ip || req.socket.remoteAddress || "unknown";
      const digest = crypto.createHash("sha256").update(identity).digest("hex");
      const key = `${options.namespace}:${digest}`;
      const result = await db.execute(sql`
        INSERT INTO rate_limit_buckets ("key", window_started_at, request_count, expires_at)
        VALUES (${key}, now(), 1, now() + (${options.windowSeconds} * interval '1 second'))
        ON CONFLICT ("key") DO UPDATE SET
          request_count = CASE WHEN rate_limit_buckets.expires_at <= now() THEN 1 ELSE rate_limit_buckets.request_count + 1 END,
          window_started_at = CASE WHEN rate_limit_buckets.expires_at <= now() THEN now() ELSE rate_limit_buckets.window_started_at END,
          expires_at = CASE WHEN rate_limit_buckets.expires_at <= now()
            THEN now() + (${options.windowSeconds} * interval '1 second') ELSE rate_limit_buckets.expires_at END
        RETURNING request_count, expires_at
      `);
      const row = result.rows[0] as { request_count: number; expires_at: Date | string };
      if (Number(row.request_count) > options.limit) {
        const retryAfter = Math.max(1, Math.ceil((new Date(row.expires_at).getTime() - Date.now()) / 1000));
        res.setHeader("Retry-After", String(retryAfter));
        return res.status(429).json({ message: "Too many requests. Please try again later." });
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}