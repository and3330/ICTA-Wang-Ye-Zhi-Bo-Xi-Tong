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
    CREATE TABLE users (
      id varchar PRIMARY KEY,
      is_active boolean NOT NULL DEFAULT true,
      is_super_admin boolean NOT NULL DEFAULT false,
      subscription_plan text NOT NULL DEFAULT 'free',
      subscription_status text NOT NULL DEFAULT 'inactive',
      plan_expires_at timestamp,
      max_webinars integer NOT NULL DEFAULT 0
    );
    CREATE TABLE entitlement_overrides (
      id varchar PRIMARY KEY,
      user_id varchar NOT NULL REFERENCES users(id),
      publishing_slots integer NOT NULL,
      manual_plan text,
      starts_at timestamp NOT NULL,
      expires_at timestamp NOT NULL,
      revoked_at timestamp
    );
    CREATE TABLE no_card_trials (
      user_id varchar PRIMARY KEY REFERENCES users(id),
      starts_at timestamp NOT NULL,
      expires_at timestamp NOT NULL
    );
    CREATE TABLE webinars (
      id varchar PRIMARY KEY,
      user_id varchar,
      publish_status text NOT NULL DEFAULT 'draft',
      description text
    );
    CREATE TABLE course_marketplace_listings (
      id varchar PRIMARY KEY,
      webinar_id varchar NOT NULL UNIQUE REFERENCES webinars(id),
      opted_in boolean NOT NULL DEFAULT false,
      status text NOT NULL DEFAULT 'pending',
      rejection_reason text,
      approved_at timestamp,
      reviewed_at timestamp,
      reviewed_by varchar,
      version integer NOT NULL DEFAULT 1,
      updated_at timestamp NOT NULL DEFAULT now()
    );
  `);
  const userId = "isolated-owner";
  await testPool.query(
    "INSERT INTO users (id, subscription_plan, subscription_status, plan_expires_at, max_webinars) VALUES ($1, 'growth', 'active', now() + interval '1 day', 2)",
    [userId],
  );
  const webinarIds = ["draft-1", "draft-2", "draft-3", "expired-draft"];
  for (const webinarId of webinarIds) {
    await testPool.query(
      "INSERT INTO webinars (id, user_id, publish_status, description) VALUES ($1, $2, 'draft', $3)",
      [webinarId, userId, "must be retained"],
    );
  }

  const results = await Promise.all(
    webinarIds.slice(0, 3).map((id) => claimWebinarPublicationWithinLimit(testDb, userId, id)),
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
  assert.equal(retained.rows.length, 4);
  assert.ok(retained.rows.every((row) => row.description === "must be retained"));

  const approvedWebinarId = String(results.find((result) => result.webinarId)?.webinarId);
  await testPool.query(
    `INSERT INTO course_marketplace_listings
      (id, webinar_id, opted_in, status, approved_at)
     VALUES ('approved-listing', $1, true, 'approved', now())`,
    [approvedWebinarId],
  );
  await claimWebinarPublicationWithinLimit(testDb, userId, approvedWebinarId);
  const invalidated = await testPool.query(
    "SELECT status, approved_at, version FROM course_marketplace_listings WHERE id = 'approved-listing'",
  );
  assert.deepEqual(invalidated.rows[0], { status: "pending", approved_at: null, version: 2 });

  await testPool.query("UPDATE users SET subscription_status = 'inactive', max_webinars = 0 WHERE id = $1", [userId]);
  const expiredClaim = await claimWebinarPublicationWithinLimit(testDb, userId, "expired-draft");
  assert.equal(expiredClaim.entitlementExpired, true);
  const expiredDraft = await testPool.query(
    "SELECT publish_status FROM webinars WHERE id = 'expired-draft'",
  );
  assert.equal(expiredDraft.rows[0]?.publish_status, "draft");

  const trialUserId = "isolated-trial-owner";
  await testPool.query("INSERT INTO users (id) VALUES ($1)", [trialUserId]);
  await testPool.query(
    "INSERT INTO no_card_trials (user_id, starts_at, expires_at) VALUES ($1, now() - interval '1 minute', now() + interval '14 days' - interval '1 minute')",
    [trialUserId],
  );
  await testPool.query(
    "INSERT INTO webinars (id, user_id, publish_status, description) VALUES ('trial-draft-1', $1, 'draft', 'retained'), ('trial-draft-2', $1, 'draft', 'retained')",
    [trialUserId],
  );
  const trialResults = await Promise.all([
    claimWebinarPublicationWithinLimit(testDb, trialUserId, "trial-draft-1"),
    claimWebinarPublicationWithinLimit(testDb, trialUserId, "trial-draft-2"),
  ]);
  assert.equal(trialResults.filter(result => result.webinarId).length, 1);
  assert.equal(trialResults.filter(result => result.limitExceeded).length, 1);
  assert.ok(trialResults.every(result => result.maxPublished === 1));

  const expiringUserId = "expiring-trial-owner";
  await testPool.query("INSERT INTO users (id) VALUES ($1)", [expiringUserId]);
  await testPool.query(
    "INSERT INTO no_card_trials (user_id, starts_at, expires_at) VALUES ($1, clock_timestamp() - interval '1 minute', clock_timestamp() + interval '300 milliseconds')",
    [expiringUserId],
  );
  await testPool.query(
    "INSERT INTO webinars (id, user_id, publish_status, description) VALUES ('expiring-trial-draft', $1, 'draft', 'retained')",
    [expiringUserId],
  );
  const lockClient = await testPool.connect();
  try {
    await lockClient.query("BEGIN");
    await lockClient.query("SELECT pg_advisory_xact_lock(hashtext($1))", [expiringUserId]);
    const blockedClaim = claimWebinarPublicationWithinLimit(testDb, expiringUserId, "expiring-trial-draft");
    await new Promise(resolve => setTimeout(resolve, 500));
    await lockClient.query("COMMIT");
    const result = await blockedClaim;
    assert.equal(result.entitlementExpired, true, "expiry is checked after waiting for the publication lock");
    const retainedExpiredDraft = await testPool.query(
      "SELECT publish_status FROM webinars WHERE id = 'expiring-trial-draft'",
    );
    assert.equal(retainedExpiredDraft.rows[0]?.publish_status, "draft");
  } finally {
    await lockClient.query("ROLLBACK").catch(() => undefined);
    lockClient.release();
  }
});