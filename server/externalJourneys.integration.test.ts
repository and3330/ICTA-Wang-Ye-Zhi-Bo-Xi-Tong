import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import dns from "node:dns/promises";
import express from "express";
import { createServer } from "node:http";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool } from "./db";
import { externalThankYouForRegistration, registerExternalJourneyRoutes } from "./externalJourneys";
import { createWatchToken } from "./watchTokens";
import {
  ctaButtons, externalHandoffs, externalJourneySettings, externalOrderEvents,
  externalOrders, externalReferrals, memberIntegrationSecrets, registrations,
  registrationIdentityKeys, users, webinars, webinarSessions,
} from "@shared/schema";

// This is deliberately a database-backed, local-HTTP fixture. It creates only
// UUID-scoped rows and uses a local entitlement stub, so it makes no provider,
// email, or external network calls. Run after migrations 0025 and 0026.
test("external journeys: published boundaries, attribution, signed receipts, and scoped aggregates", async (t) => {
  assert.notEqual(process.env.NODE_ENV, "production");
  if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = `external-journeys-test-${crypto.randomUUID()}`;

  const suffix = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const otherId = crypto.randomUUID();
  const rootId = crypto.randomUUID();
  const webinarId = crypto.randomUUID();
  const secondWebinarId = crypto.randomUUID();
  const otherWebinarId = crypto.randomUUID();
  const ctaId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const registrationId = crypto.randomUUID();
  const isolatedRegistrationId = crypto.randomUUID();
  const isolatedSessionId = crypto.randomUUID();
  t.mock.method(dns, "lookup", async (hostname: string) => {
    if (hostname === "journey.example.test" || hostname === "embed.example.test") {
      return [{ address: "93.184.216.34", family: 4 }];
    }
    if (hostname === "evil.example.test") return [{ address: "127.0.0.1", family: 4 }];
    throw new Error(`Unexpected fixture DNS host: ${hostname}`);
  });
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));
  app.use((req, _res, next) => {
    const userId = req.header("x-test-user");
    (req as any).session = userId ? { userId } : {};
    next();
  });
  // The fixture's synthetic active owners are entitled without invoking Stripe.
  registerExternalJourneyRoutes(app, async () => true);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;

  async function request(path: string, options: {
    method?: string; actor?: string; body?: unknown; headers?: Record<string, string>; redirect?: RequestRedirect;
  } = {}) {
    const { method = "GET", actor, body, headers = {}, redirect } = options;
    return fetch(`${base}${path}`, {
      method,
      redirect,
      headers: {
        ...(actor ? { "x-test-user": actor } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    });
  }
  async function responseJson(response: Response, expected = 200): Promise<any> {
    const value = await response.json();
    assert.equal(response.status, expected, JSON.stringify(value));
    return value;
  }
  async function merchant(webinar: string, secret: string, event: Record<string, unknown>, timestamp = Math.floor(Date.now() / 1000)) {
    const raw = JSON.stringify(event);
    const signature = crypto.createHmac("sha256", secret).update(`${timestamp}.`).update(raw).digest("hex");
    return request(`/api/external/merchant-events/${webinar}`, {
      method: "POST",
      body: raw,
      headers: { "x-external-timestamp": String(timestamp), "x-external-signature": signature },
    });
  }

  t.after(async () => {
    try {
      await new Promise<void>(resolve => server.close(() => resolve()));
      await db.delete(externalOrderEvents).where(inArray(externalOrderEvents.webinarId, [webinarId, secondWebinarId, otherWebinarId]));
      await db.delete(externalOrders).where(inArray(externalOrders.webinarId, [webinarId, secondWebinarId, otherWebinarId]));
      await db.delete(externalHandoffs).where(inArray(externalHandoffs.webinarId, [webinarId, secondWebinarId, otherWebinarId]));
      await db.delete(externalReferrals).where(inArray(externalReferrals.webinarId, [webinarId, secondWebinarId, otherWebinarId]));
      await db.delete(externalJourneySettings).where(inArray(externalJourneySettings.webinarId, [webinarId, secondWebinarId, otherWebinarId]));
      await db.delete(ctaButtons).where(eq(ctaButtons.webinarId, webinarId));
      await db.delete(registrationIdentityKeys).where(eq(registrationIdentityKeys.registrationId, registrationId));
      await db.delete(registrations).where(inArray(registrations.id, [registrationId, isolatedRegistrationId]));
      await db.delete(webinarSessions).where(inArray(webinarSessions.id, [sessionId, isolatedSessionId]));
      await db.delete(webinars).where(inArray(webinars.id, [webinarId, secondWebinarId, otherWebinarId]));
      await db.delete(memberIntegrationSecrets).where(inArray(memberIntegrationSecrets.userId, [ownerId, otherId, rootId]));
      await db.delete(users).where(inArray(users.id, [ownerId, otherId, rootId]));
    } finally {
      await pool.end();
    }
  });

  await db.insert(users).values([
    { id: ownerId, username: `external-owner-${suffix}`, password: "test", email: `owner-${suffix}@example.test`, isActive: true },
    { id: otherId, username: `external-other-${suffix}`, password: "test", email: `other-${suffix}@example.test`, isActive: true },
    { id: rootId, username: `external-root-${suffix}`, password: "test", email: `root-${suffix}@example.test`, isActive: true, isSuperAdmin: true },
  ]);
  await db.insert(webinars).values([
    { id: webinarId, userId: ownerId, title: "External fixture", vimeoUrl: "https://vimeo.com/1", startTime: new Date(), publishStatus: "published" },
    { id: secondWebinarId, userId: ownerId, title: "Scoped fixture", vimeoUrl: "https://vimeo.com/2", startTime: new Date(), publishStatus: "published" },
    { id: otherWebinarId, userId: otherId, title: "Other fixture", vimeoUrl: "https://vimeo.com/3", startTime: new Date(), publishStatus: "published" },
  ]);
  await db.insert(webinarSessions).values({ id: sessionId, webinarId, scheduledStart: new Date("2030-01-01T10:00:00.000Z") });
  await db.insert(registrations).values({
    id: registrationId, webinarId, name: "External fixture attendee", email: `attendee-${suffix}@example.test`,
    selectedSession: new Date("2030-01-01T10:00:00.000Z"),
  });
  const targetUrl = "https://journey.example.test/buy?campaign=fixture";
  await db.insert(ctaButtons).values({
    id: ctaId, webinarId, text: "Buy", url: targetUrl, startTime: 0, ctaKey: `external-${suffix}`,
  });

  const publishedSettings = {
    landingMode: "external" as const, landingUrl: "https://journey.example.test/register",
    thankYouMode: "external" as const, thankYouUrl: "https://journey.example.test/thanks",
    approvedOrigins: ["https://journey.example.test"], approvedEmbedOrigins: ["https://embed.example.test"],
    secureHandoffEnabled: true, includeWatchLinkInHandoff: true, includeContactInHandoff: true,
  };

  await t.test("drafts do not alter public redirects, URLs are safe, and member ownership has no root bypass", async () => {
    assert.equal((await request(`/api/webinars/${webinarId}/external-journey/public`)).status, 200);
    const beforePublish = await request(`/join/${webinarId}`, { redirect: "manual" });
    assert.equal(beforePublish.headers.get("location"), `/form/${webinarId}`);
    const saved = await responseJson(await request(`/api/webinars/${webinarId}/external-journey`, {
      method: "PUT", actor: ownerId, body: { version: 1, settings: publishedSettings },
    }), 201);
    assert.equal(saved.version, 1);
    assert.equal((await request(`/join/${webinarId}`, { redirect: "manual" })).headers.get("location"), `/form/${webinarId}`);
    await responseJson(await request(`/api/webinars/${webinarId}/external-journey/publish`, {
      method: "POST", actor: ownerId, body: { version: 1 },
    }));
    const publicSettings = await responseJson(await request(`/api/webinars/${webinarId}/external-journey/public`));
    assert.equal(publicSettings.landingUrl, publishedSettings.landingUrl);
    assert.equal((await request(`/register/${webinarId}`, { redirect: "manual" })).headers.get("location"), publishedSettings.landingUrl);
    assert.equal((await request(`/api/webinars/${webinarId}/external-journey`, { actor: otherId })).status, 404);
    assert.equal((await request(`/api/webinars/${webinarId}/external-journey`, { actor: rootId })).status, 404);
    assert.equal((await request(`/api/webinars/${webinarId}/external-journey`, {
      method: "PUT", actor: ownerId, body: { version: 1, settings: { ...publishedSettings, landingUrl: "https://127.0.0.1/join" } },
    })).status, 400);
    assert.equal((await request(`/api/webinars/${webinarId}/external-journey`, {
      method: "PUT", actor: ownerId, body: { version: 1, settings: { ...publishedSettings, landingUrl: "https://evil.example.test/register" } },
    })).status, 400, "a hostname resolving to loopback must be rejected");
  });

  await t.test("mapped private destinations cannot be saved, published, or redirected from legacy snapshots", async () => {
    try {
      for (const landingUrl of [
        "https://[::ffff:127.0.0.1]/register",
        "https://[::ffff:a9fe:a9fe]/register",
      ]) {
        const unsafeSettings = { ...publishedSettings, landingUrl };
        assert.equal((await request(`/api/webinars/${webinarId}/external-journey`, {
          method: "PUT", actor: ownerId, body: { version: 1, settings: unsafeSettings },
        })).status, 400);
        // Simulate drafts and snapshots stored before the validation fix.
        await db.update(externalJourneySettings).set({
          settings: unsafeSettings, publishedSettings: unsafeSettings,
        }).where(eq(externalJourneySettings.webinarId, webinarId));
        assert.equal((await request(`/api/webinars/${webinarId}/external-journey/publish`, {
          method: "POST", actor: ownerId, body: { version: 1 },
        })).status, 400);
        for (const path of ["/join", "/register"]) {
          const response = await request(`${path}/${webinarId}`, { redirect: "manual" });
          assert.equal(response.status, 500);
          assert.equal(response.headers.get("location"), null);
        }
      }
    } finally {
      await db.update(externalJourneySettings).set({
        settings: publishedSettings, publishedSettings,
      }).where(eq(externalJourneySettings.webinarId, webinarId));
    }
  });

  let firstSecret = "";
  let currentSecret = "";
  await t.test("ephemeral connection keys rotate and status never reveals them", async () => {
    const initial = await responseJson(await request("/api/member/external-journeys/connection", { actor: ownerId }));
    assert.deepEqual({ connected: initial.connected, version: initial.version }, { connected: false, version: null });
    const rotated = await responseJson(await request("/api/member/external-journeys/connection/rotate", { method: "POST", actor: ownerId }), 201);
    firstSecret = rotated.secret;
    assert.match(firstSecret, /^[A-Za-z0-9_-]{24,128}$/);
    const status = await responseJson(await request("/api/member/external-journeys/connection", { actor: ownerId }));
    assert.equal(status.connected, true);
    assert.equal(JSON.stringify(status).includes(firstSecret), false);
    currentSecret = (await responseJson(await request("/api/member/external-journeys/connection/rotate", { method: "POST", actor: ownerId }), 201)).secret;
    assert.notEqual(currentSecret, firstSecret);
    assert.equal((await responseJson(await request("/api/member/external-journeys/connection", { actor: ownerId }))).version, 2);
  });

  let referral: any;
  await t.test("published CTA referrals enforce target/session and browser CORS", async () => {
    assert.equal((await request(`/api/webinars/${webinarId}/external-referrals`, {
      method: "POST", body: { targetKind: "cta", ctaId, targetUrl, sessionId: crypto.randomUUID() },
    })).status, 403);
    referral = await responseJson(await request(`/api/webinars/${webinarId}/external-referrals`, {
      method: "POST", body: { targetKind: "cta", ctaId, targetUrl, sessionId },
    }), 201);
    const redirect = await request(referral.redirectUrl, { redirect: "manual" });
    assert.match(redirect.headers.get("location") || "", new RegExp(`sc_ref=${referral.scRef}`));
    assert.equal((await request("/api/external/reported", {
      method: "POST", body: { scRef: referral.scRef, orderId: "browser-poison", amountMinor: 99, currency: "USD" },
      headers: { origin: "https://not-approved.example.test" },
    })).status, 403);
    const accepted = await request("/api/external/reported", {
      method: "POST", body: { scRef: referral.scRef, orderId: "browser-poison", amountMinor: 99, currency: "USD" },
      headers: { origin: "https://journey.example.test" },
    });
    assert.equal(accepted.status, 201);
    assert.equal(accepted.headers.get("access-control-allow-origin"), "https://journey.example.test");
    assert.deepEqual(await accepted.json(), { accepted: true, unverified: true, replayed: false });
  });

  await t.test("merchant HMAC covers exact raw bytes, timestamps, and idempotency payloads", async () => {
    const valid = { eventId: "merchant-browser-replacement", orderId: "browser-poison", type: "purchase", amountMinor: 1200, currency: "TWD", scRef: referral.scRef };
    assert.equal((await merchant(webinarId, currentSecret, valid, Math.floor(Date.now() / 1000) - 600)).status, 401);
    assert.equal((await request(`/api/external/merchant-events/${webinarId}`, {
      method: "POST", body: JSON.stringify(valid), headers: { "x-external-timestamp": String(Math.floor(Date.now() / 1000)), "x-external-signature": "0".repeat(64) },
    })).status, 401);
    assert.equal((await merchant(webinarId, currentSecret, valid)).status, 201);
    assert.equal((await merchant(webinarId, currentSecret, valid)).status, 200);
    assert.equal((await merchant(webinarId, currentSecret, { ...valid, amountMinor: 1300 })).status, 409);
    const orders: any = await responseJson(await request("/api/member/external-orders?currency=TWD", { actor: ownerId }));
    const replacement = orders.items.find((item: any) => item.orderId === "browser-poison");
    assert.deepEqual(
      { trust: replacement.sourceTrust, currency: replacement.currency, gross: replacement.grossPaidMinor, session: replacement.sessionId },
      { trust: "merchant_reported", currency: "TWD", gross: 1200, session: sessionId },
      "a browser claim cannot poison a later merchant aggregate",
    );
  });

  await t.test("refund-first orders stay unresolved and cumulative refunds never make net negative", async () => {
    assert.equal((await merchant(webinarId, currentSecret, { eventId: "refund-first", orderId: "refund-first", type: "refund", amountMinor: 1000, currency: "TWD" })).status, 201);
    let orders: any = await responseJson(await request("/api/member/external-orders?q=refund-first", { actor: ownerId }));
    assert.deepEqual(
      { gross: orders.items[0].grossPaidMinor, net: orders.items[0].netMinor, observed: orders.items[0].purchaseObserved },
      { gross: null, net: null, observed: false },
    );
    await merchant(webinarId, currentSecret, { eventId: "purchase-after-refund", orderId: "refund-first", type: "purchase", amountMinor: 1000, currency: "TWD" });
    await merchant(webinarId, currentSecret, { eventId: "purchase-2000", orderId: "cumulative", type: "purchase", amountMinor: 2000, currency: "TWD" });
    await merchant(webinarId, currentSecret, { eventId: "refund-300", orderId: "cumulative", type: "refund", amountMinor: 300, currency: "TWD" });
    await merchant(webinarId, currentSecret, { eventId: "refund-full", orderId: "cumulative", type: "refund", amountMinor: 2000, currency: "TWD" });
    orders = await responseJson(await request("/api/member/external-orders?q=cumulative", { actor: ownerId }));
    assert.deepEqual(
      { gross: orders.items[0].grossPaidMinor, refunded: orders.items[0].refundedMinor, net: orders.items[0].netMinor },
      { gross: 2000, refunded: 2000, net: 0 },
    );
  });

  await t.test("paid-only revenue: spoof/tamper/tenant failures, order-level idempotency, status transitions and test exclusion", async () => {
    const tracked = await responseJson(await request(`/api/webinars/${webinarId}/external-referrals`, {
      method: "POST", body: { targetKind: "cta", ctaId, targetUrl },
      headers: { "x-watch-token": createWatchToken(registrationId, webinarId, Date.now() + 60_000) },
    }), 201);
    const [trackedRow] = await db.select().from(externalReferrals).where(eq(externalReferrals.id, tracked.referralId));
    assert.equal(trackedRow.registrationId, registrationId);
    assert.equal(trackedRow.sessionId, sessionId);
    assert.equal(trackedRow.sessionProvenance, "registered_watch_token");
    assert.equal(trackedRow.tokenHash, crypto.createHash("sha256").update(tracked.scRef).digest("hex"));
    const redirect = await request(tracked.redirectUrl, { redirect: "manual" });
    assert.equal(redirect.status, 302);
    const target = new URL(redirect.headers.get("location")!);
    assert.equal(target.searchParams.get("sc_ref"), tracked.scRef);
    assert.equal(target.searchParams.has("email"), false);
    assert.equal(target.searchParams.has("watchToken"), false);
    const payload = { webinarId, eventId: "status-pending", orderId: "status-order", status: "pending", amountMinor: 1500, currency: "USD" };
    assert.equal((await merchant(webinarId, currentSecret, payload)).status, 201);
    let page = await responseJson(await request("/api/member/external-orders?q=status-order", { actor: ownerId }));
    assert.equal(page.items[0].purchaseObserved, false);
    assert.equal(page.items[0].netMinor, null);
    assert.equal(page.items[0].paymentStatus, "pending");
    assert.equal((await merchant(webinarId, currentSecret, { ...payload, eventId: "status-failed", status: "failed" })).status, 201);
    page = await responseJson(await request("/api/member/external-orders?q=status-order", { actor: ownerId }));
    assert.equal(page.items[0].paymentStatus, "failed");
    assert.equal(page.items[0].grossPaidMinor, null);
    const paid = { ...payload, eventId: "status-paid", status: "paid" };
    assert.equal((await merchant(webinarId, currentSecret, paid)).status, 201);
    assert.equal((await merchant(webinarId, currentSecret, paid)).status, 200);
    const duplicates = await Promise.all(["duplicate-paid-a", "duplicate-paid-b"].map(eventId => merchant(webinarId, currentSecret, { ...paid, eventId })));
    assert.ok(duplicates.every(r => r.status === 201));
    for (const response of duplicates) assert.equal((await response.json() as any).orderDeduplicated, true);
    assert.equal((await merchant(webinarId, currentSecret, { ...paid, eventId: "paid-wrong-amount", amountMinor: 1700 })).status, 409);
    // Fresh signatures on retry headers are allowed; mutation under an old signature is not.
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = crypto.createHmac("sha256", currentSecret).update(`${timestamp}.${JSON.stringify(paid)}`).digest("hex");
    const tampered = await request(`/api/external/merchant-events/${webinarId}`, {
      method: "POST", body: { ...paid, amountMinor: 9000 },
      headers: { "x-external-timestamp": timestamp, "x-external-signature": signature },
    });
    assert.equal(tampered.status, 401);
    assert.equal((await merchant(otherWebinarId, currentSecret, paid)).status, 401);
    assert.equal((await merchant(secondWebinarId, currentSecret, paid)).status, 403, "signed webinar binding prevents same-owner path substitution");
    assert.equal((await merchant(secondWebinarId, currentSecret, { ...paid, webinarId: secondWebinarId })).status, 409, "an event instance cannot be reused across webinars");
    assert.equal((await merchant(webinarId, currentSecret, { ...paid, eventId: "foreign-referral", scRef: crypto.randomBytes(32).toString("base64url") })).status, 403);
    await merchant(webinarId, currentSecret, { ...payload, eventId: "late-pending", status: "pending" });
    page = await responseJson(await request("/api/member/external-orders?q=status-order", { actor: ownerId }));
    assert.equal(page.items[0].grossPaidMinor, 1500);
    assert.equal(page.items[0].paymentStatus, "paid", "late pending cannot downgrade a paid order");
    const refund = { ...payload, eventId: "status-refund-part", status: "refunded", amountMinor: 400 };
    await merchant(webinarId, currentSecret, refund);
    await merchant(webinarId, currentSecret, { ...refund, eventId: "same-cumulative-refund" });
    page = await responseJson(await request("/api/member/external-orders?q=status-order", { actor: ownerId }));
    assert.equal(page.items[0].netMinor, 1100);
    assert.equal(page.items[0].paymentStatus, "partially_refunded");
    await merchant(webinarId, currentSecret, { ...refund, eventId: "status-refund-full", amountMinor: 1500 });
    page = await responseJson(await request("/api/member/external-orders?q=status-order", { actor: ownerId }));
    assert.equal(page.items[0].netMinor, 0);
    assert.equal(page.items[0].paymentStatus, "refunded");
    const before = await responseJson(await request("/api/member/external-orders/summary?currency=USD", { actor: ownerId }));
    await merchant(webinarId, currentSecret, { ...paid, eventId: "isolated-test-paid", orderId: `TEST-${suffix}`, amountMinor: 999999, isTest: true });
    const after = await responseJson(await request("/api/member/external-orders/summary?currency=USD", { actor: ownerId }));
    assert.deepEqual(after, before, "test revenue never enters production-style summary");
    assert.equal((await responseJson(await request(`/api/member/external-orders?q=TEST-${suffix}`, { actor: ownerId }))).total, 0);
    const [testOrder] = await db.select().from(externalOrders).where(eq(externalOrders.orderId, `TEST-${suffix}`));
    assert.equal(testOrder.isTest, true);
    assert.equal(testOrder.grossPaidMinor, 999999, "test receipt is persisted separately, not silently discarded");
  });
  await t.test("first paid race: ten concurrent events transition one pending order and book its amount once", async () => {
    const orderId = `TEST-first-paid-race-${suffix}`;
    const pending = { webinarId, orderId, eventId: `race-pending-${suffix}`,
      status: "pending", amountMinor: 1500, currency: "USD", isTest: true };
    const summaryBefore = await responseJson(await request("/api/member/external-orders/summary?currency=USD", { actor: ownerId }));
    assert.equal((await merchant(webinarId, currentSecret, pending)).status, 201);
    const condition = and(eq(externalOrders.ownerId, ownerId), eq(externalOrders.webinarId, webinarId), eq(externalOrders.orderId, orderId));
    const [before] = await db.select().from(externalOrders).where(condition);
    assert.equal(before.purchaseObserved, false);
    assert.equal(before.paymentStatus, "pending");
    assert.equal(before.grossPaidMinor, 0);
    // There is deliberately no successful paid call before this Promise.all.
    const events = Array.from({ length: 10 }, (_, i) => ({
      webinarId, orderId, eventId: `first-paid-${suffix}-${i}`, amountMinor: 1500, currency: "USD", isTest: true,
      ...(i % 2 === 0 ? { status: "paid" } : { type: "purchase" }),
    }));
    const responses = await Promise.all(events.map(event => merchant(webinarId, currentSecret, event)));
    const receipts = await Promise.all(responses.map(response => responseJson(response, 201)));
    assert.equal(receipts.filter(receipt => receipt.orderDeduplicated === false).length, 1);
    assert.equal(receipts.filter(receipt => receipt.orderDeduplicated === true).length, 9);
    const orders = await db.select().from(externalOrders).where(condition);
    assert.equal(orders.length, 1);
    assert.equal(orders[0].purchaseObserved, true);
    assert.equal(orders[0].paymentStatus, "paid");
    assert.equal(orders[0].grossPaidMinor, 1500, "ten first-paid events must not book 15000");
    assert.equal(orders[0].netMinor, 1500);
    const savedEvents = await db.select().from(externalOrderEvents).where(and(
      eq(externalOrderEvents.ownerId, ownerId), eq(externalOrderEvents.webinarId, webinarId),
      eq(externalOrderEvents.orderId, orderId), eq(externalOrderEvents.eventType, "purchase")));
    assert.equal(savedEvents.length, 10);
    assert.equal(new Set(savedEvents.map(event => event.eventId)).size, 10);
    assert.ok(savedEvents.every(event => event.isTest));
    assert.deepEqual(await responseJson(await request("/api/member/external-orders/summary?currency=USD", { actor: ownerId })), summaryBefore);
  });
  await t.test("timestamp boundaries use an exact frozen server clock for the five-minute window", async clockTest => {
    const nowMs = Math.floor(Date.now() / 1000) * 1000;
    clockTest.mock.method(Date, "now", () => nowMs);
    for (const [offset, expected] of [[-300, 201], [300, 201], [-301, 401], [301, 401]]) {
      await clockTest.test(`timestamp ${offset >= 0 ? "+" : ""}${offset}s returns HTTP ${expected}`, async () => {
        const event = { webinarId, orderId: `TEST-clock-${suffix}-${offset}`, eventId: `clock-${suffix}-${offset}`,
          status: "paid", amountMinor: 1500, currency: "USD", isTest: true };
        const response = await merchant(webinarId, currentSecret, event, nowMs / 1000 + offset);
        assert.equal(response.status, expected);
        if (expected === 401) assert.equal((await response.json() as any).message, "Invalid signature timestamp");
        const rows = await db.select().from(externalOrders).where(eq(externalOrders.orderId, event.orderId));
        assert.equal(rows.length, expected === 201 ? 1 : 0);
      });
    }
  });
  // Server fixtures bypass only referral admission, not merchant verification.
  // No existing webinar, CTA URL or approvedOrigins value is changed.
  const fixtureScRef = crypto.randomBytes(32).toString("base64url");
  const otherWebinarScRef = crypto.randomBytes(32).toString("base64url");
  const otherOwnerScRef = crypto.randomBytes(32).toString("base64url");
  const fixtureOrder = {
    webinarId: secondWebinarId, eventId: `fixture-paid-${suffix}`, orderId: `TEST-scRef-${suffix}`,
    status: "paid", amountMinor: 1500, currency: "USD", scRef: fixtureScRef, isTest: true,
  };
  let fixtureReferralId: string;
  await t.test("server-created opaque scRef binds registration/session and accepts signed paid with empty approvedOrigins", async () => {
    const before = await responseJson(await request(`/api/webinars/${secondWebinarId}/external-journey/public`));
    assert.deepEqual(before.approvedOrigins, []);
    await db.insert(webinarSessions).values({ id: isolatedSessionId, webinarId: secondWebinarId, scheduledStart: new Date("2030-01-02T10:00:00Z") });
    await db.insert(registrations).values({ id: isolatedRegistrationId, webinarId: secondWebinarId,
      name: "Isolated server fixture", email: `fixture-${suffix}@example.test`, isTest: true,
      selectedSession: new Date("2030-01-02T10:00:00Z") });
    const [created] = await db.insert(externalReferrals).values({
      tokenHash: crypto.createHash("sha256").update(fixtureScRef).digest("hex"),
      webinarId: secondWebinarId, ownerId, registrationId: isolatedRegistrationId, sessionId: isolatedSessionId,
      selectedSession: new Date("2030-01-02T10:00:00Z"), sessionProvenance: "registered_watch_token",
      targetUrl: "https://noncodingai.com/physical-classes/checkout/", visitHash: crypto.createHash("sha256").update(suffix).digest("hex"), isTest: true,
    }).returning({ id: externalReferrals.id });
    fixtureReferralId = created.id;
    await db.insert(externalReferrals).values([
      { tokenHash: crypto.createHash("sha256").update(otherWebinarScRef).digest("hex"), webinarId, ownerId,
        targetUrl: "https://noncodingai.com/physical-classes/checkout/", visitHash: crypto.createHash("sha256").update(suffix).digest("hex"), isTest: true },
      { tokenHash: crypto.createHash("sha256").update(otherOwnerScRef).digest("hex"), webinarId: otherWebinarId, ownerId: otherId,
        targetUrl: "https://noncodingai.com/physical-classes/checkout/", visitHash: crypto.createHash("sha256").update(suffix).digest("hex"), isTest: true },
    ]);
    assert.equal((await merchant(secondWebinarId, currentSecret, fixtureOrder)).status, 201);
    const [order] = await db.select().from(externalOrders).where(eq(externalOrders.orderId, fixtureOrder.orderId));
    assert.equal(order.referralId, fixtureReferralId);
    assert.equal(order.sessionId, isolatedSessionId);
    assert.equal(order.grossPaidMinor, 1500);
    assert.equal(order.paymentStatus, "paid");
    assert.equal(order.isTest, true);
    const after = await responseJson(await request(`/api/webinars/${secondWebinarId}/external-journey/public`));
    assert.deepEqual(after, before, "server fixture never enables or changes approvedOrigins");
    assert.equal((await responseJson(await request(`/api/member/external-orders?q=TEST-scRef-${suffix}`, { actor: ownerId }))).total, 0);
  });
  await t.test("opaque scRef receiver rejects amount tampering under the original HMAC", async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = crypto.createHmac("sha256", currentSecret).update(`${timestamp}.${JSON.stringify(fixtureOrder)}`).digest("hex");
    assert.equal((await request(`/api/external/merchant-events/${secondWebinarId}`, { method: "POST",
      body: { ...fixtureOrder, amountMinor: 9999 }, headers: { "x-external-timestamp": timestamp, "x-external-signature": signature } })).status, 401);
  });
  await t.test("opaque scRef receiver rejects a wrong signature and expired timestamp", async () => {
    assert.equal((await request(`/api/external/merchant-events/${secondWebinarId}`, { method: "POST", body: fixtureOrder,
      headers: { "x-external-timestamp": String(Math.floor(Date.now() / 1000)), "x-external-signature": "0".repeat(64) } })).status, 401);
    assert.equal((await merchant(secondWebinarId, currentSecret, fixtureOrder, Math.floor(Date.now() / 1000) - 600)).status, 401);
  });
  await t.test("opaque scRef receiver rejects nonexistent, existing cross-webinar and existing cross-owner tokens", async () => {
    for (const [caseName, scRef] of [
      ["nonexistent", crypto.randomBytes(32).toString("base64url")],
      ["other-webinar", otherWebinarScRef], ["other-owner", otherOwnerScRef],
    ]) {
      const response = await merchant(secondWebinarId, currentSecret, { ...fixtureOrder, eventId: `fixture-${caseName}-${suffix}`, scRef });
      assert.equal(response.status, 403, caseName);
      assert.equal((await response.json() as any).message, "Attribution does not belong to this webinar");
    }
  });
  await t.test("opaque scRef receiver replays one event idempotently and never increments the paid order", async () => {
    assert.equal((await merchant(secondWebinarId, currentSecret, fixtureOrder)).status, 200);
    const changedId = await merchant(secondWebinarId, currentSecret, { ...fixtureOrder, eventId: `fixture-second-paid-${suffix}` });
    assert.equal(changedId.status, 201);
    assert.equal((await changedId.json() as any).orderDeduplicated, true);
    assert.equal((await merchant(secondWebinarId, currentSecret, { ...fixtureOrder, eventId: `fixture-wrong-amount-${suffix}`, amountMinor: 9999 })).status, 409);
    const [order] = await db.select().from(externalOrders).where(eq(externalOrders.orderId, fixtureOrder.orderId));
    assert.equal(order.grossPaidMinor, 1500);
    assert.equal(order.netMinor, 1500);
    assert.equal(order.referralId, fixtureReferralId);
  });
  await t.test("the same owner order ID is independently scoped to its webinar and signed refunds survive unpublish", async () => {
    const shared = { orderId: "same-owner-order", type: "purchase", amountMinor: 700, currency: "USD" };
    await merchant(webinarId, currentSecret, { ...shared, eventId: "first-webinar" });
    await merchant(secondWebinarId, currentSecret, { ...shared, eventId: "second-webinar" });
    await db.update(webinars).set({ publishStatus: "draft" }).where(eq(webinars.id, webinarId));
    assert.equal((await merchant(webinarId, currentSecret, { eventId: "late-unpublished-refund", orderId: shared.orderId, type: "refund", amountMinor: 700, currency: "USD" })).status, 201);
    const rows: any = await responseJson(await request("/api/member/external-orders?q=same-owner-order", { actor: ownerId }));
    assert.equal(rows.total, 2);
    assert.deepEqual(rows.items.map((item: any) => ({ webinar: item.webinarId, net: item.netMinor })).sort((a: any, b: any) => a.webinar.localeCompare(b.webinar)), [
      { webinar: secondWebinarId, net: 700 }, { webinar: webinarId, net: 0 },
    ].sort((a, b) => a.webinar.localeCompare(b.webinar)));
  });

  await t.test("secure handoffs require the rotated key and matching destination exactly once", async () => {
    const handoff = await externalThankYouForRegistration({
      id: registrationId, webinarId, selectedSession: new Date("2030-01-01T10:00:00.000Z"),
    }, "https://platform.example.test/watch/private-token");
    assert.ok(handoff?.redirectUrl);
    const handoffUrl = new URL(handoff!.redirectUrl);
    const token = handoffUrl.searchParams.get("handoff");
    assert.ok(token);
    assert.ok(handoffUrl.searchParams.get("sc_ref"), "registration success should issue automatic verified attribution");
    assert.equal(handoff!.redirectUrl.includes("attendee-"), false, "contact data must never appear in a redirect URL");
    const [automaticReferral] = await db.select().from(externalReferrals).where(and(
      eq(externalReferrals.registrationId, registrationId), eq(externalReferrals.sessionProvenance, "registration_success"),
    ));
    assert.deepEqual(
      { target: automaticReferral.targetUrl, session: automaticReferral.sessionId, provenance: automaticReferral.sessionProvenance },
      { target: publishedSettings.thankYouUrl, session: sessionId, provenance: "registration_success" },
    );
    assert.equal((await request("/api/external/handoffs/exchange", {
      method: "POST", body: { handoff: token }, headers: { authorization: `Bearer ${firstSecret}`, "x-external-destination": "https://journey.example.test" },
    })).status, 401);
    assert.equal((await request("/api/external/handoffs/exchange", {
      method: "POST", body: { handoff: token }, headers: { authorization: `Bearer ${currentSecret}`, "x-external-destination": "https://wrong.example.test" },
    })).status, 403);
    const exchanged = await responseJson(await request("/api/external/handoffs/exchange", {
      method: "POST", body: { handoff: token }, headers: { authorization: `Bearer ${currentSecret}`, "x-external-destination": "https://journey.example.test" },
    }));
    assert.deepEqual({ registrationId: exchanged.registrationId, webinarId: exchanged.webinarId, watchUrl: exchanged.watchUrl, contact: exchanged.contact }, {
      registrationId, webinarId, watchUrl: "https://platform.example.test/watch/private-token",
      contact: { name: "External fixture attendee", email: `attendee-${suffix}@example.test` },
    });
    assert.equal((await request("/api/external/handoffs/exchange", {
      method: "POST", body: { handoff: token }, headers: { authorization: `Bearer ${currentSecret}`, "x-external-destination": "https://journey.example.test" },
    })).status, 401);
  });

  await t.test("owner-scoped list, summary, detail, filters, and CSV retain trust separation", async () => {
    await merchant(otherWebinarId, (await responseJson(await request("/api/member/external-journeys/connection/rotate", { method: "POST", actor: otherId }), 201)).secret, {
      eventId: "other-order", orderId: "=other-order", type: "purchase", amountMinor: 50, currency: "USD",
    });
    assert.equal((await merchant(secondWebinarId, currentSecret, {
      eventId: "owner-csv-order", orderId: "=owner-csv", type: "purchase", amountMinor: 1, currency: "USD",
    })).status, 201);
    const list: any = await responseJson(await request("/api/member/external-orders?sourceTrust=merchant_reported&currency=USD", { actor: ownerId }));
    assert.equal(list.items.every((item: any) => item.webinarId !== otherWebinarId && item.sourceTrust === "merchant_reported"), true);
    const summary: any = await responseJson(await request("/api/member/external-orders/summary?currency=USD", { actor: ownerId }));
    assert.deepEqual(summary.currencies, [{
      currency: "USD", sourceTrust: "merchant_reported", grossPaidMinor: 2901, refundedMinor: 2200,
      netMinor: 701, count: 4, pendingCount: 0,
    }]);
    const detailId = list.items[0].id;
    assert.equal((await request(`/api/member/external-orders/${detailId}`, { actor: rootId })).status, 404);
    const csv = await (await request("/api/member/external-orders/export.csv?currency=USD", { actor: ownerId })).text();
    assert.doesNotMatch(csv, /other-order/);
    assert.match(csv, /'=owner-csv/);
    assert.match(csv, /merchant_reported/);
  });
});