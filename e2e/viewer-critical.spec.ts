import { expect, test, type APIRequestContext } from "@playwright/test";

type Fixture = {
  webinarId: string;
  watchToken: string;
  revokedWebinarId: string;
  revokedWatchToken: string;
  surveyId: string;
  archivedCtaId: string;
};

function fixture(): Fixture {
  const required = [
    "E2E_BASE_URL",
    "E2E_WEBINAR_ID",
    "E2E_WATCH_TOKEN",
    "E2E_REVOKED_WEBINAR_ID",
    "E2E_REVOKED_WATCH_TOKEN",
    "E2E_SURVEY_ID",
    "E2E_ARCHIVED_CTA_ID",
  ] as const;
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing E2E fixture configuration: ${missing.join(", ")}`);
  if (!["disposable", "staging"].includes(process.env.E2E_TARGET_KIND || "")) {
    throw new Error("E2E_TARGET_KIND must be disposable or staging");
  }
  if (process.env.E2E_CONFIRM_NO_LIVE_MONEY !== "1") {
    throw new Error("Set E2E_CONFIRM_NO_LIVE_MONEY=1 after confirming the fixture cannot charge live money");
  }

  const baseUrl = new URL(process.env.E2E_BASE_URL!);
  if (baseUrl.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(baseUrl.hostname)) {
    throw new Error("E2E_BASE_URL must use HTTPS unless it is local");
  }
  return {
    webinarId: process.env.E2E_WEBINAR_ID!,
    watchToken: process.env.E2E_WATCH_TOKEN!,
    revokedWebinarId: process.env.E2E_REVOKED_WEBINAR_ID!,
    revokedWatchToken: process.env.E2E_REVOKED_WATCH_TOKEN!,
    surveyId: process.env.E2E_SURVEY_ID!,
    archivedCtaId: process.env.E2E_ARCHIVED_CTA_ID!,
  };
}

async function getJson(request: APIRequestContext, path: string) {
  const response = await request.get(path);
  expect(response.ok(), `${path} returned ${response.status()}`).toBeTruthy();
  return response.json();
}

test.describe("critical viewer recovery-safe flows", () => {
  test.skip(() => process.env.E2E_RUN_STAGING !== "1", "staging fixture suite only");
  test("revoked access stops rendering the player", async ({ page }) => {
    const f = fixture();
    const stateResponse = page.waitForResponse((response) =>
      response.url().includes(`/api/webinars/${f.revokedWebinarId}/watch-state`),
    );

    await page.goto(`/webinar/${f.revokedWebinarId}?watchToken=${encodeURIComponent(f.revokedWatchToken)}`, {
      waitUntil: "domcontentloaded",
    });
    const response = await stateResponse;
    const state = await response.json();
    const safelyDenied = response.ok()
      ? state.accessRevoked === true && state.canWatch === false
      : [401, 403, 404].includes(response.status());
    expect(safelyDenied, "the revoked fixture must be explicitly denied by watch-state").toBe(true);
    await expect(page.getByText(/觀看資格已失效|無法安全驗證觀看資格|找不到此直播間|目前未開放觀看/)).toBeVisible();
    await expect(page.getByTestId("video-player")).toHaveCount(0);
  });

  test("feedback submission requires and accepts the viewer watch token", async ({ page }) => {
    const f = fixture();
    await page.goto(`/webinar/${f.webinarId}?watchToken=${encodeURIComponent(f.watchToken)}`, {
      waitUntil: "domcontentloaded",
    });

    const result = await page.evaluate(async ({ surveyId, watchToken }) => {
      const submit = (token: string) => fetch("/api/feedback-responses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          surveyId,
          responses: { e2e: `recovery-safe-${Date.now()}` },
          watchToken: token,
        }),
      });
      const rejected = await submit(`${watchToken}-invalid`);
      const accepted = await submit(watchToken);
      return {
        rejectedStatus: rejected.status,
        acceptedStatus: accepted.status,
        acceptedBody: await accepted.json(),
      };
    }, { surveyId: f.surveyId, watchToken: f.watchToken });

    expect(result.rejectedStatus).toBe(401);
    expect(result.acceptedStatus).toBe(200);
    expect(result.acceptedBody.surveyId).toBe(f.surveyId);
    expect(result.acceptedBody.registrationId).toBeTruthy();
  });

  test("an archived CTA is absent from both the public payload and viewer UI", async ({ page, request }) => {
    const f = fixture();
    const ctas = await getJson(request, `/api/webinars/${f.webinarId}/ctas`);
    expect(Array.isArray(ctas)).toBe(true);
    expect(ctas.some((cta: { id: string }) => cta.id === f.archivedCtaId)).toBe(false);

    await page.goto(`/webinar/${f.webinarId}?watchToken=${encodeURIComponent(f.watchToken)}`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByTestId("input-nickname").fill("E2E Viewer");
    await page.getByTestId("button-join").click();
    await expect(page.getByTestId(`cta-button-${f.archivedCtaId}`)).toHaveCount(0);
  });
});