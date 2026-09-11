import { expect, test, type Page } from "@playwright/test";

const webinarId = "session-counts-webinar";
const webinar = {
  id: webinarId,
  title: "多場次研討會",
  description: "各場次報名統計",
  publishStatus: "published",
  startTime: "2026-01-01T01:00:00.000Z",
  videoDuration: 3600,
  scheduleMode: { recurring: true },
};

const rows = [
  { key: "unassigned", startTimeISO: null, labelKind: "unassigned", status: "unknown", registrationCount: 4 },
  { key: "onDemand", startTimeISO: null, labelKind: "onDemand", status: "unknown", registrationCount: 0 },
  { key: "session-1767844800000", startTimeISO: "2026-01-08T04:00:00.000Z", labelKind: "session", status: "cancelled", registrationCount: 0 },
  { key: "session-1767672000000", startTimeISO: "2026-01-06T04:00:00.000Z", labelKind: "session", status: "scheduled", registrationCount: 7 },
  { key: "session-1767758400000", startTimeISO: "2026-01-07T04:00:00.000Z", labelKind: "session", status: "live", registrationCount: 3 },
  ...Array.from({ length: 23 }, (_, index) => ({
    key: `recurring-${new Date(Date.UTC(2026, 0, 9 + index, 4)).getTime()}`,
    startTimeISO: new Date(Date.UTC(2026, 0, 9 + index, 4)).toISOString(),
    labelKind: index === 0 ? "justInTime" : "recurring",
    status: index % 2 ? "ended" : "scheduled",
    registrationCount: index + 1,
  })),
];

const counts = { totalRegistered: 42, counts: rows };

async function mockAdmin(page: Page, detailFailureOnce = false) {
  let countEndpointCalls = 0;
  await page.addInitScript(() => {
    localStorage.setItem("sellcase.marketing-consent.v1", "denied");
    localStorage.setItem("icta-lang", "zh-TW");
  });
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/webinars") {
      return route.fulfill({ json: [webinar] });
    }
    if (path === "/api/webinars/stats/summary") {
      return route.fulfill({ json: { [webinarId]: { registered: 42, attended: 0, engaged: 0, onlineCount: 0, sessionRegistrationCounts: counts } } });
    }
    if (path === `/api/webinars/${webinarId}/session-registration-counts`) {
      countEndpointCalls += 1;
      if (detailFailureOnce && countEndpointCalls === 1) {
        return route.fulfill({ status: 503, json: { message: "fixture failure" } });
      }
      return route.fulfill({ json: counts });
    }
    if (path === `/api/webinars/${webinarId}`) return route.fulfill({ json: webinar });
    if (path === `/api/webinars/${webinarId}/analytics`) {
      return route.fulfill({
        json: {
          webinar,
          summary: { totalRegistrations: 42, attended: 0, attendanceRate: 0, avgWatchTime: 0, videoDuration: 3600 },
          analytics: [],
          registrations: [],
        },
      });
    }
    if (path === `/api/webinars/${webinarId}/funnel-analytics`) {
      return route.fulfill({
        json: {
          webinarId,
          range: { from: null, to: null },
          uniqueViewers: 0,
          uniqueByStage: {},
          stageConversionRates: [],
          ctaPerformance: [],
          dropoffBuckets: [],
          counts: {},
          revenue: {},
          checkoutToPurchaseRate: 0,
        },
      });
    }
    if (path === `/api/admin/subscription`) {
      return route.fulfill({ json: { plan: "growth", active: true, maxWebinars: 5, webinarCount: 1, publishedCount: 1, isSuperAdmin: false } });
    }
    if (path === "/api/stripe/config") return route.fulfill({ json: { billingAvailable: false, catalogReady: false, plans: [] } });
    if (path === "/api/ai-points") return route.fulfill({ json: { points: 0, unlimited: false, packages: [] } });
    if (path === "/api/trial") return route.fulfill({ json: { state: "none" } });
    if (path === "/api/products" || path === "/api/product-sales-pages") return route.fulfill({ json: [] });
    if (path === "/api/admin/ecpay-connection") return route.fulfill({ json: null });
    return route.fulfill({ json: [] });
  });
  return {
    getCountEndpointCalls: () => countEndpointCalls,
  };
}

test("dashboard keeps the per-session summary compact and exposes the complete history", async ({ page }) => {
  const fixture = await mockAdmin(page);
  await page.goto("/admin/dashboard");

  const card = page.getByTestId("card-webinar-session-counts-webinar");
  await expect(card).toBeVisible();
  const countsPanel = card.getByTestId("session-registration-counts");
  await expect(countsPanel).toContainText("總報名數");
  await expect(countsPanel.getByTestId("session-registration-row-0")).toHaveCount(1);
  await expect(countsPanel.getByTestId("session-registration-row-3")).toHaveCount(0);
  await countsPanel.getByTestId("button-show-more-session-registration-counts").click();
  await countsPanel.screenshot({ path: "/tmp/session-registration-counts-desktop.png" });
  await expect(countsPanel.getByTestId("session-registration-row-25")).toHaveCount(1);
  await expect(countsPanel).toContainText("已取消");
  await expect(countsPanel).toContainText("隨選觀看");
  await expect(countsPanel).toContainText("未選場次");
  expect(fixture.getCountEndpointCalls()).toBe(0);
});

test("detail overview polls owner-scoped counts, retries failures, and sorts Taiwan time on mobile", async ({ page }) => {
  const fixture = await mockAdmin(page, true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/admin/webinar/${webinarId}`);

  const countsPanel = page.getByTestId("session-registration-counts");
  await expect(countsPanel.getByTestId("session-registration-counts-error")).toBeVisible();
  await countsPanel.getByTestId("button-retry-session-registration-counts").click();
  await expect(countsPanel.getByTestId("session-registration-total")).toHaveText("42");
  await expect(countsPanel.getByTestId("session-registration-row-mobile-0")).toContainText("2026/01/06");
  await expect(countsPanel.getByTestId("session-registration-row-mobile-1")).toContainText("2026/01/07");
  await expect(countsPanel).toContainText("已取消");
  await expect(countsPanel).toContainText("隨選觀看");
  await expect(countsPanel).toContainText("未選場次");
  await expect(fixture.getCountEndpointCalls()).toBe(2);
  await countsPanel.screenshot({ path: "/tmp/session-registration-counts-mobile.png" });
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).resolves.toBe(true);
});