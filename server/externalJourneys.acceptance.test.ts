import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import { createServer } from "node:http";
import { pool } from "./db";
import { registerExternalJourneyRoutes } from "./externalJourneys";
import { createRetainedAcceptanceWebinar } from "./acceptanceRetainedFixture";

// Retain synthetic DEV rows; teardown closes handles only. No provider jobs.
test("R2 retained DEV merchant acceptance (same event, six boundaries, no negative side effects)", async t => {
  assert.ok(process.env.SELLCASE_EXTERNAL_SECRET, "Existing DEV signing configuration required");
  const fixture = await createRetainedAcceptanceWebinar("merchant");
  const { webinarId, ownerId } = fixture;
  const app = express();
  app.use(express.json({ verify(req, _res, raw) { (req as any).rawBody = raw; } }));
  registerExternalJourneyRoutes(app, async () => true);
  const server = createServer(app);
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await pool.end();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const endpoint = `http://127.0.0.1:${address.port}/api/external/merchant-events/${webinarId}`;
  console.log(JSON.stringify({ fixture: "retained-test-only", database: "heliumdb", webinarId,
    isTest: true, dataCleanup: "none", externalProviders: "not-used" }));

  function event(label: string) {
    const id = crypto.randomUUID();
    return { webinarId, orderId: `TEST-R2-${label}-${id}`, eventId: `TEST-R2-${label}-${id}`,
      status: "paid", amountMinor: 1500, currency: "USD", isTest: true };
  }
  async function send(input: object, timestamp = Math.floor(Date.now() / 1000)) {
    const body = JSON.stringify(input);
    // Existing environment value used internally only; never returned or logged.
    const signed = crypto.createHmac("sha256", process.env.SELLCASE_EXTERNAL_SECRET!)
      .update(`${timestamp}.${body}`).digest("hex");
    const response = await fetch(endpoint, { method: "POST", redirect: "manual",
      headers: { "Content-Type": "application/json", "X-External-Timestamp": String(timestamp),
        "X-External-Signature": signed }, body });
    const result = await response.json() as { accepted?: boolean; replayed?: boolean; message?: string };
    return { status: response.status, accepted: result.accepted, replayed: result.replayed, message: result.message };
  }
  async function orderEvidence(orderId: string) {
    const { rows: orders } = await pool.query(
      `SELECT payment_status,purchase_observed,gross_paid_minor,net_minor,is_test
       FROM external_orders WHERE owner_id=$1 AND webinar_id=$2 AND order_id=$3`,
      [ownerId, webinarId, orderId],
    );
    const { rows: [events] } = await pool.query(
      `SELECT count(*)::int AS count, count(DISTINCT event_id)::int AS distinct_ids,
       bool_and(is_test) AS all_test FROM external_order_events
       WHERE owner_id=$1 AND webinar_id=$2 AND order_id=$3`,
      [ownerId, webinarId, orderId],
    );
    return { orders, eventCount: events.count as number, distinctEventIds: events.distinct_ids as number,
      allEventsTest: events.all_test };
  }

  await t.test("no prior order or event: eight simultaneous copies of ONE first-paid event book once",
    { skip: process.env.ACCEPTANCE_CASE === "negative" }, async () => {
    const paid = event("same-business-event");
    const before = await orderEvidence(paid.orderId);
    assert.equal(before.orders.length, 0);
    assert.equal(before.eventCount, 0);
    console.log(JSON.stringify({ case: "first-paid-before", orderId: paid.orderId,
      eventId: paid.eventId, orderCount: 0, paidOrderCount: 0, eventCount: 0, pendingRequired: false }));
    const timestamp = Math.floor(Date.now() / 1000);
    // The exact same business event/body/eventId is sent concurrently, not 8 IDs.
    const responses = await Promise.all(Array.from({ length: 8 }, () => send(paid, timestamp)));
    assert.equal(responses.filter(x => x.status === 201 && x.replayed === false).length, 1);
    assert.equal(responses.filter(x => x.status === 200 && x.replayed === true).length, 7);
    assert.ok(responses.every(x => x.accepted === true));
    const retry = await send(paid, timestamp);
    assert.equal(retry.status, 200);
    assert.equal(retry.replayed, true);
    const after = await orderEvidence(paid.orderId);
    assert.equal(after.orders.length, 1);
    assert.equal(after.eventCount, 1);
    assert.equal(after.distinctEventIds, 1);
    assert.ok(after.allEventsTest);
    assert.deepEqual(after.orders[0], { payment_status: "paid", purchase_observed: true,
      gross_paid_minor: 1500, net_minor: 1500, is_test: true });
    const { rows: [stored] } = await pool.query(
      "SELECT event_id=$4 AS same_business_event FROM external_order_events WHERE owner_id=$1 AND webinar_id=$2 AND order_id=$3",
      [ownerId, webinarId, paid.orderId, `merchant:${paid.eventId}`],
    );
    assert.equal(stored.same_business_event, true);
    console.log(JSON.stringify({ case: "first-paid-after", httpStatuses: responses.map(x => x.status),
      created: 1, replayed: 7, retryHttp: retry.status, sameBusinessEvent: true,
      orderCount: 1, eventCount: 1, distinctEventIds: 1, grossPaidMinor: 1500, netMinor: 1500,
      isTest: true, assertionsPassed: true }));
  });

  await t.test("fixed server clock: all six exact timestamp offsets and DB effects",
    { skip: process.env.ACCEPTANCE_CASE === "negative" }, async clock => {
    const nowMs = Math.floor(Date.now() / 1000) * 1000;
    clock.mock.method(Date, "now", () => nowMs);
    console.log(JSON.stringify({ rule: "abs(serverNowMs - timestampSeconds*1000) <= 300000",
      fixedClock: true, pendingRequired: false }));
    for (const offset of [-301, -300, -299, 299, 300, 301]) {
      await clock.test(`offset ${offset}s HTTP ${Math.abs(offset) <= 300 ? 201 : 401}`, async () => {
        const paid = event(`clock-${offset}`);
        const expected = Math.abs(offset) <= 300 ? 201 : 401;
        const before = await orderEvidence(paid.orderId);
        assert.equal(before.orders.length, 0);
        assert.equal(before.eventCount, 0);
        const response = await send(paid, nowMs / 1000 + offset);
        assert.equal(response.status, expected);
        if (expected === 401) assert.equal(response.message, "Invalid signature timestamp");
        const after = await orderEvidence(paid.orderId);
        assert.equal(after.orders.length, expected === 201 ? 1 : 0);
        assert.equal(after.eventCount, expected === 201 ? 1 : 0);
        if (expected === 201) {
          assert.equal(after.orders[0].gross_paid_minor, 1500);
          assert.equal(after.orders[0].net_minor, 1500);
          assert.equal(after.orders[0].is_test, true);
          assert.equal(after.allEventsTest, true);
        }
        console.log(JSON.stringify({ case: "clock", offsetSeconds: offset, http: response.status,
          beforeOrders: 0, beforeEvents: 0, afterOrders: after.orders.length,
          afterEvents: after.eventCount, grossPaidMinor: after.orders[0]?.gross_paid_minor || 0,
          assertionsPassed: true }));
      });
    }
  });

  await t.test("well-formed nonexistent attribution: HTTP 403 and all order/event/referral contents unchanged", async () => {
    // Non-empty referral baseline so unchanged-content assertions are meaningful.
    await pool.query(
      `INSERT INTO external_referrals(webinar_id,owner_id,token_hash,target_url,is_test)
       VALUES($1,$2,$3,'https://example.invalid/test-only',true)`,
      [webinarId, ownerId, crypto.createHash("sha256").update(crypto.randomBytes(32)).digest("hex")],
    );
    const absent = crypto.randomBytes(32).toString("base64url");
    assert.match(absent, /^[A-Za-z0-9_-]{24,128}$/);
    const { rows: [lookup] } = await pool.query(
      "SELECT count(*)::int AS count FROM external_referrals WHERE token_hash=$1",
      [crypto.createHash("sha256").update(absent).digest("hex")],
    );
    assert.equal(lookup.count, 0);
    async function snapshot() {
      const result: Record<string, { count: number; content: string }> = {};
      for (const table of ["external_orders", "external_order_events", "external_referrals"]) {
        // Fixed allowlist only. Content digests stay inside assertions, not output.
        const { rows: [row] } = await pool.query(
          `SELECT count(*)::int AS count, coalesce(md5(jsonb_agg(to_jsonb(x) ORDER BY id)::text),'empty') AS content
           FROM ${table} x WHERE owner_id=$1 AND webinar_id=$2`, [ownerId, webinarId],
        );
        result[table] = row;
      }
      return result;
    }
    const negativeId = crypto.randomUUID().slice(0, 8);
    const paid = { ...event("independent-negative"), orderId: `TEST-R2-N-${negativeId}`,
      eventId: `TEST-R2-E-${negativeId}` };
    const isolatedBefore = await orderEvidence(paid.orderId);
    assert.equal(isolatedBefore.orders.length, 0);
    assert.equal(isolatedBefore.eventCount, 0);
    const before = await snapshot();
    assert.ok(before.external_referrals.count > 0);
    const response = await send({ ...paid, scRef: absent });
    assert.equal(response.status, 403);
    assert.equal(response.message, "Attribution does not belong to this webinar");
    const after = await snapshot();
    const unchanged: Record<string, boolean> = {};
    for (const table of Object.keys(before)) {
      assert.equal(before[table].count, after[table].count);
      unchanged[table] = before[table].content === after[table].content;
      assert.ok(unchanged[table], `${table} contents must not change`);
    }
    const isolatedAfter = await orderEvidence(paid.orderId);
    assert.equal(isolatedAfter.orders.length, 0);
    assert.equal(isolatedAfter.eventCount, 0);
    console.log(JSON.stringify({ case: "independent-negative", orderId: paid.orderId, eventId: paid.eventId,
      tokenFormatValid: true, matchingReferralsBefore: 0, http: response.status,
      beforeCounts: Object.fromEntries(Object.entries(before).map(([key, value]) => [key, value.count])),
      afterCounts: Object.fromEntries(Object.entries(after).map(([key, value]) => [key, value.count])),
      contentUnchanged: unchanged, isolatedOrderCount: 0, isolatedEventCount: 0, assertionsPassed: true }));
  });
});
