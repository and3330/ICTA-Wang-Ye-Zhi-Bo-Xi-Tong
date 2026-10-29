import { test, expect } from "@playwright/test";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { eq, or } from "drizzle-orm";
import { db, pool } from "../server/db";
import { users, webinars, mcpOAuthClients, mcpOAuthRequests, mcpOAuthAudit } from "../shared/schema";

// Real server/DB flow (no auth bypass or mocked OAuth API). Only ephemeral test
// accounts are created; no email, payment or provider request is initiated.
const origin = `https://${process.env.REPLIT_DEV_DOMAIN}`;
const owner = crypto.randomUUID(), webinar = crypto.randomUUID();
const username = `mcp-browser-${owner}`, password = crypto.randomBytes(32).toString("base64url");
let clientId: string;
test.use({ baseURL: origin, trace: "off", video: "off" }); // Never record raw auth codes/tokens.
test.beforeAll(async () => {
  await db.insert(users).values({
    id: owner, username, password: await bcrypt.hash(password, 12),
    email: "mcp-browser@example.test", emailVerificationRequired: false, emailVerifiedAt: new Date(),
    subscriptionPlan: "enterprise",
  });
  await db.insert(webinars).values({ id: webinar, userId: owner, title: "MCP 連線驗證直播間", vimeoUrl: "", startTime: new Date(), publishStatus: "draft" });
});
test.afterAll(async () => {
  if (clientId) await db.delete(mcpOAuthRequests).where(eq(mcpOAuthRequests.clientId, clientId));
  await db.delete(webinars).where(eq(webinars.id, webinar));
  await db.delete(users).where(eq(users.id, owner));
  if (clientId) await db.delete(mcpOAuthClients).where(eq(mcpOAuthClients.id, clientId));
  await db.delete(mcpOAuthAudit).where(or(eq(mcpOAuthAudit.userId, owner), eq(mcpOAuthAudit.clientId, clientId || "none")));
  await pool.end();
});
test("password login returns to consent, keyboard selection completes OAuth, and settings revoke it", async ({ page, request }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => localStorage.setItem("sellcase.marketing-consent.v1", "denied"));
  const registration = await request.post("/register", { data: {
    client_name: "MCP 瀏覽器測試應用", redirect_uris: ["https://mcp-client.example/callback"], token_endpoint_auth_method: "none",
  } });
  expect(registration.status()).toBe(201);
  clientId = (await registration.json()).client_id;
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const query = new URLSearchParams({
    client_id: clientId, response_type: "code", redirect_uri: "https://mcp-client.example/callback",
    code_challenge: challenge, code_challenge_method: "S256", state: "browser-test", resource: `${origin}/mcp`,
  });
  const started = await request.get(`/authorize?${query}`, { maxRedirects: 0 });
  expect(started.status()).toBe(302);
  const consentUrl = new URL(started.headers().location, origin);
  await page.goto(consentUrl.href);
  await expect(page.getByRole("link", { name: /登入/ }).first()).toBeVisible();
  await page.getByRole("link", { name: /登入/ }).first().click();
  await expect(page.getByTestId("button-google-login")).toBeVisible();
  await page.getByTestId("input-username").fill(username);
  await page.getByTestId("input-password").fill(password);
  await page.getByTestId("button-login").click();
  await expect(page).toHaveURL(/\/oauth\/consent\?request=/);
  await expect(page.getByText("MCP 瀏覽器測試應用", { exact: true })).toBeVisible();
  await expect(page.getByText("讀取直播間", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/mcp-consent-desktop.jpg", fullPage: true });
  await page.getByRole("button", { name: /同意/ }).click();
  await expect(page.getByRole("heading", { name: /選擇/ })).toBeVisible();
  const finish = page.getByRole("button", { name: /完成|連接|選定/ }).last();
  await expect(finish).toBeDisabled();
  const radio = page.getByRole("radio", { name: /MCP 連線驗證直播間/ });
  await radio.focus();
  await page.keyboard.press("Space");
  await expect(radio).toBeChecked();
  await expect(finish).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/mcp-select-mobile.jpg", fullPage: true });
  let callback = "";
  await page.route("https://mcp-client.example/callback**", route => {
    callback = route.request().url();
    return route.fulfill({ contentType: "text/plain", body: "OAuth callback received" });
  });
  await finish.click();
  await expect.poll(() => Boolean(callback)).toBe(true);
  const code = new URL(callback).searchParams.get("code");
  expect(code).toBeTruthy();
  expect(new URL(callback).searchParams.get("state")).toBe("browser-test");
  const exchanged = await request.post("/token", { form: {
    client_id: clientId, grant_type: "authorization_code", code: code!, code_verifier: verifier,
    redirect_uri: "https://mcp-client.example/callback", resource: `${origin}/mcp`,
  } });
  expect(exchanged.status()).toBe(200);
  const token = (await exchanged.json()).access_token;
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-03-26" };
  const tools = await request.post("/mcp", { headers, data: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} } });
  expect(tools.status()).toBe(200);
  expect((await tools.json()).result.tools).toHaveLength(6);
  await page.goto("/admin/settings/authorized-apps");
  await expect(page.getByText("MCP 瀏覽器測試應用", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /撤銷|取消授權/ }).first().click();
  await page.getByRole("alertdialog").getByRole("button", { name: /撤銷|取消授權/ }).click();
  await expect(page.getByRole("status")).toContainText(/撤銷/);
  const revoked = await request.post("/mcp", { headers, data: { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} } });
  expect(revoked.status()).toBe(401);
});
