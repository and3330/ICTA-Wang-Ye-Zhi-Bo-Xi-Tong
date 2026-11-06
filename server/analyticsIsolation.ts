import { sql } from "drizzle-orm";
import { registrations, webinars, webinarFunnelEvents } from "@shared/schema";

// Server-owned flags; callers cannot turn exclusion off through public/MCP inputs.
export const realRegistration = sql`${registrations.isTest} = false AND ${registrations.deletedAt} IS NULL
  AND NOT EXISTS (SELECT 1 FROM webinars isolation_w WHERE isolation_w.id = ${registrations.webinarId} AND isolation_w.is_test = true)`;
export const realFunnelEvent = sql`${webinarFunnelEvents.isTest} = false
  AND NOT EXISTS (SELECT 1 FROM registrations isolation_r WHERE isolation_r.id = ${webinarFunnelEvents.registrationId} AND isolation_r.is_test = true)
  AND NOT EXISTS (SELECT 1 FROM webinars isolation_w WHERE isolation_w.id = ${webinarFunnelEvents.webinarId} AND isolation_w.is_test = true)`;
