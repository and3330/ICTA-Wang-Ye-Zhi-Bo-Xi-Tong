import type { NextFunction, Request, RequestHandler, Response } from "express";
import pg from "pg";

type LockClient = {
  query(query: string): Promise<unknown>;
  release(error?: Error | boolean): void;
};

export type MediaLockConnector = {
  connect(): Promise<LockClient>;
};

const coordinationPool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS || 5_000),
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30_000),
  maxUses: Number(process.env.DB_CONNECTION_MAX_USES || 7_500),
  // This pool is intentionally independent from the application query pool.
  // Keeping it eligible for event-loop exit also prevents idle test processes
  // from being retained without ending the production pool.
  allowExitOnIdle: true,
});

const LOCK_SQL = "SELECT pg_advisory_lock(hashtext('global-media-reference-write-v1'))";
const UNLOCK_SQL = "SELECT pg_advisory_unlock(hashtext('global-media-reference-write-v1'))";

/**
 * Builds a process-FIFO, cross-instance media-reference lock. Only the head of
 * the local queue consumes the dedicated coordination connection.
 */
export function createMediaReferenceLock(connector: MediaLockConnector) {
  let queueTail: Promise<void> = Promise.resolve();

  return function withLock(handler: RequestHandler): RequestHandler {
    return async (req: Request, res: Response, next: NextFunction) => {
      let leaveQueue!: () => void;
      const predecessor = queueTail;
      queueTail = new Promise<void>(resolve => {
        leaveQueue = resolve;
      });

      await predecessor;
      let client: LockClient | undefined;
      let acquired = false;
      try {
        client = await connector.connect();
        await client.query("SET lock_timeout = '10s'");
        await client.query(LOCK_SQL);
        acquired = true;

        // The lock lifetime follows the returned Promise, not finish/close.
        // A disconnected response must not expose partially completed writes
        // to a competing media deletion.
        await handler(req, res, next);
      } catch (error) {
        if (!acquired) {
          if (!res.headersSent) {
            res.status(503).json({ message: "Media is busy. Please try again." });
            return;
          }
        }
        throw error;
      } finally {
        if (client) {
          try {
            if (acquired) await client.query(UNLOCK_SQL);
            await client.query("RESET lock_timeout");
          } catch {
            // Releasing a broken client destroys it below. The database drops
            // session advisory locks when that connection closes.
            client.release(true);
            client = undefined;
          } finally {
            client?.release();
          }
        }
        leaveQueue();
      }
    };
  };
}

export const withMediaReferenceLock = createMediaReferenceLock(coordinationPool);