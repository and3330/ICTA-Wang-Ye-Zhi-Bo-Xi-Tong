import { expect, test, type Page } from "@playwright/test";
import { managementPermissions, type ManagementPermission } from "../shared/adminManagement";

const memberId = "12345678-1234-4234-8234-123456789012";
const member = {
  id: memberId, username: "範例會員", email: "member@example.test", companyName: "測試工作室",
  isActive: true, protectedRoot: false, managementRole: "member", subscriptionPlan: "growth",
  subscriptionStatus: "active", planExpiresAt: "2027-01-01T00:00:00.000Z",
  createdAt: "2026-09-01T00:00:00.000Z", webinarCount: 2, aiPoints: 200,
  emailVerificationRequired: false, emailVerifiedAt: "2026-09-01T00:00:00.000Z", notes: [], tags: [],
};
const subscription = {
  userId: memberId, username: member.username, email: member.email, plan: "growth", status: "active",
  interval: "month", amountMinor: 9900, currency: "USD", currentPeriodEnd: member.planExpiresAt,
  cancelAtPeriodEnd: false, provider: "stripe", providerSubscriptionPresent: true,
  providerEnvironment: "connected", receiptUrl: null,
};
const order = {
  id: "in_test", kind: "platform_invoice", ownerUserId: memberId, ownerUsername: member.username,
  provider: "stripe", providerReference: "in_test", status: "paid", amountMinor: 9900,
  refundedMinor: 0, currency: "USD", createdAt: member.createdAt, paidAt: member.createdAt,
  providerLookup: "live", receiptUrl: null, providerEnvironment: "connected",
};
const support = {
  id: "22345678-1234-4234-8234-123456789012", userId: memberId, username: member.username,
  category: "question", subject: "方案額度問題", message: "請協助確認額度。", status: "open",
  adminNote: null, createdAt: member.createdAt, updatedAt: member.createdAt,
};
const collection = (items: unknown[]) => ({
  items, page: 1, pageSize: 20, total: items.length,
  availability: [{ provider: "local", available: true, source: "local", message: null }],
});

async function setup(page: Page, permissions: readonly ManagementPermission[] = managementPermissions) {
  const writes: Array<{ method: string; path: string; body: any }> = [];
  const currentMember = structuredClone(member);
  let currentManual: any = null;
  await page.addInitScript(() => localStorage.setItem("sellcase.marketing-consent.v1", "denied"));
  await page.route("**/api/management/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/management/", "");
    if (request.method() !== "GET") {
      const body = request.postDataJSON();
      writes.push({ method: request.method(), path, body });
      if (path.endsWith("/profile")) Object.assign(currentMember, { username: body.username ?? currentMember.username, email: body.email ?? currentMember.email, companyName: body.companyName ?? currentMember.companyName });
      if (path.endsWith("/disable")) currentMember.isActive = false;
      if (path.endsWith("/enable")) currentMember.isActive = true;
      if (path.endsWith("/role")) currentMember.managementRole = body.role;
      if (path === `members/${memberId}/manual-plan`) {
        if (request.method() === "POST") {
          currentManual = {
            id: "manual-plan-1", userId: memberId, plan: body.plan, state: "active",
            startsAt: body.startsAt, expiresAt: body.expiresAt, revokedAt: null, revokedBy: null,
            reason: body.reason, version: 1, createdAt: member.createdAt, createdBy: "root",
            updatedAt: member.createdAt,
          };
        } else if (request.method() === "PATCH" && currentManual) {
          currentManual = {
            ...currentManual, plan: body.plan ?? currentManual.plan,
            startsAt: body.startsAt ?? currentManual.startsAt,
            expiresAt: body.expiresAt ?? currentManual.expiresAt,
            version: currentManual.version + 1, reason: body.reason,
          };
        } else if (request.method() === "DELETE" && currentManual) {
          currentManual = { ...currentManual, state: "revoked", version: currentManual.version + 1, reason: body.reason };
        }
        return route.fulfill({ json: currentManual });
      }
      return route.fulfill({ json: { ...currentMember, requested: true, added: true, points: 220 } });
    }
    let json: unknown;
    if (path === "me") json = { id: "root", username: "管理員", managementRole: permissions.length === managementPermissions.length ? "super_admin" : "support", canManage: true, permissions, isRoot: permissions.length === managementPermissions.length };
    else if (path === "overview") json = { totals: { users: 1, activeUsers: 1, disabledUsers: 0, paidSubscriptions: 1, openSupportCases: 1 }, warnings: [{ code: "past_due", count: 1, message: "1 位會員付款失敗" }] };
    else if (path === "members") json = collection([currentMember]);
    else if (path === `members/${memberId}`) json = {
      profile: currentMember, override: null, subscription, manualPlan: currentManual,
      effectivePlan: currentManual?.state === "active"
        ? { plan: currentManual.plan, source: "manual", active: true, maxWebinars: 10, monthlyRegistrants: 1000, manualExpiresAt: currentManual.expiresAt }
        : { plan: "growth", source: "paid", active: true, maxWebinars: 5, monthlyRegistrants: 500, manualExpiresAt: null },
      usage: { webinars: 2, publishedWebinars: 1, registrations: 5, aiPoints: 200, aiLots: [{ id: "lot-1", source: "subscription", originalPoints: 200, remainingPoints: 200, grantedAt: member.createdAt, expiresAt: member.planExpiresAt, idempotencyKey: null }] }, webinars: [{ id: "webinar-1", title: "範例銷講", publishStatus: "published", createdAt: member.createdAt }], products: [{ id: "product-1", name: "線上課程", status: "active", createdAt: member.createdAt }] };
    else if (path.endsWith("/ai-ledger")) json = collection([{ id: "tx-1", type: "grant", points: 200, amountMinor: null, currency: null, createdAt: member.createdAt, source: "subscription" }]);
    else if (path === "subscriptions") json = collection([subscription]);
    else if (path === "orders") json = collection([order]);
    else if (path === "support") json = collection([support]);
    else if (path === "audit") json = collection([{ id: "audit-1", actorUserId: "root", targetUserId: memberId, action: "member.profile", reason: "會員資料更新", before: {}, after: {}, createdAt: member.createdAt, requestId: null }]);
    else if (path === "catalog") json = { plans: [{ key: "starter", label: "Starter", monthlyAmountMinor: 3900, annualAmountMinor: 39780, currency: "USD", baseWebinars: 1, monthlyAiPoints: 100 }, { key: "growth", label: "Growth", monthlyAmountMinor: 9900, annualAmountMinor: 100980, currency: "USD", baseWebinars: 5, monthlyAiPoints: 200 }], roles: [{ role: "super_admin", permissions: managementPermissions }, { role: "support", permissions: ["members.read", "support.read", "support.write"] }] };
    else return route.fulfill({ status: 404, json: { message: `Unmocked management endpoint: ${path}` } });
    return route.fulfill({ json });
  });
  return writes;
}

test("desktop management navigation is on the left and every section loads", async ({ page }) => {
  await setup(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/super-admin");
  const nav = page.locator(".mc-sidebar");
  await expect(nav).toBeVisible();
  expect((await nav.boundingBox())!.x).toBeLessThan(30);
  await expect(page.getByText("1 位會員付款失敗")).toBeVisible();
  for (const section of ["會員中心", "訂閱與權益", "金流訂單", "方案目錄", "客服案件", "管理角色", "操作稽核"]) {
    await nav.getByRole("button", { name: section, exact: true }).click();
    await expect(page.locator(".mc-error")).toHaveCount(0);
    await expect(page.locator(".mc-empty").filter({ hasText: "正在" })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await nav.getByRole("button", { name: "會員中心", exact: true }).click();
  await page.screenshot({ path: "/tmp/management-desktop.png", fullPage: true });
});

for (const width of [390, 768]) {
  test(`management mobile left menu opens and closes at ${width}px`, async ({ page }) => {
    await setup(page);
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/super-admin");
    await expect(page.locator(".mc-sidebar")).toBeHidden();
    await page.locator(".mc-mobile").getByRole("button").first().click();
    const sheet = page.getByTestId("management-mobile-sheet");
    await expect(sheet).toBeVisible();
    expect((await sheet.boundingBox())!.x).toBeLessThan(10);
    await sheet.getByRole("button", { name: "會員中心", exact: true }).click();
    await expect(sheet).not.toBeVisible();
    await expect(page.getByText(member.email, { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (width === 390) await page.screenshot({ path: "/tmp/management-mobile.png", fullPage: true });
  });
}

test("support role cannot navigate to financial or role-management sections", async ({ page }) => {
  await setup(page, ["members.read", "support.read", "support.write"]);
  await page.goto("/super-admin");
  const nav = page.locator(".mc-sidebar");
  await expect(nav.getByRole("button", { name: "會員中心", exact: true })).toBeVisible();
  for (const name of ["訂閱與權益", "金流訂單", "管理角色", "操作稽核"]) {
    await expect(nav.getByRole("button", { name, exact: true })).toHaveCount(0);
  }
});

test("provider failure is visible rather than disguised as no orders", async ({ page }) => {
  await setup(page);
  await page.route("**/api/management/orders**", route => route.fulfill({ json: {
    ...collection([]), availability: [{ provider: "stripe", available: false, source: "live", message: "Stripe 帳號無法取得訂单資料" }],
  } }));
  await page.goto("/super-admin?section=orders");
  await expect(page.getByText("Stripe 帳號無法取得訂单資料")).toBeVisible();
});

test("member edits, suspension, restoration, role and credits reach real API paths", async ({ page }) => {
  const writes = await setup(page);
  page.on("dialog", dialog => dialog.accept());
  await page.goto(`/super-admin?section=members&member=${memberId}`);
  await expect(page.getByTestId("management-profile-save")).toBeEnabled();
  await page.getByTestId("management-profile-save").click();
  await expect(page.getByTestId("management-reason-input")).toBeFocused();
  await expect(page.getByRole("alert")).toContainText("請先填寫此操作的原因");
  await page.getByTestId("management-reason-input").fill("會員要求更新及測試管理流程");
  await page.getByTestId("management-company-input").fill("已更新工作室");
  await page.getByTestId("management-profile-save").click();
  await expect.poll(() => writes.some(write => write.path === `members/${memberId}/profile` && write.body.companyName === "已更新工作室")).toBe(true);
  await page.getByTestId("management-account-toggle").click();
  await expect(page.getByTestId("management-account-toggle")).toHaveText("啟用帳戶");
  await page.getByTestId("management-account-toggle").click();
  await expect(page.getByTestId("management-account-toggle")).toHaveText("停用帳戶");
  await page.getByTestId("management-role-select").selectOption("support");
  await page.getByTestId("management-role-save").click();
  await expect.poll(() => writes.some(write => write.path.endsWith("/role") && write.body.role === "support")).toBe(true);
  await page.getByTestId("management-ai-points-input").fill("20");
  await page.getByTestId("management-ai-grant").click();
  await expect.poll(() => writes.some(write => write.path.endsWith("/ai-grants") && write.body.points === 20 && write.body.idempotencyKey)).toBeTruthy();
  for (const write of writes) expect(write.body.reason).toBeTruthy();
  await page.getByRole("button", { name: "返回會員列表", exact: true }).click();
  await expect(page.getByText("已更新工作室", { exact: true })).toBeVisible();
});

test("manual plan can be created, scheduled, extended, updated and revoked without changing paid billing", async ({ page }) => {
  const writes = await setup(page);
  page.on("dialog", dialog => dialog.accept());
  await page.goto(`/super-admin?section=members&member=${memberId}`);
  await expect(page.getByRole("heading", { name: "會員方案與使用期限" })).toBeVisible();
  await page.screenshot({ path: "/tmp/member-controls-desktop.png", fullPage: true });
  await expect(page.getByText("Stripe 付費狀態")).toBeVisible();
  await page.getByTestId("management-reason-input").fill("客服補償方案期限");
  await page.getByTestId("management-manual-plan-select").selectOption("scale");
  await page.getByTestId("management-manual-plan-starts-at").fill("2026-10-01T09:30");
  await page.getByTestId("management-manual-plan-expires-at").fill("2026-10-02T09:30");
  await page.getByTestId("management-manual-plan-save").click();
  await expect.poll(() => writes.some(write => write.method === "POST" && write.path.endsWith("/manual-plan") && write.body.plan === "scale")).toBe(true);
  const created = writes.find(write => write.method === "POST" && write.path.endsWith("/manual-plan"))!;
  expect(created.body).toMatchObject({ startsAt: "2026-10-01T09:30:00+08:00", expiresAt: "2026-10-02T09:30:00+08:00", reason: "客服補償方案期限" });
  expect(created.body.idempotencyKey).toBeTruthy();
  await expect(page.getByTestId("management-manual-plan-revoke")).toBeVisible();
  await page.getByTestId("management-manual-plan-hours").fill("1");
  await page.getByRole("button", { name: "加入時數" }).click();
  await expect(page.getByTestId("management-manual-plan-expires-at")).not.toHaveValue("2026-10-02T09:30");
  await page.getByTestId("management-manual-plan-save").click();
  await expect.poll(() => writes.some(write => write.method === "PATCH" && write.path.endsWith("/manual-plan"))).toBe(true);
  const updated = writes.find(write => write.method === "PATCH" && write.path.endsWith("/manual-plan"))!;
  expect(updated.body.version).toBe(1);
  await page.getByTestId("management-manual-plan-revoke").click();
  await expect.poll(() => writes.some(write => write.method === "DELETE" && write.path.endsWith("/manual-plan"))).toBe(true);
  const revoked = writes.find(write => write.method === "DELETE" && write.path.endsWith("/manual-plan"))!;
  expect(revoked.body).toMatchObject({ version: 2, reason: "客服補償方案期限" });
  expect(revoked.body.idempotencyKey).toBeTruthy();
  expect(writes.some(write => write.path.includes("subscriptions/"))).toBe(false);
});

test("manual plan is read-only without subscription write permission and conflicts refresh the current version", async ({ page }) => {
  await setup(page, ["members.read", "subscriptions.read"]);
  await page.goto(`/super-admin?section=members&member=${memberId}`);
  await expect(page.getByTestId("management-manual-plan-select")).toBeDisabled();
  await expect(page.getByText("您的角色僅能檢視方案")).toBeVisible();

  const writes = await setup(page);
  page.on("dialog", dialog => dialog.accept());
  await page.route(`**/api/management/members/${memberId}/manual-plan`, async route => {
    if (route.request().method() === "PATCH") return route.fulfill({ status: 409, json: { message: "stale version" } });
    return route.fallback();
  });
  await page.reload();
  await page.getByTestId("management-reason-input").fill("衝突測試原因");
  await page.getByTestId("management-manual-plan-starts-at").fill("2026-10-01T09:30");
  await page.getByTestId("management-manual-plan-expires-at").fill("2026-10-02T09:30");
  await page.getByTestId("management-manual-plan-save").click();
  await expect.poll(() => writes.some(write => write.method === "POST" && write.path.endsWith("/manual-plan"))).toBe(true);
  await page.getByTestId("management-manual-plan-save").click();
  await expect(page.getByText("方案資料已被其他管理員更新")).toBeVisible();
});

test("manual plan controls remain horizontally accessible at 390px", async ({ page }) => {
  await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/super-admin?section=members&member=${memberId}`);
  await expect(page.getByRole("heading", { name: "會員方案與使用期限" })).toBeVisible();
  await page.screenshot({ path: "/tmp/member-controls-mobile.png", fullPage: true });
  await expect(page.getByTestId("management-manual-plan-expires-at")).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("refund validates amount and reason before making an idempotent request", async ({ page }) => {
  const writes = await setup(page);
  page.on("dialog", dialog => dialog.accept());
  await page.goto("/super-admin?section=orders");
  await page.getByTestId("management-refund-open-in_test").click();
  await expect(page.getByTestId("management-refund-confirm")).toBeDisabled();
  await page.getByTestId("management-refund-reason").fill("測試退款原因");
  await page.getByTestId("management-refund-amount").fill("9901");
  await expect(page.getByTestId("management-refund-confirm")).toBeDisabled();
  await page.getByTestId("management-refund-amount").fill("100");
  await page.getByTestId("management-refund-confirm").click();
  await expect.poll(() => writes.filter(write => write.path.endsWith("/refunds")).length).toBe(1);
  expect(writes[0]).toMatchObject({ method: "POST", path: "orders/in_test/refunds", body: { amountMinor: 100, reason: "測試退款原因" } });
  expect(writes[0].body.idempotencyKey).toBeTruthy();
});

test("member filters send false literally and kind filters keep separate financial books", async ({ page }) => {
  await setup(page);
  await page.goto("/super-admin?section=members");
  await page.getByTestId("management-members-active-filter").selectOption("false");
  await expect.poll(() => page.url()).toContain("section=members");
  const searchRequest = page.waitForRequest(request => request.url().includes("/api/management/members?") && new URL(request.url()).searchParams.get("search") === "測試");
  await page.getByTestId("management-members-search").fill("測試");
  const query = new URL((await searchRequest).url()).searchParams;
  expect(query.get("active")).toBe("false");
  expect(query.has("status")).toBe(false);
  await page.locator(".mc-sidebar").getByRole("button", { name: "金流訂單", exact: true }).click();
  const orderRequest = page.waitForRequest(request => request.url().includes("/api/management/orders?") && new URL(request.url()).searchParams.get("kind") === "member_order");
  await page.getByTestId("management-orders-kind-filter").selectOption("member_order");
  const orderQuery = new URL((await orderRequest).url()).searchParams;
  expect(orderQuery.get("search") || "").toBe("");
  expect(orderQuery.get("kind")).toBe("member_order");
});