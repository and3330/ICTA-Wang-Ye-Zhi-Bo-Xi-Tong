import crypto from "node:crypto";
import { pool } from "../../server/db";
import { createWatchToken } from "../../server/watchTokens";

export async function createLiveTrackingFixture() {
  if (process.env.NODE_ENV !== "test") throw new Error("NODE_ENV=test required");
  const connection = await pool.query("SELECT current_database() AS name, pg_is_in_recovery() AS replica");
  // This workspace's verified development DB. Fail closed rather than seed a
  // production connection or silently accept a changed database configuration.
  if (connection.rows[0].name !== "heliumdb" || connection.rows[0].replica) throw new Error("Verified development DB required");
  const ownerId = crypto.randomUUID(), webinarId = crypto.randomUUID(), registrationId = crypto.randomUUID(), ctaId = crypto.randomUUID();
  const settings = { landingMode: "builtin", thankYouMode: "builtin", approvedOrigins: ["https://noncodingai.com"],
    approvedEmbedOrigins: [], secureHandoffEnabled: false, includeWatchLinkInHandoff: false, includeContactInHandoff: false };
  const cleanup = async () => {
    for (const table of ["viewer_progress", "webinar_funnel_events", "external_referrals", "cta_buttons", "registrations", "external_journey_settings"]) {
      // Identifiers are a fixed local allowlist, never external input.
      await pool.query(`DELETE FROM ${table} WHERE webinar_id=$1`, [webinarId]);
    }
    await pool.query("DELETE FROM webinars WHERE id=$1", [webinarId]);
    await pool.query("DELETE FROM users WHERE id=$1", [ownerId]);
  };
  try {
    await pool.query("INSERT INTO users(id,username,password,email,is_active,subscription_plan) VALUES($1,$2,$3,$4,true,'enterprise')",
      [ownerId, `TEST-browser-${ownerId}`, crypto.randomBytes(32).toString("hex"), "browser-fixture@example.test"]);
    await pool.query(`INSERT INTO webinars(id,user_id,title,vimeo_url,start_time,publish_status,is_test,gtm_container_id,schedule_mode,video_duration)
      VALUES($1,$2,$3,'https://vimeo.com/123456789',now()-interval '1 hour','published',true,'GTM-DEVTEST1',$4,3600)`,
      [webinarId, ownerId, "TEST browser GTM and CTA acceptance", JSON.stringify({ recurring: false, onDemand: true, justInTime: false, justInTimeMinutes: 15 })]);
    await pool.query("INSERT INTO registrations(id,webinar_id,name,email,is_test) VALUES($1,$2,$3,$4,true)",
      [registrationId, webinarId, "Synthetic viewer", "viewer-fixture@example.test"]);
    await pool.query(`INSERT INTO cta_buttons(id,webinar_id,text,url,start_time,cta_key)
      VALUES($1,$2,'TEST checkout CTA','https://noncodingai.com/physical-classes/checkout/',0,$3)`,
      [ctaId, webinarId, crypto.randomUUID()]);
    await pool.query("INSERT INTO external_journey_settings(webinar_id,settings,published_settings) VALUES($1,$2,$2)",
      [webinarId, JSON.stringify(settings)]);
    return {
      webinarId, registrationId, ctaId, cleanup,
      watchToken: createWatchToken(registrationId, webinarId, Date.now() + 10 * 60_000),
      async setOrigins(origins: string[]) {
        await pool.query(`UPDATE external_journey_settings SET
          settings=jsonb_set(settings,'{approvedOrigins}',$2::jsonb),
          published_settings=jsonb_set(published_settings,'{approvedOrigins}',$2::jsonb) WHERE webinar_id=$1`,
          [webinarId, JSON.stringify(origins)]);
      },
      async referralEvidence() {
        const result = await pool.query(`SELECT f.is_test, f.registration_id=$2 AS registration_bound,
          f.owner_id=$3 AS owner_bound, f.target_url='https://noncodingai.com/physical-classes/checkout/' AS target_matches
          FROM external_referrals f WHERE f.webinar_id=$1`, [webinarId, registrationId, ownerId]);
        return result.rows;
      },
    };
  } catch (error) { await cleanup(); throw error; }
}
export async function closeLiveFixturePool() { await pool.end(); }
