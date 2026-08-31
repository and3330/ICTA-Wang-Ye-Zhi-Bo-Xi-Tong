import assert from "node:assert/strict";
import test from "node:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";
import { claimWebinarPublicationWithinLimit } from "./storage";

test("concurrent publishing never exceeds the subscription quota and retains content", async (t) => {
  assert.equal(
    process.env.NODE_ENV,
    "test",
    "Database integration tests refuse to run outside NODE_ENV=test",
  );
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required for the PostgreSQL integration test");
  const schemaName = `quota_test_${process.pid}_${Date.now()}`;
  const adminPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
  const testPool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    options: `-c search_path=${schemaName}`,
  });
  const testDb = drizzle(testPool, { schema });

  t.after(async () => {
    await testPool.end();
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await adminPool.end();
  });

  await testPool.query(`
    CREATE TABLE webinars (
      id varchar PRIMARY KEY,
      user_id varchar,
      publish_status text NOT NULL DEFAULT 'draft',
      description text
    )
  `);
  const userId = "isolated-owner";
  const webinarIds = ["draft-1", "draft-2", "draft-3"];
  for (const webinarId of webinarIds) {
    await testPool.query(
      "INSERT INTO webinars (id, user_id, publish_status, description) VALUES ($1, $2, 'draft', $3)",
      [webinarId, userId, "must be retained"],
    );
  }

  const results = await Promise.all(
    webinarIds.map((id) => claimWebinarPublicationWithinLimit(testDb, userId, id, 2)),
  );

  assert.equal(results.filter((result) => result.webinarId).length, 2);
  assert.equal(results.filter((result) => result.limitExceeded).length, 1);
  const published = await testDb.execute(sql`
    SELECT count(*)::int AS count
    FROM webinars
    WHERE user_id = ${userId} AND publish_status = 'published'
  `);
  assert.equal(published.rows[0]?.count, 2);
  const retained = await testPool.query(
    "SELECT description FROM webinars WHERE user_id = $1 ORDER BY id",
    [userId],
  );
  assert.equal(retained.rows.length, 3);
  assert.ok(retained.rows.every((row) => row.description === "must be retained"));
});