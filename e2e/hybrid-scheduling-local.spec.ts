import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db, pool } from "../server/db";
import * as schema from "../shared/schema";

const ownerId = randomUUID();
const webinarId = randomUUID();
const username = `hybrid-${ownerId}`;
const password = randomUUID();
const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
let sessionId: string;

test.beforeAll(async ({ request }) => {
  await db.insert(schema.users).values({
    id: ownerId, username, password: await bcrypt.hash(password, 10), subscriptionPlan: "enterprise",
  });
  await db.insert(schema.webinars).values({
    id: webinarId, userId: ownerId, title: "三種觀看方式測試",
    vimeoUrl: "", publishStatus: "published", startTime: new Date(future),
    scheduleMode: { recurring: false, onDemand: true, justInTime: true, justInTimeMinutes: 1 },
    emailSettings: { confirmationEnabled: false, reminder24hEnabled: false, reminder1hEnabled: false, followUpEnabled: false, customSubject: "", customTemplate: "" },
  });
  await db.insert(schema.webinarLandingPages).values({
    webinarId, title: "三種觀看方式測試", publishedTitle: "三種觀看方式測試",
    status: "published", publishedBlocks: [], publishedAt: new Date(),
    publishedBrandSettings: { primaryColor: "#0f766e", secondaryColor: "#f59e0b", backgroundColor: "#ffffff" },
  });
  const login = await request.post("/api/admin/login", { data: { username, password } });
  expect(login.status()).toBe(200);
  const added = await request.post(`/api/webinars/${webinarId}/sessions`, { data: { scheduledStart: future } });
  expect(added.ok()).toBe(true);
  sessionId = (await added.json()).id;
  expect(sessionId).toBeTruthy();
});

test.afterAll(async () => {
  try {
    await db.delete(schema.emailReminders).where(eq(schema.emailReminders.webinarId, webinarId));
    await db.delete(schema.webinarFunnelEvents).where(eq(schema.webinarFunnelEvents.webinarId, webinarId));
    await db.delete(schema.registrationIdentityKeys).where(eq(schema.registrationIdentityKeys.webinarId, webinarId));
    await db.delete(schema.registrations).where(eq(schema.registrations.webinarId, webinarId));
    await db.delete(schema.webinarSessions).where(eq(schema.webinarSessions.webinarId, webinarId));
    await db.delete(schema.webinarLandingPages).where(eq(schema.webinarLandingPages.webinarId, webinarId));
    await db.delete(schema.webinars).where(eq(schema.webinars.id, webinarId));
    await db.delete(schema.users).where(eq(schema.users.id, ownerId));
  } finally { await pool.end(); }
});

for (const embed of [false, true]) {
  for (const choice of ["on-demand", "jit", "future"]) {
    test(`${embed ? "embed" : "public"} saves ${choice} alongside the other choices`, async ({ page }) => {
      await page.route(/https:\/\/(connect\.facebook\.net|www\.facebook\.com|www\.googletagmanager\.com)\//, r => r.abort());
      await page.goto(embed ? `/embed/register/${webinarId}` : `/register/${webinarId}`, { waitUntil: "domcontentloaded" });
      const submit = page.getByTestId(embed ? "button-embed-register" : "button-register");
      await expect(submit).toBeVisible();
      const prefix = embed ? "input-embed-" : "input-";
      await page.getByTestId(`${prefix}name`).fill("Hybrid test");
      await page.getByTestId(`${prefix}phone`).fill("0912345678");
      await page.getByTestId(`${prefix}email`).fill(`${randomUUID()}@example.test`);
      await page.getByTestId(embed ? "button-embed-session-dropdown" : "select-session").click();
      const optionPrefix = embed ? "button-embed-session-" : "option-session-";
      await expect(page.getByTestId(`${optionPrefix}on-demand`)).toBeVisible();
      await expect(page.getByTestId(`${optionPrefix}jit`)).toBeVisible();
      await expect(page.getByTestId(`${optionPrefix}${sessionId}`)).toBeVisible();
      const selected = page.getByTestId(`${optionPrefix}${choice === "future" ? sessionId : choice}`);
      if (embed) await selected.focus();
      if (embed) await page.keyboard.press("Enter");
      else await selected.click();
      const responsePromise = page.waitForResponse(r => r.url().endsWith("/api/registrations") && r.request().method() === "POST");
      await submit.click();
      const response = await responsePromise;
      expect(response.status()).toBe(200);
      const result = await response.json();
      const [stored] = await db.select({ selectedSession: schema.registrations.selectedSession })
        .from(schema.registrations).where(eq(schema.registrations.id, result.id));
      expect(stored).toBeTruthy();
      if (choice === "on-demand") expect(stored.selectedSession).toBeNull();
      else if (choice === "future") expect(stored.selectedSession?.toISOString()).toBe(future);
      else {
        expect(stored.selectedSession!.getTime()).toBeGreaterThan(Date.now());
        expect(stored.selectedSession!.getTime()).toBeLessThan(Date.now() + 180_000);
      }
    });
  }
}
