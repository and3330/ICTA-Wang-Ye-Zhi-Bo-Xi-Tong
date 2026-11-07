// Test-only fixture: never imported by application entry points.
// Intentionally retain all synthetic data; no data-cleanup hook.
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { pool } from "./db";

export async function createRetainedAcceptanceWebinar(kind: "merchant" | "room") {
  assert.equal(process.env.NODE_ENV, "test");
  assert.ok((process.env.REPLIT_DEV_DOMAIN || "").startsWith("9fdababe-8652-4086-97a8-8c9b80d2191b-"));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [connection] } = await client.query(
      "SELECT current_database() AS name, pg_is_in_recovery() AS replica",
    );
    assert.equal(connection.name, "heliumdb");
    assert.equal(connection.replica, false);
    const { rows: [owner] } = await client.query(
      `SELECT u.id,u.username,u.is_active,u.subscription_plan,w.is_test,
       EXISTS(SELECT 1 FROM member_integration_secrets s WHERE s.user_id=u.id) AS has_key
       FROM webinars w JOIN users u ON u.id=w.user_id WHERE w.id=$1`,
      ["53d161f6-68b7-4876-b2f3-ebba3f61d752"],
    );
    assert.ok(owner?.is_test && owner.is_active && owner.has_key);
    assert.ok(owner.username.startsWith("TEST-dev-e2e-"));
    assert.equal(owner.subscription_plan, "enterprise");
    const webinarId = crypto.randomUUID();
    await client.query(
      `INSERT INTO webinars(id,user_id,title,vimeo_url,start_time,publish_status,is_test,
        schedule_mode,timezone,video_duration,meta_pixel_id,gtm_container_id)
       VALUES($1,$2,$3,'https://vimeo.com/123456789',now()-interval '1 hour',
        'published',true,$4,'Asia/Taipei',3600,NULL,$5)`,
      [webinarId, owner.id, `TEST retained R2 ${kind} acceptance`,
        JSON.stringify({ recurring: false, onDemand: true, justInTime: false, justInTimeMinutes: 15 }),
        kind === "room" ? "GTM-DEVTEST1" : null],
    );
    await client.query("COMMIT");
    return { webinarId, ownerId: owner.id };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
