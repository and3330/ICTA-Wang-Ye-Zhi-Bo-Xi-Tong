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
  initiallyPurchased?: boolean;
  questionnaireFailure?: boolean;
  purchaseTimeout?: boolean;
  purchaseNeverReached?: boolean;
  jobNeverReached?: boolean;
  draftSaveFailureOnce?: boolean;
  draftSaveFailureAfterPurchaseOnce?: boolean;
  initialCompleted?: boolean;
};

type SalesScriptMock = {
  getJobPostCount: () => number;
  getPurchasePostCount: () => number;
  getIdempotencyKeys: () => string[];
  getPurchaseBodies: () => unknown[];
  getDraftBodies: () => unknown[];
  getJobBodies: () => unknown[];
};

async function mockSalesScript(
  page: Page,
  options: SalesScriptMockOptions = {},
): Promise<SalesScriptMock> {
  let savedAnswers: Record<string, string> = options.initiallyPurchased
    ? { ...answers }
    : {};
  let statusCalls = 0;
  let generated = options.initialRunning === true || options.initialCompleted === true;
  let purchased = options.initiallyPurchased === true;
  let repurchased = false;
  let jobPostCount = 0;
  let purchasePostCount = 0;
  let draftPutCount = 0;
  const idempotencyKeys: string[] = [];
  const purchaseBodies: unknown[] = [];
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
          // The server keeps completed/running paid history readable, while a
          // refunded failed job does not grant active questionnaire access.
          hasPurchasedAccess: options.failure
            ? purchased && !generated
            : purchased || generated,
          purchaseId: purchased ? "sales-purchase-1" : null,
          canGenerate: purchased && (!generated || repurchased),
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
                      : options.initialCompleted || statusCalls > 1
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
    if (path === `/api/webinars/${webinarId}/sales-script/questionnaire`) {
      if (!purchased || options.questionnaireFailure) {
        return route.fulfill({ status: options.questionnaireFailure ? 500 : 403, json: { message: "paid only" } });
      }
      const fields = [
        ["planName", "課程名稱", true],
        ["instructor", "講師姓名與背景", true],
        ["audience", "目標受眾", true],
        ["painPoints", "核心痛點", true],
        ["modules", "商品包含什麼", true],
        ["pricing", "定價策略", true],
        ["bonuses", "贈品總覽", true],
        ["instructorAuthority", "可核對的專業依據", false],
      ].map(([id, label, required]) => ({
        id,
        label,
        required,
        help: `伺服器回傳的 ${label}`,
        example: `伺服器回傳的 ${label} 示例`,
        multiline: true,
      }));
      return route.fulfill({
        json: {
          fields,
          groups: [
            {
              id: "server-private",
              title: "購買後專屬問卷",
              description: "只在付款確認後回傳。",
              fields,
            },
          ],
          requiredIds: fields.filter((field) => field.required).map((field) => field.id),
        },
      });
    }
    if (path === `/api/webinars/${webinarId}/sales-script/draft`) {
      if (request.method() === "PUT") {
        draftPutCount += 1;
        const body = (await request.postDataJSON()) as {
          answers?: Record<string, string>;
        };
        draftBodies.push(body);
        if (
          options.draftSaveFailure ||
          (options.draftSaveFailureOnce && draftPutCount === 1)
          || (
            options.draftSaveFailureAfterPurchaseOnce &&
            Object.keys(body.answers || {}).length > 5 &&
            !draftBodies.slice(0, -1).some((entry) =>
              Object.keys((entry as { answers?: Record<string, string> }).answers || {}).length > 5,
            )
          )
        ) {
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
    if (path === `/api/webinars/${webinarId}/sales-script/purchase`) {
      purchasePostCount += 1;
      const body = await request.postDataJSON();
      purchaseBodies.push(body);
      if ((options.points ?? 7200) < 3600) {
        return route.fulfill({ status: 402, json: { message: "AI 點數不足" } });
      }
      const purchaseFirstTimeout =
        options.purchaseTimeout &&
        (!options.purchaseNeverReached || purchasePostCount === 1);
      if (purchaseFirstTimeout) {
        if (!options.purchaseNeverReached) purchased = true;
        await new Promise((resolve) => setTimeout(resolve, 11_000));
        try {
          return route.fulfill({
            json: {
              purchase: { id: "sales-purchase-1", status: "paid" },
              hasPurchasedAccess: true,
              canGenerate: true,
            },
          });
        } catch {
          return;
        }
      }
      if (options.initialCompleted) repurchased = true;
      purchased = true;
      return route.fulfill({
        json: {
          purchase: { id: "sales-purchase-1", status: "paid" },
          hasPurchasedAccess: true,
          canGenerate: true,
        },
      });
    }
    if (path === `/api/webinars/${webinarId}/sales-script/jobs`) {
      jobPostCount += 1;
      jobBodies.push(await request.postDataJSON());
      idempotencyKeys.push(request.headers()["idempotency-key"] || "");
      if (options.jobNeverReached && jobPostCount === 1) {
        await new Promise((resolve) => setTimeout(resolve, 11_000));
        try {
          return route.fulfill({ json: { id: "sales-job-1", status: "queued" } });
        } catch {
          return;
        }
      }
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
    getPurchasePostCount: () => purchasePostCount,
    getIdempotencyKeys: () => [...idempotencyKeys],
    getPurchaseBodies: () => [...purchaseBodies],
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
    const storyDetails = page.locator("details").first();
    if ((await storyDetails.getAttribute("open")) === null) {
      await storyDetails.locator("summary").click();
    }
    await page.getByTestId("input-sales-script-instructorAuthority").fill(optionalAnswer);
  }
}

async function advanceToDetails(page: Page, includeOptional = false) {
  await fillBasicQuestions(page);
  await page.getByTestId("button-sales-script-to-summary").click();
  await expect(page.getByTestId("sales-script-step-summary")).toBeVisible();
  await page.getByTestId("button-sales-script-buy-intent").click();
  const feeModal = page.getByTestId("sales-script-fee-modal");
  if ((await feeModal.count()) > 0) {
    await feeModal.waitFor({ state: "visible", timeout: 2_000 }).catch(() => undefined);
  }
  if ((await feeModal.count()) > 0 && (await feeModal.isVisible().catch(() => false))) {
    const confirmCheckbox = page.getByTestId("checkbox-confirm-sales-script-fee");
    await confirmCheckbox.check();
    await expect(confirmCheckbox).toBeChecked();
    await page.getByTestId("button-confirm-sales-script-fee").click();
  }
  await expect(page.getByTestId("sales-script-step-details")).toBeVisible();
  await fillAdditionalQuestions(page, includeOptional);
}

async function confirmGeneration(page: Page) {
  await page.getByTestId("button-generate-sales-script").click();
}

test("value flow keeps unpaid intro private, buys before private questions, and posts one prepaid job", async ({
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
  await expect(page.getByTestId("input-sales-script-instructor")).toHaveCount(0);
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
  await expect(page.getByTestId("sales-script-fee-modal")).toContainText("3,600 AI 點數");
  expect(fixture.getPurchasePostCount()).toBe(0);
  await page.getByTestId("checkbox-confirm-sales-script-fee").click();
  await page.getByTestId("button-confirm-sales-script-fee").click();
  await expect(page.getByTestId("sales-script-step-details")).toBeVisible();
  await page.getByTestId("sales-script-step-details").screenshot({
    path: "/tmp/sales-paid-gate.png",
  });
  await expect(page.getByTestId("input-sales-script-instructor")).toBeVisible();
  expect(fixture.getPurchasePostCount()).toBe(1);
  expect(fixture.getPurchaseBodies()[0]).toMatchObject({
    ackCost: 3600,
    answers: {
      planName: answers.planName,
      audience: answers.audience,
      painPoints: answers.painPoints,
      modules: answers.modules,
      pricing: answers.pricing,
    },
  });
  await fillAdditionalQuestions(page, true);
  for (const text of unpaidOnlyText) await expect(unpaidPage).not.toContainText(text);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).resolves.toBe(
    true,
  );
  await page.setViewportSize({ width: 1024, height: 800 });

  await expect(page.getByTestId("button-generate-sales-script")).toBeEnabled();
  await page.getByTestId("button-generate-sales-script").click();
  await expect.poll(() => fixture.getJobPostCount()).toBe(1);
  const jobBody = fixture.getJobBodies()[0] as {
    ackCost?: number;
    idempotencyKey?: string;
    answers?: Record<string, string>;
  };
  expect(jobBody).toMatchObject({
    purchaseId: "sales-purchase-1",
    answers: expect.objectContaining({
      ...answers,
      instructorAuthority: optionalAnswer,
    }),
  });
  expect(jobBody.idempotencyKey).toMatch(/^[A-Za-z0-9._:-]{16,}$/);
  expect(fixture.getPurchasePostCount()).toBe(1);
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
  await fillBasicQuestions(page);
  await page.getByTestId("button-sales-script-to-summary").click();
  await page.getByTestId("button-sales-script-buy-intent").click();
  await page.getByTestId("checkbox-confirm-sales-script-fee").click();
  await page.getByTestId("button-confirm-sales-script-fee").click();
  await expect(page.getByText("購買失敗", { exact: true })).toBeVisible();
  await expect(page.getByTestId("sales-script-step-details")).toHaveCount(0);
  expect(insufficientFixture.getPurchasePostCount()).toBe(1);
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
  await expect(page.getByTestId("sales-script-step-details")).toHaveCount(0);
  expect(failureFixture.getJobPostCount()).toBe(1);
  expect(failureFixture.getPurchasePostCount()).toBe(1);
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
    purchaseId: "sales-purchase-1",
  });
  await expect(page.getByTestId("sales-script-timeout")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("sales-script-timeout")).toContainText(idempotencyKey);
  await expect(page.getByTestId("sales-script-output")).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1_000);
  expect(fixture.getJobPostCount()).toBe(1);
});

test("unknown purchase POST timeout reconciles paid access without a second purchase", async ({ page }) => {
  test.setTimeout(40_000);
  const fixture = await mockSalesScript(page, { purchaseTimeout: true });
  await page.goto(`/admin/webinar/${webinarId}`);
  await dismissCookieConsent(page);
  await page.getByTestId("tab-sales-script").click();
  await fillBasicQuestions(page);
  await page.getByTestId("button-sales-script-to-summary").click();
  await page.getByTestId("button-sales-script-buy-intent").click();
  await page.getByTestId("checkbox-confirm-sales-script-fee").click();
  await page.getByTestId("button-confirm-sales-script-fee").click();
  await expect.poll(() => fixture.getPurchasePostCount()).toBe(1);
  await expect(page.getByTestId("sales-script-step-details")).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await dismissCookieConsent(page);
  await page.getByTestId("tab-sales-script").click();
  await expect(page.getByTestId("sales-script-step-details")).toBeVisible();
  expect(fixture.getPurchasePostCount()).toBe(1);
});

test("never-reached purchase can be retried with the exact same key and body", async ({ page }) => {
  test.setTimeout(40_000);
  const fixture = await mockSalesScript(page, {
    purchaseTimeout: true,
    purchaseNeverReached: true,
  });
  await page.goto(`/admin/webinar/${webinarId}`);
  await dismissCookieConsent(page);
  await page.getByTestId("tab-sales-script").click();
  await fillBasicQuestions(page);
  await page.getByTestId("button-sales-script-to-summary").click();
  await page.getByTestId("button-sales-script-buy-intent").click();
  await page.getByTestId("checkbox-confirm-sales-script-fee").click();
  await page.getByTestId("button-confirm-sales-script-fee").click();
  await expect(page.getByTestId("button-retry-sales-script-purchase")).toBeVisible({
    timeout: 15_000,
  });
  await page.getByTestId("button-retry-sales-script-purchase").click();
  await expect(page.getByTestId("sales-script-step-details")).toBeVisible();
  await expect.poll(() => fixture.getPurchasePostCount()).toBe(2);
  expect(fixture.getPurchaseBodies()[1]).toEqual(fixture.getPurchaseBodies()[0]);
});

test("never-reached generation can be retried with the exact same key and body", async ({ page }) => {
  test.setTimeout(40_000);
  const fixture = await mockSalesScript(page, { jobNeverReached: true });
  await page.goto(`/admin/webinar/${webinarId}`);
  await dismissCookieConsent(page);
  await page.getByTestId("tab-sales-script").click();
  await advanceToDetails(page);
  await confirmGeneration(page);
  await expect(page.getByTestId("button-retry-sales-script-generation")).toBeVisible({
    timeout: 15_000,
  });
  const firstBody = fixture.getJobBodies()[0];
  await page.getByTestId("button-retry-sales-script-generation").click();
  await expect.poll(() => fixture.getJobPostCount()).toBe(2);
  expect(fixture.getJobBodies()[1]).toEqual(firstBody);
  expect(fixture.getPurchasePostCount()).toBe(1);
});

test("final draft save failure does not reserve a job and retry uses the same purchase", async ({ page }) => {
  const fixture = await mockSalesScript(page, {
    draftSaveFailureAfterPurchaseOnce: true,
  });
  await page.goto(`/admin/webinar/${webinarId}`);
  await dismissCookieConsent(page);
  await page.getByTestId("tab-sales-script").click();
  await advanceToDetails(page);
  await fillAdditionalQuestions(page);
  await page.getByTestId("button-generate-sales-script").click();
  await expect(page.getByText("草稿儲存失敗", { exact: true })).toBeVisible();
  expect(fixture.getJobPostCount()).toBe(0);
  expect(fixture.getPurchasePostCount()).toBe(1);
  await page.getByTestId("button-generate-sales-script").click();
  await expect.poll(() => fixture.getJobPostCount()).toBe(1);
  expect(fixture.getPurchasePostCount()).toBe(1);
});

test("completed paid history can start a new 3600-point purchase", async ({ page }) => {
  const fixture = await mockSalesScript(page, {
    initiallyPurchased: true,
    initialCompleted: true,
  });
  await page.goto(`/admin/webinar/${webinarId}`);
  await dismissCookieConsent(page);
  await page.getByTestId("tab-sales-script").click();
  const toSummary = page.getByTestId("button-sales-script-to-summary");
  if ((await toSummary.count()) > 0 && (await toSummary.isVisible())) {
    await toSummary.click();
  }
  await expect(page.getByTestId("sales-script-step-summary")).toBeVisible();
  await expect(page.getByTestId("button-sales-script-buy-intent")).toContainText("再次購買");
  await page.getByTestId("button-sales-script-buy-intent").click();
  await page.getByTestId("checkbox-confirm-sales-script-fee").click();
  await page.getByTestId("button-confirm-sales-script-fee").click();
  await expect(page.getByTestId("sales-script-step-details")).toBeVisible();
  expect(fixture.getPurchasePostCount()).toBe(1);
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

test("paid access restores with zero balance and submits one job without another purchase", async ({
  page,
}) => {
  const fixture = await mockSalesScript(page, {
    points: 0,
    initiallyPurchased: true,
  });
  await page.goto(`/admin/webinar/${webinarId}`);
  await dismissCookieConsent(page);
  await page.getByTestId("tab-sales-script").click();
  await expect(page.getByTestId("sales-script-step-details")).toBeVisible();
  await expect(page.getByTestId("input-sales-script-instructor")).toBeVisible();
  await page.getByTestId("input-sales-script-instructor").fill(answers.instructor);
  await page.getByTestId("input-sales-script-bonuses").fill(answers.bonuses);
  await expect(page.getByTestId("button-generate-sales-script")).toBeEnabled();
  await confirmGeneration(page);
  await expect.poll(() => fixture.getJobPostCount()).toBe(1);
  expect(fixture.getPurchasePostCount()).toBe(0);
  expect(fixture.getJobBodies()[0]).toMatchObject({
    purchaseId: "sales-purchase-1",
  });
});

test("questionnaire metadata failure keeps private fields and generation locked", async ({ page }) => {
  const fixture = await mockSalesScript(page, {
    questionnaireFailure: true,
    initiallyPurchased: true,
  });
  await page.goto(`/admin/webinar/${webinarId}`);
  await dismissCookieConsent(page);
  await page.getByTestId("tab-sales-script").click();
  await expect(page.getByTestId("sales-script-step-details")).toBeVisible();
  await expect(page.getByTestId("input-sales-script-instructor")).toHaveCount(0);
  await expect(page.getByTestId("button-retry-sales-script-questionnaire")).toBeVisible();
  await expect(page.getByTestId("button-generate-sales-script")).toBeDisabled();
  expect(fixture.getPurchasePostCount()).toBe(0);
  expect(fixture.getJobPostCount()).toBe(0);
});