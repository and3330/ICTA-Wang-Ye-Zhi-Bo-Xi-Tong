import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import { sql } from "drizzle-orm";
import { issueAuthToken } from "./storage";

test("concurrent auth token issuance leaves exactly one active token", async (t) => {
  assert.equal(process.env.NODE_ENV, "test", "integration test refuses non-test execution");
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required for PostgreSQL integration testing");
  const schemaName = `auth_token_test_${process.pid}_${Date.now()}`;
  const adminPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const testPool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    options: `-c search_path=${schemaName}`,
  });
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
  const testDb = drizzle(testPool, { schema });
  t.after(async () => {
    await testPool.end();
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await adminPool.end();
  });
  await testPool.query(`
    CREATE TABLE users (id varchar PRIMARY KEY);
    CREATE TABLE auth_tokens (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(), user_id varchar NOT NULL REFERENCES users(id),
      purpose text NOT NULL, token_hash text NOT NULL UNIQUE, expires_at timestamp NOT NULL,
      consumed_at timestamp, created_at timestamp NOT NULL DEFAULT now()
    );
  `);
  const userId = "temporary-auth-user";
  await testPool.query("INSERT INTO users (id) VALUES ($1)", [userId]);
  const expiry = new Date(Date.now() + 60_000);
  await Promise.all([
    issueAuthToken(testDb as any, userId, "password_reset", "a".repeat(64), expiry),
    issueAuthToken(testDb as any, userId, "password_reset", "b".repeat(64), expiry),
  ]);
  const result = await testDb.execute(sql`
    SELECT count(*) FILTER (WHERE consumed_at IS NULL)::int AS active,
           count(*)::int AS total
    FROM auth_tokens
    WHERE user_id = ${userId} AND purpose = 'password_reset'
  `);
  assert.equal(result.rows[0]?.total, 2);
  assert.equal(result.rows[0]?.active, 1);
});