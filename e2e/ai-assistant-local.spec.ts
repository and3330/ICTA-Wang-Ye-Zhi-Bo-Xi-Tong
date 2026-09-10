import { expect, test, type Page } from "@playwright/test";
import {
  aiKnowledgeInputSchema, aiKnowledgeUpdateSchema, aiLogReviewSchema,
  aiReplySettingsPatchSchema, aiTestQuestionSchema, aiWebsiteInputSchema,
  type AiKnowledgeSource, type AiReplyLogEntry, type AiReplySettings,
} from "../shared/aiAssistant";

const webinarId = "22222222-2222-4222-8222-222222222222";
const originalLogId = "33333333-3333-4333-8333-333333333333";
const createdAt = "2026-09-10T12:00:00.000Z";
const originalAnswer = "舊的測試答案，需要由主辦方修正。";
const makeLog = (overrides: Partial<AiReplyLogEntry> = {}): AiReplyLogEntry => ({
  id: originalLogId, webinarId, sessionId: "viewer-session-a", kind: "live",
  question: "如何取得課程講義？", answer: originalAnswer, status: "answered",
  sources: [{ id: "initial-source", title: "課程說明", excerpt: "講義可從會員頁面取得。" }],
  model: "test-model", durationMs: 420, pointsCharged: 1, errorMessage: null,
  reviewStatus: "unreviewed", correctedAnswer: null, reviewNotes: null,
  correctionDocumentId: null, reviewedAt: null, createdAt, ...overrides,
});

async function mockAssistant(page: Page) {
  let settings: AiReplySettings = {
    enabled: true, teacherName: "課程小助理", instructions: "請依照課程說明回答。",
    knowledgeOnly: true, fallbackMessage: "請聯繫主辦團隊。", outOfPointsMessage: "",
  };
  const sources: AiKnowledgeSource[] = [];
  const logs: AiReplyLogEntry[] = [makeLog()];
  const patches: unknown[] = [];
  const reviews: unknown[] = [];
  let points = 10;
  let failTest = false;
  let failRefresh = false;
  const root = `/api/webinars/${webinarId}`;
  await page.route("**/api/ai-points", route => route.fulfill({ json: { points, unlimited: false } }));
  await page.route(`**${root}/ai/settings`, async route => {
    if (route.request().method() === "PATCH") {
      const body = aiReplySettingsPatchSchema.parse(route.request().postDataJSON());
      patches.push(body);
      settings = { ...settings, ...body };
    }
    await route.fulfill({ json: { webinarId, webinarTitle: "AI 助理測試直播", settings } });
  });
  await page.route(`**${root}/documents`, async route => {
    if (route.request().method() === "POST") {
      const body = aiKnowledgeInputSchema.parse(route.request().postDataJSON());
      const source: AiKnowledgeSource = {
        id: `source-${sources.length + 1}`, webinarId, ...body, sourceUrl: null, createdAt, updatedAt: createdAt,
      };
      sources.push(source);
      await route.fulfill({ status: 201, json: source });
    } else await route.fulfill({ json: sources });
  });
  await page.route(`**${root}/documents/*`, async route => {
    const id = route.request().url().split("/").pop();
    const index = sources.findIndex(source => source.id === id);
    if (index < 0) return route.fulfill({ status: 404, json: { message: "資料不存在" } });
    if (route.request().method() === "DELETE") {
      sources.splice(index, 1);
      return route.fulfill({ json: { success: true } });
    }
    const body = aiKnowledgeUpdateSchema.parse(route.request().postDataJSON());
    sources[index] = { ...sources[index], ...body, updatedAt: "2026-09-10T12:30:00.000Z" };
    await route.fulfill({ json: sources[index] });
  });
  await page.route(`**${root}/ai/sources/website`, async route => {
    const body = aiWebsiteInputSchema.parse(route.request().postDataJSON());
    const source: AiKnowledgeSource = {
      id: "website-source", webinarId, title: body.title || "網站資料", content: "擷取到的網頁說明。",
      sourceType: "website", sourceUrl: body.url, createdAt, updatedAt: createdAt,
    };
    sources.push(source);
    await route.fulfill({ status: 201, json: source });
  });
  await page.route(`**${root}/ai/sources/*/refresh`, async route => {
    if (failRefresh) return route.fulfill({ status: 502, json: { message: "網站暫時無法讀取，原始資料已保留。" } });
    await route.fulfill({ json: sources.find(source => source.id === "website-source") });
  });
  await page.route(`**${root}/ai/sources/file`, async route => {
    expect(route.request().headers()["content-type"]).toContain("multipart/form-data");
    const source: AiKnowledgeSource = {
      id: "file-source", webinarId, title: "課程筆記", content: "檔案中的課程筆記。",
      sourceType: "file", sourceUrl: null, createdAt, updatedAt: createdAt,
    };
    sources.push(source);
    await route.fulfill({ status: 201, json: source });
  });
  await page.route(new RegExp(`${root}/ai/logs(?:\\?.*)?$`), async route => {
    const params = new URL(route.request().url()).searchParams;
    const search = params.get("search") || "";
    const filtered = logs.filter(log => (!search || `${log.question} ${log.answer}`.includes(search))
      && (!params.get("kind") || log.kind === params.get("kind"))
      && (!params.get("status") || log.status === params.get("status"))
      && (!params.get("reviewStatus") || log.reviewStatus === params.get("reviewStatus")));
    await route.fulfill({ json: { items: filtered, total: filtered.length, page: 1, pageSize: 20 } });
  });
  await page.route(`**${root}/ai/logs/*/review`, async route => {
    const body = aiLogReviewSchema.parse(route.request().postDataJSON());
    reviews.push(body);
    const id = route.request().url().split("/").at(-2);
    const index = logs.findIndex(log => log.id === id);
    expect(index).toBeGreaterThanOrEqual(0);
    const log = logs[index];
    if (body.addToKnowledge) {
      const source: AiKnowledgeSource = {
        id: log.correctionDocumentId || `correction-${id}`, webinarId, title: `已確認問答：${log.question}`,
        content: `問題：${log.question}\n答案：${body.correctedAnswer}`, sourceType: "correction",
        sourceUrl: null, createdAt, updatedAt: createdAt,
      };
      const sourceIndex = sources.findIndex(item => item.id === source.id);
      if (sourceIndex < 0) sources.push(source); else sources[sourceIndex] = source;
      log.correctionDocumentId = source.id;
    }
    logs[index] = {
      ...log, reviewStatus: body.reviewStatus, correctedAnswer: body.correctedAnswer || log.correctedAnswer,
      reviewNotes: body.notes || null, reviewedAt: createdAt,
    };
    await route.fulfill({ json: logs[index] });
  });
  await page.route(`**${root}/ai/test-question`, async route => {
    const body = aiTestQuestionSchema.parse(route.request().postDataJSON());
    if (failTest) return route.fulfill({ status: 503, json: { message: "測試回覆暫時無法完成，未扣除點數。" } });
    points--;
    const log = makeLog({ id: "test-log", question: body.question, answer: "這是根據已儲存資料產生的測試回覆。", kind: "test", sessionId: null });
    logs.unshift(log);
    await route.fulfill({ json: { answer: log.answer, status: log.status, sources: log.sources, pointsCharged: 1, unlimited: false, logId: log.id } });
  });
  return {
    patches, sources, logs, reviews,
    failNextTest: () => { failTest = true; },
    failNextRefresh: () => { failRefresh = true; },
  };
}

test("persona settings use the actual schema and survive reload", async ({ page }) => {
  const mock = await mockAssistant(page);
  await page.goto(`/admin/webinar/${webinarId}/ai`);
  const instructions = "你是課程的 AI 助理。\n使用繁體中文；找不到答案時請聯繫主辦方，不得自行承諾。";
  await page.getByTestId("ai-instructions").fill(instructions);
  await page.getByTestId("ai-settings-save").click();
  await expect.poll(() => mock.patches.length).toBe(1);
  expect(mock.patches[0]).toMatchObject({ instructions, enabled: true });
  await page.reload();
  await expect(page.getByTestId("ai-instructions")).toHaveValue(instructions);
});

test("knowledge text can be created, edited, reloaded and deleted", async ({ page }) => {
  const mock = await mockAssistant(page);
  await page.goto(`/admin/webinar/${webinarId}/ai`);
  await page.getByRole("tab", { name: "知識資料", exact: true }).click();
  await page.getByTestId("ai-source-add-text").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("標題", { exact: true }).fill("上課方式");
  await dialog.getByLabel("內容", { exact: true }).fill("登入會員頁面後，即可依照指示觀看課程。");
  await page.getByTestId("ai-source-save").click();
  await expect.poll(() => mock.sources.length).toBe(1);
  expect(mock.sources[0]).toMatchObject({ title: "上課方式", sourceType: "text" });
  await expect(page.getByText("上課方式", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: "知識資料", exact: true }).click();
  await expect(page.getByText("上課方式", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "檢視或編輯 上課方式", exact: true }).click();
  await page.getByRole("dialog").getByLabel("內容", { exact: true }).fill("這是已更新的觀看方式。");
  await page.getByTestId("ai-source-save").click();
  await expect.poll(() => mock.sources[0].content).toBe("這是已更新的觀看方式。");
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "刪除 上課方式", exact: true }).click();
  await expect.poll(() => mock.sources.length).toBe(0);
  await expect(page.getByText("尚未加入知識資料", { exact: true })).toBeVisible();
});

test("Q&A sources save both the question and the answer", async ({ page }) => {
  const mock = await mockAssistant(page);
  await page.goto(`/admin/webinar/${webinarId}/ai`);
  await page.getByRole("tab", { name: "知識資料", exact: true }).click();
  await page.getByTestId("ai-source-add-qa").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("標題", { exact: true }).fill("講義取得問答");
  await dialog.getByLabel("問題", { exact: true }).fill("如何取得講義？");
  await dialog.getByLabel("答案", { exact: true }).fill("請查看會員頁面的附件。");
  await page.getByTestId("ai-source-save").click();
  await expect.poll(() => mock.sources.length).toBe(1);
  expect(mock.sources[0].sourceType).toBe("qa");
  expect(mock.sources[0].content).toContain("如何取得講義？");
  expect(mock.sources[0].content).toContain("請查看會員頁面的附件。");
});

test("website and text-file imports use real API shapes and retain sources on failed refresh", async ({ page }) => {
  const mock = await mockAssistant(page);
  await page.goto(`/admin/webinar/${webinarId}/ai`);
  await page.getByRole("tab", { name: "知識資料", exact: true }).click();
  await page.getByTestId("ai-source-add-website").click();
  await page.getByRole("dialog").getByLabel("網站網址", { exact: true }).fill("https://example.com/course");
  await page.getByTestId("ai-source-save").click();
  await expect(page.getByText("網站資料", { exact: true })).toBeVisible();
  mock.failNextRefresh();
  await page.getByRole("button", { name: "重新擷取 網站資料", exact: true }).click();
  await expect(page.getByText("網站暫時無法讀取，原始資料已保留。", { exact: false }).last()).toBeVisible();
  expect(mock.sources[0].content).toBe("擷取到的網頁說明。");
  await page.getByLabel("上傳檔案", { exact: true }).setInputFiles({
    name: "course.txt", mimeType: "text/plain", buffer: Buffer.from("檔案中的課程筆記。", "utf8"),
  });
  await page.getByTestId("ai-source-add-file").click();
  await expect(page.getByText("課程筆記", { exact: true })).toBeVisible();
  expect(mock.sources.some(source => source.sourceType === "file")).toBe(true);
});

test("correcting a logged reply retains the original and can update knowledge", async ({ page }) => {
  const mock = await mockAssistant(page);
  await page.goto(`/admin/webinar/${webinarId}/ai`);
  await page.getByRole("tab", { name: "回覆紀錄", exact: true }).click();
  await page.getByTestId(`ai-log-row-${originalLogId}`).click();
  await expect(page.getByText(originalAnswer, { exact: true }).last()).toBeVisible();
  await page.getByTestId("ai-log-corrected-answer").fill("講義可從會員頁面的課程附件區取得。");
  await page.getByTestId("ai-log-review-save").click();
  await expect.poll(() => mock.reviews.length).toBe(1);
  expect(mock.reviews[0]).toMatchObject({
    reviewStatus: "corrected", correctedAnswer: "講義可從會員頁面的課程附件區取得。", addToKnowledge: true,
  });
  expect(mock.logs[0].answer).toBe(originalAnswer);
  expect(mock.sources[0]).toMatchObject({ sourceType: "correction" });
  await expect(page.getByText(originalAnswer, { exact: true }).last()).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: "回覆紀錄", exact: true }).click();
  await page.getByTestId(`ai-log-row-${originalLogId}`).click();
  await expect(page.getByTestId("ai-log-corrected-answer")).toHaveValue("講義可從會員頁面的課程附件區取得。");
});

test("test replies show actual results and errors without inventing answers", async ({ page }) => {
  const mock = await mockAssistant(page);
  await page.goto(`/admin/webinar/${webinarId}/ai`);
  await page.getByTestId("ai-test-question").fill("如何觀看課程？");
  await page.getByTestId("ai-test-submit").click();
  await expect(page.getByTestId("ai-test-answer")).toContainText("這是根據已儲存資料產生的測試回覆。");
  expect(mock.logs[0].kind).toBe("test");
  mock.failNextTest();
  await page.getByTestId("ai-test-question").fill("第二個測試問題？");
  await page.getByTestId("ai-test-submit").click();
  await expect(page.getByText("測試回覆暫時無法完成，未扣除點數。", { exact: false }).last()).toBeVisible();
  expect(mock.logs.filter(log => log.kind === "test")).toHaveLength(1);
});

test("mobile settings and logs fit without horizontal overflow", async ({ page }) => {
  await mockAssistant(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/admin/webinar/${webinarId}/ai`);
  await expect(page.getByTestId("ai-instructions")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.getByRole("tab", { name: "回覆紀錄", exact: true }).click();
  await page.getByTestId(`ai-log-row-${originalLogId}`).click();
  await expect(page.getByTestId("ai-log-corrected-answer")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: "/tmp/ai-assistant-mobile.png", fullPage: true });
});