import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { z } from "zod";

// These resources deliberately sit beside, rather than inside, the general
// commerce tables. A row is the durable ownership fence for the single
// no-card-trial commerce page; deleting a draft cannot make a second page.
export const trialCommercePages = pgTable("trial_commerce_pages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // FKs are created in 0029. This module intentionally avoids importing the
  // aggregate schema: schema.ts re-exports it for Drizzle, and an import cycle
  // would evaluate these declarations before the legacy table bindings exist.
  ownerId: varchar("owner_id").notNull(),
  offerId: varchar("offer_id").notNull(),
  salesPageId: varchar("sales_page_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  ownerUnique: uniqueIndex("trial_commerce_pages_owner_uniq").on(table.ownerId),
  offerUnique: uniqueIndex("trial_commerce_pages_offer_uniq").on(table.offerId),
  salesPageUnique: uniqueIndex("trial_commerce_pages_sales_page_uniq").on(table.salesPageId),
}));

// Email is normalized before write and never appears on a public response.
// The uniqueness fence makes retries and concurrent submissions idempotent.
export const trialCommerceLeads = pgTable("trial_commerce_leads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  trialCommercePageId: varchar("trial_commerce_page_id").notNull(),
  ownerId: varchar("owner_id").notNull(),
  salesPageId: varchar("sales_page_id").notNull(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  normalizedEmail: text("normalized_email").notNull(),
  consentedAt: timestamp("consented_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  pageEmailUnique: uniqueIndex("trial_commerce_leads_page_email_uniq")
    .on(table.trialCommercePageId, table.normalizedEmail),
  ownerCreatedIndex: index("trial_commerce_leads_owner_created_idx").on(table.ownerId, table.createdAt),
}));

// A hash is enough to count unique visitors and prevents a raw browser
// identifier becoming an owner-visible contact record.
export const trialCommerceViewEvents = pgTable("trial_commerce_view_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  trialCommercePageId: varchar("trial_commerce_page_id").notNull(),
  ownerId: varchar("owner_id").notNull(),
  salesPageId: varchar("sales_page_id").notNull(),
  visitorTokenHash: varchar("visitor_token_hash", { length: 64 }).notNull(),
  dedupeKey: varchar("dedupe_key", { length: 64 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  pageDedupeUnique: uniqueIndex("trial_commerce_view_events_page_dedupe_uniq")
    .on(table.trialCommercePageId, table.dedupeKey),
  ownerCreatedIndex: index("trial_commerce_view_events_owner_created_idx").on(table.ownerId, table.createdAt),
  pageVisitorIndex: index("trial_commerce_view_events_page_visitor_idx")
    .on(table.trialCommercePageId, table.visitorTokenHash),
}));

export const trialCommerceLeadInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320).transform(value => value.toLowerCase()),
  consent: z.literal(true, { errorMap: () => ({ message: "Consent is required" }) }),
}).strict();

export const trialCommercePageQuerySchema = z.object({
  page: z.coerce.number().int().positive().max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

export const TRIAL_COMMERCE_BRAND = {
  name: "SellCase",
  localizedName: "開賣啦",
  poweredBy: "Powered by SellCase 開賣啦",
} as const;

export const TRIAL_COMMERCE_LEAD_CAPTURE = {
  enabled: true,
  requiredFields: ["name", "email", "consent"] as const,
  consentRequired: true,
} as const;

export type TrialCommercePage = typeof trialCommercePages.$inferSelect;
export type TrialCommerceLead = typeof trialCommerceLeads.$inferSelect;