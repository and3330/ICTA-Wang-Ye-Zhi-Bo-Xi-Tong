import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createServer } from "node:http";
import { db } from "./db";
import { postgresRateLimit } from "./rateLimit";
import { registerRoutes } from "./routes";
import { storage } from "./storage";
import { isTokenExpired } from "./security";

test("PostgreSQL limiter permits in-window requests and returns 429 with Retry-After", async () => {
  const originalExecute = db.execute;
  const expiresAt = new Date(Date.now() + 9_000);
  const counts = [1, 3];
  (db as any).execute = async () => ({ rows: [{ request_count: counts.shift(), expires_at: expiresAt }] });
  try {
    const limiter = postgresRateLimit({ namespace: "unit", limit: 2, windowSeconds: 10 });
    let calledNext = false;
    const allowed: any = {
      session: { userId: "user-1" }, ip: "127.0.0.1", socket: {},
    };
    await limiter(allowed, {} as any, () => { calledNext = true; });
    assert.equal(calledNext, true);

    const headers = new Map<string, string>();
    let responseStatus: number | undefined;
    let responseBody: unknown;
    const blockedResponse: any = {
      setHeader: (key: string, value: string) => headers.set(key, value),
      status: (status: number) => {
        responseStatus = status;
        return { json: (body: unknown) => { responseBody = body; } };
      },
    };
    await limiter(allowed, blockedResponse, () => assert.fail("blocked request must not call next"));
    assert.equal(responseStatus, 429);
    assert.match(headers.get("Retry-After") || "", /^[1-9]\d*$/);
    assert.deepEqual(responseBody, { message: "Too many requests. Please try again later." });
  } finally {
    (db as any).execute = originalExecute;
  }
});

test("support input schema limits content and support API requires authentication", async (t) => {
  const originalExecute = db.execute;
  (db as any).execute = async () => ({ rows: [{ request_count: 1, expires_at: new Date(Date.now() + 60_000) }] });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.header("x-test-user-id");
    (req as any).session = userId ? { userId } : {};
    next();
  });
  const server = createServer(app);
  await registerRoutes(server, app, undefined, { startScheduler: () => {} });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    (db as any).execute = originalExecute;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const anonymous = await fetch(`${baseUrl}/api/support`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject: "Help", message: "Need help" }),
  });
  assert.equal(anonymous.status, 401);

  // This is authenticated, but schema validation rejects an invalid empty subject before storage.
  const invalid = await fetch(`${baseUrl}/api/support`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-user-id": "support-user" },
    body: JSON.stringify({ category: "bad", subject: "", message: "Need help" }),
  });
  assert.equal(invalid.status, 400);
});

test("token expiry boundary is inclusive for one-time storage consumption", () => {
  const now = new Date("2030-01-01T00:00:00.000Z");
  assert.equal(isTokenExpired(new Date("2029-12-31T23:59:59.999Z"), now), true);
  assert.equal(isTokenExpired(new Date("2030-01-01T00:00:00.000Z"), now), true);
  assert.equal(isTokenExpired(new Date("2030-01-01T00:00:00.001Z"), now), false);
});

test("forgot-password gives identical generic responses for known and unknown email", async (t) => {
  const originalExecute = db.execute;
  const originalGetUserByEmail = storage.getUserByEmail;
  const originalLatest = storage.getLatestAuthTokenCreatedAt;
  (db as any).execute = async () => ({ rows: [{ request_count: 1, expires_at: new Date(Date.now() + 60_000) }] });
  storage.getUserByEmail = async (email) => email === "known@example.test"
    ? ({ id: "known-user", email, emailVerificationRequired: true } as any) : undefined;
  // A current token prevents delivery, keeping this test completely offline.
  storage.getLatestAuthTokenCreatedAt = async () => new Date();

  const app = express();
  app.use(express.json());
  const server = createServer(app);
  await registerRoutes(server, app, undefined, { startScheduler: () => {} });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    (db as any).execute = originalExecute;
    storage.getUserByEmail = originalGetUserByEmail;
    storage.getLatestAuthTokenCreatedAt = originalLatest;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  const request = (email: string) => fetch(`${baseUrl}/api/admin/forgot-password`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }),
  });
  const known = await request("known@example.test");
  const unknown = await request("unknown@example.test");
  assert.equal(known.status, 200);
  assert.equal(unknown.status, 200);
  assert.deepEqual(await known.json(), await unknown.json());
});