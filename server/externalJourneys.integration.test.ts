import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import dns from "node:dns/promises";
import express from "express";
import { createServer } from "node:http";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "./db";
import { externalThankYouForRegistration, registerExternalJourneyRoutes } from "./externalJourneys";
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
      await db.delete(registrations).where(eq(registrations.id, registrationId));
      await db.delete(webinarSessions).where(eq(webinarSessions.id, sessionId));
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
    const [automaticReferral] = await db.select().from(externalReferrals).where(eq(externalReferrals.registrationId, registrationId));
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
      currency: "USD", sourceTrust: "merchant_reported", grossPaidMinor: 1401, refundedMinor: 700,
      netMinor: 701, count: 3, pendingCount: 0,
    }]);
    const detailId = list.items[0].id;
    assert.equal((await request(`/api/member/external-orders/${detailId}`, { actor: rootId })).status, 404);
    const csv = await (await request("/api/member/external-orders/export.csv?currency=USD", { actor: ownerId })).text();
    assert.doesNotMatch(csv, /other-order/);
    assert.match(csv, /'=owner-csv/);
    assert.match(csv, /merchant_reported/);
  });
});