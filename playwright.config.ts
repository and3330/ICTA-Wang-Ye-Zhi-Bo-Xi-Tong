import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_MODE === "local"
      ? "http://127.0.0.1:5000"
      : process.env.E2E_BASE_URL || "http://e2e-target-not-configured.invalid",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: process.env.E2E_MODE === "local" ? {
    command: "NODE_ENV=test SESSION_SECRET=local-e2e-only-not-for-auth PORT=5000 npm run dev",
    url: "http://127.0.0.1:5000",
    reuseExistingServer: true,
    timeout: 120_000,
  } : undefined,
});