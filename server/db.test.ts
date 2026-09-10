import assert from "node:assert/strict";
import test from "node:test";
import { pool, runAppMigrations } from "./db";

test("production never replays application migrations after Publish applies the schema", async (t) => {
  const previousEnvironment = process.env.NODE_ENV;
  let databaseCalls = 0;
  t.mock.method(pool, "query", async () => {
    databaseCalls++;
    throw new Error("Production migration must not query the database");
  });
  t.mock.method(pool, "connect", async () => {
    databaseCalls++;
    throw new Error("Production migration must not acquire a database connection");
  });

  try {
    process.env.NODE_ENV = "production";
    await runAppMigrations();
    assert.equal(databaseCalls, 0);
  } finally {
    if (previousEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnvironment;
  }
});