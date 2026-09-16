import { expect, test, type Page } from "@playwright/test";

const platformPixel = "1096741902746313";
const accountMarker = "member-platform-e2e";

type PixelCall = unknown[];

async function setupMetaMock(page: Page, consent?: "granted" | "denied") {
  if (consent) {
    await page.addInitScript(value => {
      localStorage.setItem("sellcase.marketing-consent.v1", value);
    }, consent);
  }
  await page.route("https://connect.facebook.net/**", route => route.fulfill({
    contentType: "application/javascript",
    body: `
      window.__pixelCalls = JSON.parse(localStorage.getItem("__platform_e2e_pixel_calls") || "[]");
      const q = window.fbq.queue || [];
      window.fbq.callMethod = (...args) => {
        window.__pixelCalls.push(args);
        localStorage.setItem("__platform_e2e_pixel_calls", JSON.stringify(window.__pixelCalls));
      };
      q.splice(0).forEach(args => window.fbq.callMethod(...args));
    `,
  }));
  await page.route("https://www.facebook.com/**", route => route.abort());
}

const pixelCalls = async (page: Page): Promise<PixelCall[]> => {
  try {
    return await page.evaluate(() => (window as any).__pixelCalls
      || JSON.parse(localStorage.getItem("__platform_e2e_pixel_calls") || "[]"));
  } catch (error) {
    // A full-page navigation (e.g. the post-login redirect) can destroy the
    // context mid-poll; the calls are persisted, so retry after it settles.
    if (!String(error).includes("Execution context was destroyed")) throw error;
    await page.waitForLoadState("domcontentloaded");
    return page.evaluate(() => JSON.parse(localStorage.getItem("__platform_e2e_pixel_calls") || "[]"));
  }
};

async function mockDashboard(page: Page, getAccountId: string | (() => string) = accountMarker) {
  const accountId = () => typeof getAccountId === "function" ? getAccountId() : getAccountId;
  await page.route("**/api/**", route => route.fulfill({ json: {} }));
  await page.route("**/api/webinars", route => route.fulfill({ json: [] }));
  await page.route("**/api/webinars/stats/summary", route => route.fulfill({ json: {} }));
  await page.route("**/api/admin/subscription", route => route.fulfill({
    json: {
      plan: "free", amountUsd: null, status: "inactive", active: false,
      planStartedAt: null, planExpiresAt: null, cancelAtPeriodEnd: false,
      addonWebinars: 0, maxWebinars: 0, webinarCount: 0, publishedCount: 0,
      isActive: false, isExpired: false, isSuperAdmin: false, hasStripeCustomer: true,
    },
  }));
  await page.route("**/api/admin/me", async route => {
    await new Promise(resolve => setTimeout(resolve, 100));
    await route.fulfill({
      json: { id: accountId(), username: "platform-e2e", email: "platform@example.test" },
    });
  });
  await page.route("**/api/stripe/config", route => route.fulfill({
    json: {
      billingAvailable: true,
      catalogReady: true,
      publishableKey: "",
      plans: [
        { key: "starter", amountUsd: 29, annualAmountUsd: 295.8, includedWebinars: 1, monthlyRegistrants: 1000, monthlyAiPoints: 100, trialDays: 0, available: true, annualAvailable: true },
        { key: "growth", amountUsd: 99, annualAmountUsd: 1009.8, includedWebinars: 5, monthlyRegistrants: 3000, monthlyAiPoints: 200, trialDays: 0, available: true, annualAvailable: true },
        { key: "scale", amountUsd: 199, annualAmountUsd: 2029.8, includedWebinars: 15, monthlyRegistrants: 5000, monthlyAiPoints: 300, trialDays: 0, available: true, annualAvailable: true },
      ],
      addonAmountUsd: 20,
      annualAddonAmountUsd: 204,
    },
  }));
  await page.route("**/api/ai-points", route => route.fulfill({
    json: {
      points: 0, giftedPoints: 0, permanentPoints: 0, nextExpiry: null,
      nextExpiryPoints: 0, planMonthlyGift: 0, unlimited: false,
      pointsPerReply: 1, pointsPerTwd: 1, minTwd: 100, packages: [],
    },
  }));
  await page.route("**/api/trial", route => route.fulfill({
    json: {
      eligibility: "ineligible", state: "ineligible", startsAt: null,
      expiresAt: null, retentionUntil: null, remainingAI: 0, usedAI: 0, milestones: [],
    },
  }));
  await page.route("**/api/admin/ecpay-connection", route => route.fulfill({ json: null }));
  await page.route("**/api/products", route => route.fulfill({ json: [] }));
  await page.route("**/api/product-sales-pages", route => route.fulfill({ json: [] }));
}

const paidSignup = {
  eventName: "CompleteRegistration",
  eventId: "platform_signup:e2e",
  accountMarker,
};

const paidSubscription = {
  status: "paid",
  conversion: {
    eventName: "Purchase",
    eventId: "platform_subscription:cs_e2e_paid",
    accountMarker,
    value: 29,
    currency: "USD",
  },
};

const paidRecharge = {
  success: true,
  points: 300,
  conversion: {
    eventName: "Purchase",
    eventId: "platform_ai_points:cs_e2e_points",
    accountMarker,
    value: 300,
    currency: "TWD",
  },
};

function registrationForm(page: Page) {
  return {
    username: page.getByTestId("input-reg-username"),
    email: page.getByTestId("input-reg-email"),
    password: page.getByTestId("input-reg-password"),
    confirm: page.getByTestId("input-reg-confirm"),
  };
}

test("new account signup emits CompleteRegistration, while failed signup and login do not", async ({ page }) => {
  await setupMetaMock(page, "granted");
  await page.route("**/api/admin/register", route => route.fulfill({ status: 201, json: {
    success: true, verificationRequired: true, conversion: paidSignup,
  } }));
  await page.goto("/admin");
  await page.getByTestId("button-toggle-mode").click();
  const form = registrationForm(page);
  await form.username.fill("new-platform-user");
  await form.email.fill("new-platform@example.test");
  await form.password.fill("password-123");
  await form.confirm.fill("password-123");
  await page.getByTestId("button-register").click();
  await expect.poll(() => pixelCalls(page)).toContainEqual([
    "trackSingle", platformPixel, "CompleteRegistration", {}, { eventID: paidSignup.eventId },
  ]);

  await page.route("**/api/admin/register", route => route.fulfill({
    status: 409, json: { message: "註冊失敗" },
  }));
  await page.getByTestId("button-toggle-mode").click();
  const failed = registrationForm(page);
  await failed.username.fill("failed-platform-user");
  await failed.email.fill("failed-platform@example.test");
  await failed.password.fill("password-123");
  await failed.confirm.fill("password-123");
  await page.getByTestId("button-register").click();
  await expect.poll(async () => (await pixelCalls(page))
    .filter(call => call[0] === "trackSingle" && call[1] === platformPixel && call[2] === "CompleteRegistration"))
    .toHaveLength(1);

  await page.getByTestId("button-toggle-mode").click();
  await page.route("**/api/admin/login", route => route.fulfill({ json: { success: true } }));
  await page.getByTestId("input-username").fill("existing-user");
  await page.getByTestId("input-password").fill("password-123");
  await page.getByTestId("button-login").click();
  await expect.poll(async () => (await pixelCalls(page))
    .filter(call => call[0] === "trackSingle" && call[1] === platformPixel && call[2] === "CompleteRegistration"))
    .toHaveLength(1);
});

test("late consent releases only the current signup and never sends account PII", async ({ page }) => {
  await setupMetaMock(page);
  await page.route("**/api/admin/register", route => route.fulfill({ status: 201, json: {
    success: true, verificationRequired: true, conversion: {
      ...paidSignup, accountMarker: "late-consent-account",
    },
  } }));
  await page.goto("/admin");
  await page.evaluate(() => document.querySelector('[role="dialog"]')?.remove());
  await page.getByTestId("button-toggle-mode").click();
  const form = registrationForm(page);
  await form.username.fill("late-consent-user");
  await form.email.fill("private@example.test");
  await form.password.fill("password-123");
  await form.confirm.fill("password-123");
  await page.getByTestId("button-register").click();
  await expect.poll(async () => (await pixelCalls(page))
    .filter(call => call[0] === "trackSingle" && call[2] === "CompleteRegistration"))
    .toHaveLength(0);
  await page.evaluate(() => {
    localStorage.setItem("sellcase.marketing-consent.v1", "granted");
    window.dispatchEvent(new CustomEvent("sellcase:marketing-consent", { detail: "granted" }));
  });
  await expect.poll(() => pixelCalls(page)).toContainEqual([
    "trackSingle", platformPixel, "CompleteRegistration", {}, { eventID: paidSignup.eventId },
  ]);
  const registrationCall = (await pixelCalls(page))
    .find(call => call[0] === "trackSingle" && call[2] === "CompleteRegistration");
  expect(JSON.stringify(registrationCall)).not.toContain("private@example.test");
});

test("subscription checkout reports Purchase only after the paid server DTO, including auth/query timing", async ({ page }) => {
  await setupMetaMock(page, "granted");
  await mockDashboard(page);
  let confirmations = 0;
  await page.route("**/api/stripe/confirm-platform-checkout", async route => {
    confirmations += 1;
    // Delay auth/confirmation enough to exercise the dashboard mount effect
    // while /api/admin/me is still resolving.
    await new Promise(resolve => setTimeout(resolve, 50));
    await route.fulfill({ json: paidSubscription });
  });
  await page.goto("/admin/dashboard?checkout=success&session_id=cs_e2e_paid");
  await expect.poll(() => confirmations).toBe(1);
  await expect.poll(() => pixelCalls(page)).toContainEqual([
    "trackSingle", platformPixel, "Purchase",
    { value: 29, currency: "USD" }, { eventID: "platform_subscription:cs_e2e_paid" },
  ]);
  expect(await page.evaluate(() => location.search)).toBe("");
});

test("subscription pending or foreign confirmation never emits Purchase", async ({ page }) => {
  await setupMetaMock(page, "granted");
  await mockDashboard(page);
  await page.route("**/api/stripe/confirm-platform-checkout", route => {
    const sessionId = route.request().postDataJSON()?.sessionId;
    return sessionId === "cs_e2e_pending"
      ? route.fulfill({ json: { status: "pending" } })
      : route.fulfill({ status: 403, json: { message: "無效的付款資訊" } });
  });
  await page.goto("/admin/dashboard?checkout=success&session_id=cs_e2e_foreign");
  await page.waitForTimeout(250);
  expect((await pixelCalls(page)).filter(call =>
    call[0] === "trackSingle" && call[1] === platformPixel && call[2] === "Purchase")).toHaveLength(0);

  await page.goto("/admin/dashboard?checkout=success&session_id=cs_e2e_pending");
  await page.waitForTimeout(300);
  expect((await pixelCalls(page)).filter(call =>
    call[0] === "trackSingle" && call[1] === platformPixel && call[2] === "Purchase")).toHaveLength(0);
});

test("paid AI-point recharge reports the server value/currency, while pending does not", async ({ page }) => {
  await setupMetaMock(page, "granted");
  await mockDashboard(page);
  await page.route("**/api/stripe/confirm-recharge", route => {
    const sessionId = route.request().postDataJSON()?.sessionId;
    return sessionId === "cs_e2e_pending_points"
      ? route.fulfill({ json: { success: false, status: "pending" } })
      : route.fulfill({ json: paidRecharge });
  });
  await page.goto("/admin/dashboard?recharge=success&session_id=cs_e2e_points");
  await expect.poll(() => pixelCalls(page)).toContainEqual([
    "trackSingle", platformPixel, "Purchase",
    { value: 300, currency: "TWD" }, { eventID: "platform_ai_points:cs_e2e_points" },
  ]);

  await page.goto("/admin/dashboard?recharge=success&session_id=cs_e2e_pending_points");
  await page.waitForTimeout(250);
  expect((await pixelCalls(page)).filter(call =>
    call[0] === "trackSingle" && call[1] === platformPixel && call[2] === "Purchase")).toHaveLength(1);
});

test("conversion event IDs survive reload and dedupe the platform pixel", async ({ page }) => {
  await setupMetaMock(page, "granted");
  await mockDashboard(page);
  await page.route("**/api/stripe/confirm-platform-checkout", route => route.fulfill({ json: paidSubscription }));
  await page.goto("/admin/dashboard?checkout=success&session_id=cs_e2e_paid");
  await expect.poll(async () => (await pixelCalls(page))
    .filter(call => call[0] === "trackSingle" && call[1] === platformPixel && call[2] === "Purchase"))
    .toHaveLength(1);

  await page.goto("/admin/dashboard?checkout=success&session_id=cs_e2e_paid");
  await page.waitForTimeout(250);
  expect((await pixelCalls(page)).filter(call =>
    call[0] === "trackSingle" && call[1] === platformPixel && call[2] === "Purchase")).toHaveLength(1);
  expect(await page.evaluate(() => Object.keys(localStorage)
    .some(key => key.includes("sellcase.meta.platform.sent.v1")))).toBe(true);
});

test("queued account A stays fenced through SPA logout/login B, then fires once when A returns", async ({ page }) => {
  await setupMetaMock(page);
  let currentAccount = "account-a-e2e";
  await mockDashboard(page, () => currentAccount);
  await page.route("**/api/stripe/confirm-platform-checkout", route => route.fulfill({
    json: {
      status: "paid",
      conversion: {
        eventName: "Purchase",
        eventId: "platform_subscription:cs_account_a",
        accountMarker: "account-a-e2e",
        value: 29,
        currency: "USD",
      },
    },
  }));
  await page.route("**/api/admin/login", async route => {
    currentAccount = route.request().postDataJSON()?.username === "account-b" ? "account-b-e2e" : "account-a-e2e";
    await route.fulfill({ json: { success: true } });
  });

  const firstMe = page.waitForResponse(response =>
    response.url().endsWith("/api/admin/me") && response.ok());
  await page.goto("/admin/dashboard?checkout=success&session_id=cs_account_a");
  await firstMe;
  // A's paid server DTO is queued because consent is still undecided.
  await expect.poll(async () => (await pixelCalls(page))
    .filter(call => call[0] === "trackSingle" && call[2] === "Purchase"))
    .toHaveLength(0);

  await page.getByTestId("button-admin-settings").click({ force: true });
  await page.getByTestId("button-logout").click({ force: true });
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByRole("button", { name: "同意行銷追蹤" }).click();
  await page.getByTestId("input-username").fill("account-b");
  await page.getByTestId("input-password").fill("password-123");
  await page.getByTestId("button-login").click();
  await expect(page).toHaveURL(/\/admin\/dashboard$/);
  await page.waitForTimeout(250);
  expect((await pixelCalls(page)).filter(call =>
    call[0] === "trackSingle" && call[1] === platformPixel && call[2] === "Purchase")).toHaveLength(0);

  await page.getByTestId("button-admin-settings").click({ force: true });
  await page.getByTestId("button-logout").click({ force: true });
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByTestId("input-username").fill("account-a");
  await page.getByTestId("input-password").fill("password-123");
  await page.getByTestId("button-login").click();
  await expect(page).toHaveURL(/\/admin\/dashboard$/);
  await expect.poll(async () => (await pixelCalls(page))
    .filter(call => call[0] === "trackSingle" && call[1] === platformPixel && call[2] === "Purchase"))
    .toHaveLength(1);

  await page.reload();
  await page.waitForTimeout(250);
  expect((await pixelCalls(page)).filter(call =>
    call[0] === "trackSingle" && call[1] === platformPixel && call[2] === "Purchase")).toHaveLength(1);
});

test("member webinar activity cannot use the reserved platform pixel", async ({ page }) => {
  await setupMetaMock(page, "granted");
  await page.route("**/api/webinars/member-isolation", route => route.fulfill({ json: {
    id: "member-isolation", title: "Demo", publishStatus: "published",
    metaPixelId: platformPixel,
  } }));
  await page.route("**/api/webinars/member-isolation/**", route => route.fulfill({ json: {} }));
  await page.route("**/api/webinars/member-isolation/available-sessions", route => route.fulfill({
    json: { mode: "fixed", sessions: [], hasSessions: false, registrationOpen: true },
  }));
  await page.goto("/admin");
  await page.evaluate(() => history.pushState(null, "", "/register/member-isolation"));
  await expect(page.locator("#registration-form")).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("livecast:webinar-event", {
    detail: { webinarId: "member-isolation", eventType: "cta_click", data: {} },
  })));
  await page.waitForTimeout(250);
  // The platform pixel may count the SPA page view, but never a member funnel event.
  expect((await pixelCalls(page)).filter(call =>
    call[0] === "trackSingle" && call[1] === platformPixel && call[2] !== "PageView")).toHaveLength(0);
  expect((await pixelCalls(page)).filter(call => call[0] === "init")).toEqual([["init", platformPixel]]);
});