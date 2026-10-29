import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createServer } from "node:http";
import { EMBED_FRAME_ANCESTORS, embedFramePolicy } from "./embedFramePolicy";

test("embed HTML frame allowlist is narrow and preserves other security headers", async t => {
  const app = express();
  app.use((req, res, next) => {
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    if (req.query.existing) res.setHeader("Content-Security-Policy", "default-src 'self'; frame-ancestors 'self'; object-src 'none'");
    next();
  });
  app.use(embedFramePolicy);
  app.get("/oauth/consent", (_req, res) => {
    res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
    res.setHeader("X-Frame-Options", "DENY");
    res.type("html").send("<!doctype html><title>Consent</title>");
  });
  // Equivalent to the real SPA fallback: middleware must reach the HTML reply.
  app.use((_req, res) => res.type("html").send("<!doctype html><div id='root'></div>"));
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  for (const path of ["/embed/register/id", "/embed/webinar/id", "/embed/register/id/", "/embed/webinar/id/subpath"]) {
    const response = await fetch(base + path);
    assert.equal(response.headers.get("content-security-policy"), `frame-ancestors ${EMBED_FRAME_ANCESTORS}`);
    assert.equal(response.headers.get("x-frame-options"), null);
    assert.match(response.headers.get("content-type")!, /text\/html/);
    assert.match(await response.text(), /id='root'/);
  }
  for (const path of ["/", "/form/id", "/register/id", "/embed/other", "/embed/register", "/embed/register-evil/id", "/embed/webinar-evil/id", "/livecast-widget.js", "/api/registrations"]) {
    const response = await fetch(base + path);
    assert.equal(response.headers.get("content-security-policy"), "frame-ancestors 'self'", path);
    assert.equal(response.headers.get("x-frame-options"), "SAMEORIGIN", path);
  }
  const existing = await fetch(`${base}/embed/register/id?existing=1`);
  assert.equal(existing.headers.get("content-security-policy"), `default-src 'self'; object-src 'none'; frame-ancestors ${EMBED_FRAME_ANCESTORS}`);
  const unchanged = await fetch(`${base}/form/id?existing=1`);
  assert.equal(unchanged.headers.get("content-security-policy"), "default-src 'self'; frame-ancestors 'self'; object-src 'none'");
  assert.equal(unchanged.headers.get("x-frame-options"), "SAMEORIGIN");
  const consent = await fetch(`${base}/oauth/consent`);
  assert.equal(consent.headers.get("content-security-policy"), "frame-ancestors 'none'");
  assert.equal(consent.headers.get("x-frame-options"), "DENY");
});

test("real registration endpoint accepts an anonymous cookie-free iframe submission", async t => {
  const crypto = await import("node:crypto");
  const { db, pool } = await import("./db");
  const { registerRoutes } = await import("./routes");
  const { eq } = await import("drizzle-orm");
  const schema = await import("../shared/schema");
  const { externalJourneySettingsSchema } = await import("../shared/externalJourneys");
  const ownerId = crypto.randomUUID(), webinarId = crypto.randomUUID();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).session = {}; next(); });
  const server = createServer(app);
  t.after(async () => {
    try {
      await new Promise<void>(resolve => server.close(() => resolve()));
      await db.delete(schema.emailReminders).where(eq(schema.emailReminders.webinarId, webinarId));
      await db.delete(schema.webinarFunnelEvents).where(eq(schema.webinarFunnelEvents.webinarId, webinarId));
      await db.delete(schema.registrationIdentityKeys).where(eq(schema.registrationIdentityKeys.webinarId, webinarId));
      await db.delete(schema.registrations).where(eq(schema.registrations.webinarId, webinarId));
      await db.delete(schema.externalJourneySettings).where(eq(schema.externalJourneySettings.webinarId, webinarId));
      await db.delete(schema.webinars).where(eq(schema.webinars.id, webinarId));
      await db.delete(schema.users).where(eq(schema.users.id, ownerId));
    } finally { await pool.end(); }
  });
  await db.insert(schema.users).values({
    id: ownerId, username: `embed-cookie-test-${ownerId}`, password: "not-a-login-hash", subscriptionPlan: "enterprise",
  });
  await db.insert(schema.webinars).values({
    id: webinarId, userId: ownerId, title: "Isolated cookie-free embed test", vimeoUrl: "",
    startTime: new Date(Date.now() + 86_400_000), publishStatus: "published",
    scheduleMode: { recurring: false, onDemand: true, justInTime: false, justInTimeMinutes: 15 },
    // Do not create mail jobs that the separately running worker could claim.
    emailSettings: { confirmationEnabled: false, reminder24hEnabled: false, reminder1hEnabled: false, followUpEnabled: false, customSubject: "", customTemplate: "" },
  });
  const settings = externalJourneySettingsSchema.parse({ landingMode: "external", landingUrl: "https://noncodingai.com" });
  await db.insert(schema.externalJourneySettings).values({ webinarId, settings, publishedSettings: settings });
  await registerRoutes(server, app, undefined, { startScheduler: () => {}, refreshEntitlement: async () => { throw new Error("Test must not call Stripe"); } });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const response = await fetch(`http://127.0.0.1:${address.port}/api/registrations`, {
    method: "POST", credentials: "omit",
    headers: { "Content-Type": "application/json", Origin: "https://noncodingai.com" },
    body: JSON.stringify({ webinarId, name: "Anonymous iframe test", email: `embed-${webinarId}@example.test`, phone: "0912345678" }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, body.message || "Registration should accept no cookie");
  assert.equal(body.webinarId, webinarId);
  assert.ok(body.id);
  assert.ok(body.watchToken, "Viewer access is returned in the response rather than requiring a cookie");
  assert.equal(response.headers.get("set-cookie"), null);
});
