import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const webinarId = "sales-script-webinar";
const webinar = {
  id: webinarId,
  title: "內容工作坊",
  description: "幫助創作者整理出可執行的內容流程。",
  publishStatus: "published",
  startTime: "2026-01-01T01:00:00.000Z",
  videoDuration: 3600,
  scheduleMode: { recurring: true },
};

const answers = {
  planName: "內容工作坊",
  instructor: "林老師；具有公開可核對的教學與專案經驗。",
  audience: "已有服務但還沒有固定內容流程的創作者。",
  painPoints: "每週都重新開始，不知道要先做什麼。",
  modules: "模組一：主題規劃；模組二：製作流程；模組三：檢查與迭代。",
  pricing: "原價與目前方案均以實際頁面為準，可分期。",
  bonuses: "無贈品",
};

const optionalAnswer = "作品集與公開課程頁面，可供參加者核對。";
const unpaidOnlyText = ["六段式銷講稿", "核心技巧", "段落 1"];

type SalesScriptMockOptions = {
  points?: number;
  failure?: boolean;
  timeout?: boolean;
  initialRunning?: boolean;
  existingCompleted?: boolean;
  draftSaveFailure?: boolean;
};

type SalesScriptMock = {
  getJobPostCount: () => number;
  getIdempotencyKeys: () => string[];
  getDraftBodies: () => unknown[];
  getJobBodies: () => unknown[];
};

async function mockSalesScript(
  page: Page,
  options: SalesScriptMockOptions = {},
): Promise<SalesScriptMock> {
  let savedAnswers: Record<string, string> = {};
  let statusCalls = 0;
  let generated = options.initialRunning === true;
  let jobPostCount = 0;
  const idempotencyKeys: string[] = [];
  const draftBodies: unknown[] = [];
  const jobBodies: unknown[] = [];

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === `/api/webinars/${webinarId}`) return route.fulfill({ json: webinar });
    if (path === "/api/webinars") return route.fulfill({ json: [webinar] });
    if (path === "/api/ai-points") {
      return route.fulfill({
        json: { points: options.points ?? 7200, unlimited: false, packages: [] },
      });
    }
    if (path === "/api/trial") return route.fulfill({ json: { state: "none" } });
    if (path === "/api/admin/subscription") {
      return route.fulfill({
        json: {
          plan: "growth",
          active: true,
          maxWebinars: 5,
          webinarCount: 1,
          publishedCount: 1,
          isSuperAdmin: false,
        },
      });
    }
    if (path === "/api/stripe/config") {
      return route.fulfill({ json: { billingAvailable: false, catalogReady: false, plans: [] } });
    }
    if (path === `/api/webinars/${webinarId}/sales-script`) {
      return route.fulfill({
        json: {
          availablePoints: options.points ?? 7200,
          requiredPoints: 3600,
          draft: { answers: savedAnswers, updatedAt: "2026-01-01T01:00:00.000Z" },
          jobs: [
            ...(options.existingCompleted
              ? [
                  {
                    id: "sales-job-old",
                    status: "completed",
                    costPoints: 3600,
                    completedStages: 6,
                    attemptCount: 1,
                    errorMessage: null,
                    createdAt: "2025-12-31T01:00:00.000Z",
                    completedAt: "2025-12-31T01:10:00.000Z",
                  },
                ]
              : []),
            ...(generated
              ? [
                  {
                    id: "sales-job-1",
                    status: options.failure
                      ? "failed"
                      : statusCalls > 1
                        ? "completed"
                        : "running",
                    costPoints: 3600,
                    completedStages: statusCalls > 1 ? 6 : 2,
                    attemptCount: 1,
                    errorMessage: options.failure ? "模型服務失敗，已退款。" : null,
                    createdAt: "2026-01-01T01:00:00.000Z",
                    completedAt:
                      options.failure || statusCalls > 1
                        ? "2026-01-01T01:10:00.000Z"
                        : null,
                  },
                ]
              : []),
          ],
        },
      });
    }
    if (path === `/api/webinars/${webinarId}/sales-script/draft`) {
      if (request.method() === "PUT") {
        const body = (await request.postDataJSON()) as {
          answers?: Record<string, string>;
        };
        draftBodies.push(body);
        if (options.draftSaveFailure) {
          return route.fulfill({
            status: 500,
            json: { message: "draft save failed in local fixture" },
          });
        }
        savedAnswers = body.answers || {};
        return route.fulfill({ status: 204 });
      }
      return route.fulfill({ status: 204 });
    }
    if (path === `/api/webinars/${webinarId}/sales-script/jobs`) {
      jobPostCount += 1;
      jobBodies.push(await request.postDataJSON());
      idempotencyKeys.push(request.headers()["idempotency-key"] || "");
      generated = true;
      if (options.timeout) {
        await new Promise((resolve) => setTimeout(resolve, 11_000));
        try {
          return route.fulfill({ json: { id: "sales-job-1", jobId: "sales-job-1", status: "queued" } });
        } catch {
          return;
        }
      }
      return route.fulfill({
        json: { id: "sales-job-1", jobId: "sales-job-1", status: "queued" },
      });
    }
    if (path === `/api/webinars/${webinarId}/sales-script/jobs/sales-job-1`) {
      statusCalls += 1;
      if (options.failure) {
        return route.fulfill({
          json: {
            id: "sales-job-1",
            status: "failed",
            error: "模型服務失敗",
            refunded: true,
          },
        });
      }
      return route.fulfill({
        json:
          statusCalls < 2
            ? { id: "sales-job-1", status: "running", progress: 45, stage: "drafting" }
            : {
                id: "sales-job-1",
                status: "completed",
                output: "# 六段式銷講稿\n真實資料輸出",
                pointsCharged: 3600,
              },
      });
    }
    if (path === `/api/webinars/${webinarId}/sales-script/jobs/sales-job-old`) {
      return route.fulfill({
        json: {
          id: "sales-job-old",
          status: "completed",
          result: {
            language: "zh-TW",
            totalDurationMinutes: 90,
            sections: [
              {
                sectionNumber: 1,
                title: "確認",
                durationMinutes: 12,
                slides: [
                  {
                    slideTitle: "舊版本",
                    purpose: "保留舊版本的可見歷史內容。",
                    spokenVerbatim: "這是已完成的歷史稿件。",
                    interaction: "無，繼續講述",
                    durationMinutes: 1,
                  },
                ],
              },
            ],
          },
        },
      });
    }
    if (path === `/api/webinars/${webinarId}/analytics`) {
      return route.fulfill({
        json: {
          webinar,
          summary: {
            totalRegistrations: 0,
            attended: 0,
            attendanceRate: 0,
            avgWatchTime: 0,
            videoDuration: 3600,
          },
          analytics: [],
          registrations: [],
        },
      });
    }
    if (path === `/api/webinars/${webinarId}/session-registration-counts`) {
      return route.fulfill({ json: { totalRegistered: 0, counts: [] } });
    }
    if (path === `/api/webinars/${webinarId}/funnel-analytics`) {
      return route.fulfill({
        json: {
          webinarId,
          range: { from: null, to: null },
          counts: {},
          uniqueViewers: 0,
          uniqueByStage: {},
          stageConversionRates: [],
          ctaPerformance: [],
          dropoffBuckets: [],
          revenue: {},
          checkoutToPurchaseRate: 0,
        },
      });
    }
    if (path === "/api/products" || path === "/api/product-sales-pages") {
      return route.fulfill({ json: [] });
    }
    return route.fulfill({ json: [] });
  });

  return {
    getJobPostCount: () => jobPostCount,
    getIdempotencyKeys: () => [...idempotencyKeys],
    getDraftBodies: () => [...draftBodies],
    getJobBodies: () => [...jobBodies],
  };
}

async function dismissCookieConsent(page: Page) {
  const dismiss = page.getByRole("button", { name: "僅使用必要功能" });
  if (await dismiss.isVisible().catch(() => false)) await dismiss.click();
}

async function fillBasicQuestions(page: Page) {
  await page.getByTestId("input-sales-script-planName").fill(answers.planName);
  await page.getByTestId("input-sales-script-audience").fill(answers.audience);
  await page.getByTestId("input-sales-script-painPoints").fill(answers.painPoints);
  await page.getByTestId("input-sales-script-modules").fill(answers.modules);
  await page.getByTestId("input-sales-script-pricing").fill(answers.pricing);
}

async function fillAdditionalQuestions(page: Page, includeOptional = false) {
  await page.getByTestId("input-sales-script-instructor").fill(answers.instructor);
  await page.getByTestId("input-sales-script-bonuses").fill(answers.bonuses);
  if (includeOptional) {
    const storyDetails = page.locator("details").filter({ hasText: "講師與公開資料" });
    await storyDetails.locator("summary").click();
    await page.getByTestId("input-sales-script-instructorAuthority").fill(optionalAnswer);
  }
}

async function advanceToDetails(page: Page, includeOptional = false) {
  await fillBasicQuestions(page);
  await page.getByTestId("button-sales-script-to-summary").click();
  await expect(page.getByTestId("sales-script-step-summary")).toBeVisible();
  await page.getByTestId("button-sales-script-buy-intent").click();
  await expect(page.getByTestId("sales-script-step-details")).toBeVisible();
  await fillAdditionalQuestions(page, includeOptional);
}

async function confirmGeneration(page: Page) {
  await page.getByTestId("button-generate-sales-script").click();
  await expect(page.getByTestId("sales-script-fee-modal")).toContainText("3,600 點");
  await page.getByTestId("checkbox-confirm-sales-script-fee").click();
  await page.getByTestId("button-confirm-sales-script-fee").click();
}

test("value flow keeps unpaid intro private, reviews basics, and posts only after final fee confirmation", async ({
  page,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "http://127.0.0.1:5000",
  });
  const fixture = await mockSalesScript(page);
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto(`/admin/webinar/${webinarId}`);
  await dismissCookieConsent(page);
  await page.getByTestId("tab-sales-script").click();
  await expect(page.getByTestId("sales-script-step-basics")).toBeVisible();
  await page.screenshot({ path: "/tmp/sales-value-intro.png", fullPage: false });

  const unpaidPage = page.getByTestId("sales-script-generator");
  for (const text of unpaidOnlyText) await expect(unpaidPage).not.toContainText(text);
  expect(fixture.getJobPostCount()).toBe(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).resolves.toBe(
    true,
  );
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.getByTestId("button-sales-script-to-summary").click();
  await expect(page.getByTestId("sales-script-step-basics")).toBeVisible();
  await expect(page.getByText("請完成五項基本資料", { exact: true })).toBeVisible();
  expect(fixture.getJobPostCount()).toBe(0);

  await fillBasicQuestions(page);
  await page.getByTestId("button-sales-script-to-summary").click();
  await expect(page.getByTestId("sales-script-step-summary")).toBeVisible();
  await expect(page.getByTestId("sales-script-step-summary")).toContainText(answers.planName);
  await expect(page.getByTestId("sales-script-step-summary")).toContainText(answers.audience);
  await expect(page.getByTestId("sales-script-step-summary")).toContainText(answers.painPoints);
  await expect(page.getByTestId("sales-script-step-summary")).toContainText(answers.modules);
  await expect(page.getByTestId("sales-script-step-summary")).toContainText(answers.pricing);
  expect(fixture.getDraftBodies().length).toBeGreaterThan(0);
  expect(fixture.getDraftBodies().at(-1)).toMatchObject({
    answers: expect.objectContaining({
      planName: answers.planName,
      audience: answers.audience,
      painPoints: answers.painPoints,
      modules: answers.modules,
      pricing: answers.pricing,
    }),
  });
  expect(fixture.getJobPostCount()).toBe(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("sales-script-step-summary").screenshot({
    path: "/tmp/sales-value-summary-mobile.png",
  });
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).resolves.toBe(
    true,
  );
  await page.setViewportSize({ width: 1024, height: 800 });

  await page.getByTestId("button-sales-script-back-basics").click();
  await expect(page.getByTestId("sales-script-step-basics")).toBeVisible();
  await expect(page.getByTestId("input-sales-script-planName")).toHaveValue(answers.planName);
  await expect(page.getByTestId("input-sales-script-modules")).toHaveValue(answers.modules);
  await page.getByTestId("button-sales-script-to-summary").click();
  await page.getByTestId("button-sales-script-buy-intent").click();
  await expect(page.getByTestId("sales-script-step-details")).toBeVisible();
  await fillAdditionalQuestions(page, true);
  for (const text of unpaidOnlyText) await expect(unpaidPage).not.toContainText(text);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).resolves.toBe(
    true,
  );
  await page.setViewportSize({ width: 1024, height: 800 });

  await expect(page.getByTestId("button-generate-sales-script")).toBeEnabled();
  await page.getByTestId("button-generate-sales-script").click();
  await expect(page.getByTestId("sales-script-fee-modal")).toContainText("3,600 點");
  expect(fixture.getJobPostCount()).toBe(0);
  await page.getByTestId("checkbox-confirm-sales-script-fee").click();
  await page.getByTestId("button-confirm-sales-script-fee").click();
  await expect.poll(() => fixture.getJobPostCount()).toBe(1);
  const jobBody = fixture.getJobBodies()[0] as {
    ackCost?: number;
    idempotencyKey?: string;
    answers?: Record<string, string>;
  };
  expect(jobBody).toMatchObject({
    ackCost: 3600,
    answers: expect.objectContaining({
      ...answers,
      instructorAuthority: optionalAnswer,
    }),
  });
  expect(jobBody.idempotencyKey).toMatch(/^[A-Za-z0-9._:-]{16,}$/);
  await expect(page.getByTestId("sales-script-running")).toBeVisible();
  await expect(page.getByTestId("sales-script-output")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("text-sales-script-output")).toContainText("真實資料輸出");
  await expect(page.getByTestId("button-copy-sales-script")).toBeVisible();
  await expect(page.getByTestId("button-download-sales-script-md")).toBeVisible();

  await page.getByTestId("button-copy-sales-script").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("真實資料輸出");
  const mdDownload = page.waitForEvent("download");
  await page.getByTestId("button-download-sales-script-md").click();
  const mdPath = await (await mdDownload).path();
  expect(mdPath).toBeTruthy();
  await expect(readFile(mdPath!, "utf8")).resolves.toContain("真實資料輸出");
  await page.getByRole("button", { name: "編輯副本" }).click();
  await page.getByTestId("textarea-sales-script-local-copy").fill(
    "# 本機編輯副本\n真實資料輸出\nLOCAL EDIT",
  );
  await page.getByTestId("button-copy-sales-script").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("LOCAL EDIT");
  await expect(page.getByText("已複製到剪貼簿", { exact: true })).toBeHidden({ timeout: 7_000 });
  const localTxtDownload = page.waitForEvent("download");
  await page.getByTestId("button-download-sales-script-txt").click();
  const localTxtPath = await (await localTxtDownload).path();
  expect(localTxtPath).toBeTruthy();
  await expect(readFile(localTxtPath!, "utf8")).resolves.toContain("LOCAL EDIT");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("sales-script-output").screenshot({ path: "/tmp/sales-script-result-mobile.png" });
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).resolves.toBe(
    true,
  );
  await page.reload();
  await page.getByTestId("tab-sales-script").click();
  await expect(page.getByTestId("sales-script-history-sales-job-1")).toContainText("已完成");
  await page.getByTestId("button-view-sales-script-sales-job-1").click();
  await expect(page.getByTestId("text-sales-script-output")).toContainText("真實資料輸出");
  await expect(page.getByTestId("text-sales-script-output")).not.toContainText("LOCAL EDIT");
  expect(fixture.getJobPostCount()).toBe(1);
  expect(fixture.getIdempotencyKeys()[0]).toBe(jobBody.idempotencyKey);
});

test("basic validation and back preservation never post; draft-save errors do not advance", async ({
  page,
}) => {
  const fixture = await mockSalesScript(page);
  await page.goto(`/admin/webinar/${webinarId}`);
  await dismissCookieConsent(page);
  await page.getByTestId("tab-sales-script").click();
  await page.getByTestId("button-sales-script-to-summary").click();
  await expect(page.getByTestId("sales-script-step-basics")).toBeVisible();
  await expect(page.getByText("請完成五項基本資料", { exact: true })).toBeVisible();
  expect(fixture.getJobPostCount()).toBe(0);

  await fillBasicQuestions(page);
  await page.getByTestId("button-sales-script-to-summary").click();
  await expect(page.getByTestId("sales-script-step-summary")).toBeVisible();
  await page.getByTestId("button-sales-script-back-basics").click();
  await expect(page.getByTestId("input-sales-script-audience")).toHaveValue(answers.audience);
  await expect(page.getByTestId("input-sales-script-pricing")).toHaveValue(answers.pricing);
  expect(fixture.getJobPostCount()).toBe(0);

  await page.unroute("**/api/**");
  const failingDraftFixture = await mockSalesScript(page, { draftSaveFailure: true });
  await page.reload();
  await dismissCookieConsent(page);
  await page.getByTestId("tab-sales-script").click();
  await fillBasicQuestions(page);
  await page.getByTestId("button-sales-script-to-summary").click();
  await expect(page.getByTestId("sales-script-step-basics")).toBeVisible();
  await expect(page.getByText("草稿儲存失敗", { exact: true })).toBeVisible();
  expect(failingDraftFixture.getJobPostCount()).toBe(0);
});

test("sales script generator explains insufficient points and failure refund", async ({ page }) => {
  const insufficientFixture = await mockSalesScript(page, { points: 50 });
  await page.goto(`/admin/webinar/${webinarId}`);
  await dismissCookieConsent(page);
  await page.getByTestId("tab-sales-script").click();
  await advanceToDetails(page);
  await expect(page.getByText("點數不足", { exact: false })).toBeVisible();
  await expect(page.getByTestId("button-generate-sales-script")).toBeDisabled();
  expect(insufficientFixture.getJobPostCount()).toBe(0);

  await page.unroute("**/api/**");
  const failureFixture = await mockSalesScript(page, { failure: true });
  await page.reload();
  await dismissCookieConsent(page);
  await page.getByTestId("tab-sales-script").click();
  await advanceToDetails(page);
  await expect(page.getByTestId("button-generate-sales-script")).toBeEnabled();
  await confirmGeneration(page);
  await expect(page.getByTestId("sales-script-failed")).toContainText("已退款", {
    timeout: 10_000,
  });
  await expect(page.getByTestId("sales-script-output")).toHaveCount(0);
  expect(failureFixture.getJobPostCount()).toBe(1);
});

test("unknown job POST timeout keeps its idempotency key and never double-charges", async ({ page }) => {
  test.setTimeout(40_000);
  const fixture = await mockSalesScript(page, { timeout: true });
  await page.goto(`/admin/webinar/${webinarId}`);
  await dismissCookieConsent(page);
  await page.getByTestId("tab-sales-script").click();
  await advanceToDetails(page);
  await confirmGeneration(page);
  await expect.poll(() => fixture.getJobPostCount()).toBe(1);
  const [idempotencyKey] = fixture.getIdempotencyKeys();
  expect(idempotencyKey).toMatch(/^[A-Za-z0-9._:-]{16,}$/);
  expect(fixture.getJobBodies()[0]).toMatchObject({
    idempotencyKey,
    ackCost: 3600,
  });
  await expect(page.getByTestId("sales-script-timeout")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("sales-script-timeout")).toContainText(idempotencyKey);
  await expect(page.getByTestId("sales-script-output")).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1_000);
  expect(fixture.getJobPostCount()).toBe(1);
});

test("reload resumes a new running job while an older completed history stays viewable", async ({
  page,
}) => {
  await mockSalesScript(page, { initialRunning: true, existingCompleted: true });
  await page.goto(`/admin/webinar/${webinarId}`);
  await dismissCookieConsent(page);
  await page.getByTestId("tab-sales-script").click();
  await expect(page.getByTestId("sales-script-running")).toBeVisible();
  await expect(page.getByTestId("sales-script-history-sales-job-old")).toContainText("已完成");
  await page.getByTestId("button-view-sales-script-sales-job-old").click();
  await expect(page.getByTestId("text-sales-script-output")).toContainText("舊版本");
  await expect(page.getByTestId("sales-script-running")).toBeVisible();
});