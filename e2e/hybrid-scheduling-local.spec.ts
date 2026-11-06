import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { WebSocket } from "ws";
import { expect, test } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../server/db";
import * as schema from "../shared/schema";
import { storage } from "../server/storage";

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
    await db.delete(schema.chatMessages).where(eq(schema.chatMessages.webinarId, webinarId));
    await db.delete(schema.scheduledMessages).where(eq(schema.scheduledMessages.webinarId, webinarId));
    await db.delete(schema.webinarSessions).where(eq(schema.webinarSessions.webinarId, webinarId));
    await db.delete(schema.webinarLandingPages).where(eq(schema.webinarLandingPages.webinarId, webinarId));
    await db.delete(schema.webinars).where(eq(schema.webinars.id, webinarId));
    await db.delete(schema.users).where(eq(schema.users.id, ownerId));
  } finally { await pool.end(); }
});

test("repeat email signups create independent registrations across viewing modes and concurrent requests", async ({ request }) => {
  const email = `repeat-${randomUUID()}@example.test`;
  const payload = { webinarId, name: "Repeat signup test", phone: "0912345678", email };
  const results: any[] = [];
  for (const data of [payload, { ...payload, email: ` ${email.toUpperCase()} `, selectedSession: future }]) {
    const response = await request.post("/api/registrations", { data });
    expect(response.status()).toBe(200);
    results.push(await response.json());
  }
  const concurrent = await Promise.all([0, 1].map(() => request.post("/api/registrations", { data: payload })));
  for (const response of concurrent) {
    expect(response.status()).toBe(200);
    results.push(await response.json());
  }
  expect(new Set(results.map(r => r.id)).size).toBe(4);
  expect(new Set(results.map(r => r.watchToken)).size).toBe(4);
  expect(results[0].selectedSession).toBeNull();
  expect(new Date(results[1].selectedSession).toISOString()).toBe(future);
  const saved = await db.select().from(schema.registrations).where(eq(schema.registrations.webinarId, webinarId));
  expect(saved.filter(r => r.email === email)).toHaveLength(4);
  const events = await db.select().from(schema.webinarFunnelEvents).where(eq(schema.webinarFunnelEvents.webinarId, webinarId));
  for (const result of results) {
    expect(events.filter(e => e.registrationId === result.id && e.eventType === "registration")).toHaveLength(1);
  }
});

test("repeat email signups still respect the atomic monthly registration limit", async () => {
  const existing = await db.select({ id: schema.registrations.id }).from(schema.registrations)
    .where(eq(schema.registrations.webinarId, webinarId));
  const payload = { webinarId, name: "Quota repeat test", email: `quota-${randomUUID()}@example.test` };
  const results = await Promise.all([0, 1, 2].map(() =>
    storage.createRegistrationWithinMonthlyLimit(ownerId, payload, existing.length + 2),
  ));
  const admitted = results.filter(Boolean);
  expect(admitted).toHaveLength(2);
  expect(results.filter(r => r === null)).toHaveLength(1);
  expect(new Set(admitted.map(r => r!.id)).size).toBe(2);
});

test("owner can create, persist, edit and delete timed assistant materials in the UI", async ({ page }) => {
  await page.goto("/");
  await page.locator("h1").first().waitFor();
  const login = await page.request.post("/api/admin/login", { data: { username, password } });
  expect(login.status()).toBe(200);
  // Use normal SPA navigation after legacy test sign-in. A direct protected
  // document request invokes the unrelated Clerk handshake in development.
  await page.evaluate(path => {
    history.pushState({}, "", path);
    dispatchEvent(new PopStateEvent("popstate"));
  }, `/admin/webinar/${webinarId}/ai`);
  await page.getByRole("tab", { name: "定時素材" }).click();
  await page.getByRole("button", { name: "新增素材" }).click();
  await page.getByLabel("影片播放時間", { exact: true }).fill("1:30");
  await page.getByLabel("聊天室文字", { exact: true }).fill("這是本場講義");
  await page.getByLabel("素材連結（選填）", { exact: true }).fill("https://example.com/handout");
  const saved = page.waitForResponse(r => r.url().endsWith("/scheduled-messages") && r.request().method() === "POST");
  await page.getByRole("button", { name: "建立定時素材", exact: true }).click();
  const created = await saved;
  expect(created.status()).toBe(200);
  const material = await created.json();
  expect(material.messageType).toBe("assistant");
  expect(material.triggerTime).toBe(90);
  expect(material.fakeUserId).toBeNull();
  await page.getByRole("tab", { name: "人設與回覆" }).click();
  await page.getByRole("tab", { name: "定時素材" }).click();
  const persisted = await page.request.get(`/api/webinars/${webinarId}/scheduled-messages`);
  expect((await persisted.json()).some((m: any) => m.id === material.id && m.message === material.message)).toBe(true);
  await expect(page.getByText("這是本場講義", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "編輯 1:30 定時素材", exact: true }).click();
  await expect(page.getByLabel("完整聊天室訊息", { exact: true })).toHaveValue("這是本場講義\nhttps://example.com/handout");
  await page.getByLabel("影片播放時間", { exact: true }).fill("2:00");
  const patched = page.waitForResponse(r => r.url().endsWith(material.id) && r.request().method() === "PATCH");
  await page.getByRole("button", { name: "儲存修改", exact: true }).click();
  expect((await patched).status()).toBe(200);
  // Public API sees only this webinar's configuration; updates cannot turn a
  // material into a simulated viewer or move it to another webinar.
  const impersonation = await page.request.patch(`/api/webinars/${webinarId}/scheduled-messages/${material.id}`, { data: { fakeUserId: randomUUID() } });
  expect(impersonation.status()).toBe(400);
  const move = await page.request.patch(`/api/webinars/${webinarId}/scheduled-messages/${material.id}`, { data: { webinarId: randomUUID() } });
  expect(move.status()).toBe(400);
  await page.getByRole("button", { name: "刪除 2:00 定時素材", exact: true }).click();
  const removed = page.waitForResponse(r => r.url().endsWith(material.id) && r.request().method() === "DELETE");
  await page.getByRole("button", { name: "確認刪除", exact: true }).click();
  expect((await removed).status()).toBe(200);
  await expect(page.getByRole("button", { name: "刪除 2:00 定時素材", exact: true })).toHaveCount(0);
  const rows = await db.select().from(schema.scheduledMessages).where(eq(schema.scheduledMessages.id, material.id));
  expect(rows).toHaveLength(0);
});

test("five-minute and starting email reminders save, preview and enqueue for the selected session", async ({ page }) => {
  await page.goto("/");
  await page.locator("h1").first().waitFor();
  expect((await page.request.post("/api/admin/login", { data: { username, password } })).status()).toBe(200);
  await page.evaluate(path => {
    history.pushState({}, "", path); dispatchEvent(new PopStateEvent("popstate"));
  }, `/admin/webinar/${webinarId}`);
  await page.getByTestId("tab-notifications").click();
  const five = page.getByRole("switch", { name: "開播前 5 分鐘提醒", exact: true });
  const starting = page.getByRole("switch", { name: "開播當下提醒", exact: true });
  const noShow = page.getByRole("switch", { name: "開播後 10 分鐘未出席提醒", exact: true });
  await expect(five).not.toBeChecked();
  await expect(starting).not.toBeChecked();
  await expect(noShow).not.toBeChecked();
  await five.click();
  await starting.click();
  await noShow.click();
  const save = page.waitForResponse(r => r.url().endsWith(`/api/webinars/${webinarId}`) && r.request().method() === "PATCH");
  await page.getByTestId("button-save-email").click();
  expect((await save).status()).toBe(200);
  try {
    const saved = await (await page.request.get(`/api/webinars/${webinarId}`)).json();
    expect(saved.emailSettings.reminder5mEnabled).toBe(true);
    expect(saved.emailSettings.reminderStartEnabled).toBe(true);
    expect(saved.emailSettings.reminderNoShow10mEnabled).toBe(true);
    expect(saved.emailSettings.reminder1hEnabled).toBe(false);
    for (const [kind, subject] of [["reminder_5m", "5 分鐘後開播"], ["reminder_start", "現在開播"], ["reminder_no_show_10m", "現在加入還來得及"]]) {
      const preview = page.waitForResponse(r => r.url().includes("/email-preview") && r.request().method() === "POST");
      await page.getByTestId(`button-preview-email-${kind}`).click();
      const response = await preview;
      expect(response.status()).toBe(200);
      const email = await response.json();
      expect(email.subject).toContain(subject);
      expect(email.html).toContain(kind === "reminder_no_show_10m" ? "現在加入直播間" : "進入直播間");
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
    }
    const registration = await page.request.post("/api/registrations", { data: {
      webinarId, name: "Reminder fixture", email: "reminder-fixture@example.test",
      phone: "0912345678", selectedSession: future,
    } });
    expect(registration.status()).toBe(200);
    const { id } = await registration.json();
    const rows = await db.select().from(schema.emailReminders).where(eq(schema.emailReminders.registrationId, id));
    expect(rows.map(row => row.reminderType).sort()).toEqual(["reminder_5m", "reminder_no_show_10m", "reminder_start"]);
    expect(rows.find(row => row.reminderType === "reminder_5m")!.scheduledFor.getTime()).toBe(new Date(future).getTime() - 300_000);
    expect(rows.find(row => row.reminderType === "reminder_start")!.scheduledFor.getTime()).toBe(new Date(future).getTime());
    expect(rows.find(row => row.reminderType === "reminder_no_show_10m")!.scheduledFor.getTime()).toBe(new Date(future).getTime() + 600_000);
  } finally {
    await page.request.patch(`/api/webinars/${webinarId}`, { data: { emailSettings: {
      confirmationEnabled: false, reminder24hEnabled: false, reminder1hEnabled: false,
      reminder5mEnabled: false, reminderStartEnabled: false,
      reminderNoShow10mEnabled: false,
      followUpEnabled: false, customSubject: "", customTemplate: "",
    } } });
  }
});

test("manual session notification confirms audience and count before enqueue, with a fresh choice each time", async ({ page }) => {
  // Preview is real; the send action is intercepted so browser tests never
  // create immediately-sendable jobs for the real development mail worker.
  // Real HTTP enqueue/delivery eligibility is covered with a far-future clock
  // in sessionNotifications.integration.test.ts.
  const noticeSessionId = randomUUID();
  const noticeStart = new Date(new Date(future).getTime() + 2 * 86_400_000);
  await db.insert(schema.webinarSessions).values({ id: noticeSessionId, webinarId, scheduledStart: noticeStart });
  const fixtureRows = await db.insert(schema.registrations).values([
    { name: "Manual notice absent", email: `notice-absent-${ownerId}@example.test`, attended: false },
    { name: "Manual notice attended", email: `notice-attended-${ownerId}@example.test`, attended: true },
    { name: "Another session", email: `notice-other-${ownerId}@example.test`, attended: false, selectedSession: new Date(Date.now() + 4 * 86_400_000) },
  ].map(row => ({ webinarId, phone: "", selectedSession: noticeStart, ...row }))).returning({ id: schema.registrations.id });
  try {
  const sent: any[] = [];
  const path = `/api/webinars/${webinarId}/sessions/${noticeSessionId}/notifications`;
  await page.route(`**${path}`, async route => {
    const body = route.request().postDataJSON();
    sent.push(body);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      batchId: body.requestId, queuedCount: body.expectedCount, replayed: false,
    }) });
  });
  await page.goto("/");
  await page.locator("h1").first().waitFor();
  expect((await page.request.post("/api/admin/login", { data: { username, password } })).status()).toBe(200);
  await page.evaluate(path => {
    history.pushState({}, "", path); dispatchEvent(new PopStateEvent("popstate"));
  }, `/admin/webinar/${webinarId}`);
  await page.getByTestId("tab-schedule").click();
  await page.getByRole("button", { name: "場次管理", exact: true }).click();
  const button = page.getByTestId(`button-session-notice-${noticeSessionId}`);
  await button.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByTestId("session-notice-recipient-count")).toContainText("1 位");
  expect(sent).toHaveLength(0);
  await page.getByTestId("select-session-notice-audience").click();
  await page.getByRole("option", { name: "該場次全部報名者", exact: true }).click();
  await expect(page.getByTestId("session-notice-recipient-count")).toContainText("2 位");
  await page.getByTestId("button-confirm-session-notice").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ audience: "all", expectedCount: 2 });
  await button.click();
  await expect(page.getByTestId("session-notice-recipient-count")).toContainText("1 位");
  await page.getByTestId("button-confirm-session-notice").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(sent).toHaveLength(2);
  expect(sent[1]).toMatchObject({ audience: "absent", expectedCount: 1 });
  expect(sent[1].requestId).not.toBe(sent[0].requestId);
  } finally {
    await db.delete(schema.registrations).where(inArray(schema.registrations.id, fixtureRows.map(row => row.id)));
    await db.delete(schema.webinarSessions).where(eq(schema.webinarSessions.id, noticeSessionId));
  }
});

test("tracking settings save, normalize, validate and clear IDs on an isolated webinar", async ({ page }) => {
  await page.goto("/");
  await page.locator("h1").first().waitFor();
  expect((await page.request.post("/api/admin/login", { data: { username, password } })).status()).toBe(200);
  await page.evaluate(path => {
    history.pushState({}, "", path); dispatchEvent(new PopStateEvent("popstate"));
  }, `/admin/webinar/${webinarId}`);
  await page.getByRole("tab", { name: "設定", exact: true }).click();
  const pixel = page.getByTestId("input-meta-pixel-id");
  const gtm = page.getByTestId("input-gtm-container-id");
  const save = page.getByTestId("button-save-tracking");
  await pixel.fill("1");
  await expect(save).toBeDisabled();
  await pixel.fill("987654321001234");
  await gtm.fill("gtm-selle2e");
  await expect(gtm).toHaveValue("GTM-SELLE2E");
  const saved = page.waitForResponse(r => r.url().endsWith(`/api/webinars/${webinarId}`) && r.request().method() === "PATCH");
  await save.click();
  expect((await saved).status()).toBe(200);
  const read = await page.request.get(`/api/webinars/${webinarId}`);
  const persisted = await read.json();
  expect(persisted.metaPixelId).toBe("987654321001234");
  expect(persisted.gtmContainerId).toBe("GTM-SELLE2E");
  await pixel.fill("");
  await gtm.fill("");
  const cleared = page.waitForResponse(r => r.url().endsWith(`/api/webinars/${webinarId}`) && r.request().method() === "PATCH");
  await save.click();
  expect((await cleared).status()).toBe(200);
  const empty = await (await page.request.get(`/api/webinars/${webinarId}`)).json();
  expect(empty.metaPixelId).toBeNull();
  expect(empty.gtmContainerId).toBeNull();
});

test("real poll votes return their poll ID and repeated votes do not count twice", async ({ request }) => {
  expect((await request.post("/api/admin/login", { data: { username, password } })).status()).toBe(200);
  const pollIds: string[] = [];
  let socket: WebSocket | undefined;
  try {
    for (const question of ["投票一", "投票二"]) {
      const response = await request.post(`/api/webinars/${webinarId}/polls`, {
        data: { question, options: ["甲", "乙"], triggerTime: 0, duration: 60 },
      });
      expect(response.status()).toBe(200);
      pollIds.push((await response.json()).id);
    }
    const registered = await request.post("/api/registrations", { data: {
      webinarId, name: "Poll integration test", phone: "0912345678", email: `${randomUUID()}@example.test`,
    } });
    expect(registered.status()).toBe(200);
    const { watchToken } = await registered.json();
    socket = new WebSocket("ws://127.0.0.1:5000/ws");
    await new Promise<void>((resolve, reject) => { socket!.once("open", resolve); socket!.once("error", reject); });
    const exchange = (expected: string, outgoing: any) => new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => { socket!.off("message", onMessage); reject(new Error(`No ${expected}`)); }, 5000);
      const onMessage = (raw: any) => {
        const message = JSON.parse(raw.toString());
        if (message.type === expected) {
          clearTimeout(timer); socket!.off("message", onMessage); resolve(message.data);
        }
      };
      socket!.on("message", onMessage);
      socket!.send(JSON.stringify(outgoing));
    });
    await exchange("sessionConfirmed", { type: "join", data: { webinarId, sessionId: randomUUID(), nickname: "投票測試", watchToken } });
    for (const [index, optionIndex] of [[0, 0], [1, 1], [0, 0]]) {
      const result = await exchange("pollResults", { type: "vote", data: { pollId: pollIds[index], optionIndex } });
      expect(result.pollId).toBe(pollIds[index]);
      expect(result.results).toEqual({ [optionIndex]: 1 });
    }
  } finally {
    socket?.close();
    for (const pollId of pollIds) {
      await db.delete(schema.pollVotes).where(eq(schema.pollVotes.pollId, pollId));
      await db.delete(schema.polls).where(eq(schema.polls.id, pollId));
    }
  }
});

test("control studio validates CTA targets and confirms real pushes to an authorized viewer", async ({ page }) => {
  test.setTimeout(120_000);
  const sockets: WebSocket[] = [];
  let pollId: string | undefined;
  const open = async (cookie?: string) => {
    const socket = new WebSocket("ws://127.0.0.1:5000/ws", cookie ? { headers: { Cookie: cookie } } : undefined);
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
    return socket;
  };
  const next = (socket: WebSocket, type: string, send?: any) => new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => { socket.off("message", onMessage); reject(new Error(`Missing ${type} response`)); }, 8_000);
    const onMessage = (raw: any) => {
      const message = JSON.parse(raw.toString());
      if (message.type === type) {
        clearTimeout(timer); socket.off("message", onMessage); resolve(message.data);
      }
    };
    socket.on("message", onMessage);
    if (send) socket.send(JSON.stringify(send));
  });
  try {
    await page.addInitScript(() => {
      const Native = window.WebSocket;
      (window as any).__studioSockets = [];
      window.WebSocket = class extends Native {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          if (String(url).endsWith("/ws")) (window as any).__studioSockets.push(this);
        }
      };
    });
    await page.goto("/");
    await page.locator("h1").first().waitFor();
    expect((await page.request.post("/api/admin/login", { data: { username, password } })).status()).toBe(200);
    const poll = await page.request.post(`/api/webinars/${webinarId}/polls`, { data: {
      question: "即時推送投票", options: ["甲", "乙"], triggerTime: 0, duration: 60,
    } });
    expect(poll.status()).toBe(200);
    pollId = (await poll.json()).id;
    const registered = await page.request.post("/api/registrations", { data: {
      webinarId, name: "Studio viewer test", phone: "0912345678", email: `${randomUUID()}@example.test`,
    } });
    expect(registered.status()).toBe(200);
    const { watchToken } = await registered.json();
    const viewer = await open();
    await next(viewer, "sessionConfirmed", { type: "join", data: { webinarId, watchToken, nickname: "Studio viewer", sessionId: randomUUID() } });
    const cookies = (await page.context().cookies()).map(c => `${c.name}=${c.value}`).join("; ");
    const host = await open(cookies);
    await next(host, "history", { type: "joinAsHost", data: { webinarId } });
    const bad = await next(host, "hostActionResult", { type: "liveCta", data: { text: "Bad URL", url: "#", requestId: "bad-url" } });
    expect(bad).toMatchObject({ requestId: "bad-url", success: false });
    const anonymous = await open();
    const denied = await next(anonymous, "hostActionResult", { type: "liveCta", data: { text: "Denied", url: "https://example.com", requestId: "denied" } });
    expect(denied.success).toBe(false);
    await page.evaluate(path => { history.pushState({}, "", path); dispatchEvent(new PopStateEvent("popstate")); }, `/admin/webinar/${webinarId}/control`);
    const push = page.getByTestId("button-studio-push-cta");
    await expect(push).toBeEnabled({ timeout: 20_000 });
    await page.getByTestId("input-studio-cta-text").fill("即時 CTA 測試");
    await page.getByTestId("input-studio-cta-url").fill("#");
    await push.click();
    await expect(page.getByText(/不能使用 # 或相對路徑/).first()).toBeVisible();
    expect((await db.select({ id: schema.ctaButtons.id }).from(schema.ctaButtons).where(eq(schema.ctaButtons.webinarId, webinarId))).length).toBe(0);
    await page.getByTestId("input-studio-cta-url").fill("https://example.com/offer");
    await page.getByTestId("input-studio-cta-dur").fill("45");
    const delivered = next(viewer, "liveCta");
    await push.click();
    const cta = await delivered;
    expect(cta.url).toBe("https://example.com/offer");
    expect(cta.text).toBe("即時 CTA 測試");
    expect(cta.expiresAt).toBeGreaterThan(Date.now());
    await expect(page.getByText(/已推送給目前連線的觀眾/).first()).toBeVisible();
    await page.getByRole("tab", { name: "快速小提示卡", exact: true }).click();
    await page.getByTestId("input-studio-tip-title").fill("即時提示");
    await page.getByTestId("input-studio-tip-content").fill("聊天室資料");
    const tip = next(viewer, "liveTip");
    await page.getByTestId("button-studio-push-tip").click();
    expect((await tip).content).toBe("聊天室資料");
    await page.getByRole("tab", { name: "快速假人聊天", exact: true }).click();
    await page.getByTestId("input-studio-chat-message").fill("即時聊天室測試");
    const chat = next(viewer, "chat");
    await page.getByTestId("button-studio-push-chat").click();
    expect((await chat).message).toBe("即時聊天室測試");
    await page.getByRole("tab", { name: "投票", exact: true }).click();
    const pollMessage = next(viewer, "poll");
    await page.getByTestId(`button-trigger-poll-${pollId}`).click();
    expect((await pollMessage).id).toBe(pollId);
    await page.getByRole("tab", { name: "CTA", exact: true }).click();
    // Suppress only the acknowledgement: no automatic retry or false success.
    await page.evaluate(() => {
      const socket = (window as any).__studioSockets.at(-1);
      const original = socket.onmessage;
      socket.onmessage = (event: MessageEvent) => {
        if (JSON.parse(event.data).type !== "hostActionResult") original.call(socket, event);
      };
    });
    const second = next(viewer, "liveCta");
    await push.click();
    await second;
    await expect(page.getByText(/未收到推送確認/).first()).toBeVisible({ timeout: 15_000 });
    expect((await db.select({ id: schema.ctaButtons.id }).from(schema.ctaButtons).where(eq(schema.ctaButtons.webinarId, webinarId))).length).toBe(2);
    await page.evaluate(() => (window as any).__studioSockets.at(-1).close());
    await expect(push).toBeDisabled();
  } finally {
    sockets.forEach(socket => socket.terminate());
    await db.delete(schema.ctaButtons).where(eq(schema.ctaButtons.webinarId, webinarId));
    if (pollId) {
      await db.delete(schema.pollVotes).where(eq(schema.pollVotes.pollId, pollId));
      await db.delete(schema.polls).where(eq(schema.polls.id, pollId));
    }
  }
});

for (const width of [390, 900]) {
  test(`embedded registration scrolls all session choices and form fields at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 650 });
    await page.route(`**/api/webinars/${webinarId}/available-sessions`, async route => {
      const original = await route.fetch();
      const data = await original.json();
      data.sessions = Array.from({ length: 24 }, (_, i) => ({
        id: `scroll-session-${i}`,
        scheduledStart: new Date(new Date(future).getTime() + i * 3_600_000).toISOString(),
      }));
      await route.fulfill({ response: original, json: data });
    });
    // Exercise a fixed-height iframe like the external site's registration
    // dialog, not just the standalone embed URL.
    await page.route("**/scroll-test-host", route => route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<html><head><meta charset="utf-8"></head><body style="margin:0"><iframe title="報名表" src="/embed/register/${webinarId}" style="width:100%;height:500px;border:0"></iframe></body></html>`,
    }));
    await page.goto("/scroll-test-host");
    const frame = page.frameLocator('iframe[title="報名表"]');
    const trigger = frame.getByTestId("button-embed-session-dropdown");
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    const scroll = frame.getByTestId("embed-session-scroll");
    expect(await scroll.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    await scroll.hover();
    await page.mouse.wheel(0, 500);
    await expect.poll(() => scroll.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    await scroll.focus();
    await page.keyboard.press("Control+End");
    const last = frame.getByTestId("button-embed-session-scroll-session-23");
    await last.focus();
    await page.keyboard.press("Enter");
    await expect(scroll).not.toBeAttached();
    await trigger.click();
    await scroll.focus();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await frame.getByTestId("input-embed-name").fill("捲動測試");
    await frame.getByTestId("input-embed-phone").fill("0912345678");
    await frame.getByTestId("input-embed-email").fill("scroll@example.test");
    await frame.getByTestId("button-embed-register").scrollIntoViewIfNeeded();
    await expect(frame.getByTestId("button-embed-register")).toBeVisible();
    expect(await frame.locator("body").evaluate(() => document.scrollingElement!.scrollTop)).toBeGreaterThan(0);
  });
}

test("verified viewers cannot reuse another person's chat identity or inherit historical host broadcasts", async ({ request }) => {
  const tokens: string[] = [];
  for (let i = 0; i < 2; i++) {
    const response = await request.post("/api/registrations", { data: {
      webinarId, name: "Chat isolation test", phone: "0912345678", email: `${randomUUID()}@example.test`,
    } });
    expect(response.status()).toBe(200);
    tokens.push((await response.json()).watchToken);
  }
  const sockets: WebSocket[] = [];
  const join = (token: string, claimedSession: string) => new Promise<{ sessionId: string; messages: any[] }>((resolve, reject) => {
    const ws = new WebSocket("ws://127.0.0.1:5000/ws");
    sockets.push(ws);
    let history: any[] = [];
    const timer = setTimeout(() => reject(new Error("Chat join timed out")), 10000);
    ws.on("error", reject);
    ws.on("open", () => ws.send(JSON.stringify({ type: "join", data: {
      webinarId, sessionId: claimedSession, nickname: "Chat test", watchToken: token,
    } })));
    ws.on("message", raw => {
      const message = JSON.parse(raw.toString());
      if (message.type === "history") history = message.data.messages;
      if (message.type === "sessionConfirmed") {
        clearTimeout(timer);
        resolve({ sessionId: message.data.sessionId, messages: history });
      }
      if (message.type === "error") { clearTimeout(timer); reject(new Error(message.data.message)); }
    });
  });
  try {
    const a = await join(tokens[0], "same-browser-session");
    const b = await join(tokens[1], "same-browser-session");
    expect(a.sessionId).not.toBe(b.sessionId);
    await db.insert(schema.chatMessages).values([
      { webinarId, sessionId: a.sessionId, senderName: "A", senderType: "viewer", message: "private-a", isPrivate: true },
      { webinarId, sessionId: b.sessionId, senderName: "B", senderType: "viewer", message: "private-b", isPrivate: true },
      { webinarId, sessionId: null, senderName: "Host", senderType: "host", message: "old-broadcast", isPrivate: false },
    ]);
    const attacker = await join(tokens[1], a.sessionId);
    expect(attacker.sessionId).toBe(b.sessionId);
    expect(attacker.messages.map(m => m.message)).toEqual(["private-b"]);
    const returningA = await join(tokens[0], b.sessionId);
    expect(returningA.messages.map(m => m.message)).toEqual(["private-a"]);
  } finally {
    for (const ws of sockets) ws.terminate();
  }
});

for (const embed of [false, true]) {
  for (const deniedStorage of [false, true]) {
    test(`mobile ${embed ? "embed" : "public"} registration opens its verified viewer with ${deniedStorage ? "blocked" : "available"} storage`, async ({ page, context }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await db.update(schema.webinars).set({ vimeoUrl: "https://vimeo.com/76979871" }).where(eq(schema.webinars.id, webinarId));
      await context.route(/https:\/\/(connect\.facebook\.net|www\.facebook\.com|www\.googletagmanager\.com|player\.vimeo\.com)\//, r => r.abort());
      if (deniedStorage) await context.addInitScript(() => {
        Object.defineProperty(window, "sessionStorage", { configurable: true, get() { throw new DOMException("Storage blocked", "SecurityError"); } });
      });
      await page.goto(embed ? `/embed/register/${webinarId}` : `/register/${webinarId}`);
      const prefix = embed ? "input-embed-" : "input-";
      await page.getByTestId(`${prefix}name`).fill("Mobile viewer test");
      await page.getByTestId(`${prefix}phone`).fill("0912345678");
      await page.getByTestId(`${prefix}email`).fill(`${randomUUID()}@example.test`);
      await page.getByTestId(embed ? "button-embed-session-dropdown" : "select-session").click();
      await page.getByTestId(embed ? "button-embed-session-on-demand" : "option-session-on-demand").click();
      const registered = page.waitForResponse(r => r.url().endsWith("/api/registrations") && r.request().method() === "POST");
      await page.getByTestId(embed ? "button-embed-register" : "button-register").click();
      const response = await registered;
      expect(response.status()).toBe(200);
      const result = await response.json();
      const enter = page.getByTestId(embed ? "button-embed-enter-webinar" : "button-enter-webinar");
      await expect(enter).toBeVisible();
      let viewer = page;
      if (embed) {
        // noopener means the new page has no inherited registration storage.
        const opened = context.waitForEvent("page");
        await enter.click();
        viewer = await opened;
        await viewer.setViewportSize({ width: 390, height: 844 });
        await expect.poll(() => new URL(viewer.url()).pathname).toBe(`/webinar/${webinarId}`);
      } else {
        await enter.click();
        await expect.poll(() => new URL(page.url()).pathname).toBe(`/webinar/${webinarId}`);
      }
      // Do not print the private URL or token in assertions or logs.
      expect(new URL(viewer.url()).searchParams.get("watchToken") === result.watchToken).toBe(true);
      await expect(viewer.getByTestId("input-nickname")).toBeVisible({ timeout: 20_000 });
      await expect(viewer.getByText("內容暫時無法使用", { exact: true })).toHaveCount(0);
      const state = await viewer.request.get(`/api/webinars/${webinarId}/watch-state`, { params: { watchToken: result.watchToken } });
      expect(state.status()).toBe(200);
      const verified = await state.json();
      expect(verified.canWatch).toBe(true);
      expect(verified.registrationId === result.id).toBe(true);
      await viewer.reload();
      await expect(viewer.getByTestId("input-nickname")).toBeVisible();
      if (embed) await viewer.close();
    });
  }
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
