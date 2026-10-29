import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import { createServer } from "node:http";
import { eq, inArray, or } from "drizzle-orm";
import { db, pool, runAppMigrations } from "./db";
import { users, webinars, webinarSessions, registrations, registrationIdentityKeys, webinarLandingPages, externalJourneySettings,
  mcpOAuthClients, mcpOAuthRequests, mcpOAuthGrants, mcpOAuthCodes, mcpOAuthTokens, mcpOAuthAudit, rateLimitBuckets } from "@shared/schema";
import { registerMcpRoutes } from "./mcp/routes";
import { publicBaseUrl, registrationLink, validateScopes, validRedirect, maskEmail, maskPhone, hash, opaque } from "./mcp/policy";

test("MCP policy: fixed HTTPS origin, safe redirects, scopes and contact masking", () => {
  assert.equal(publicBaseUrl("https://icta-webinar.com"), "https://icta-webinar.com");
  for (const value of [undefined, "http://example.com", "https://example.com/path", "https://example.com/?q=1", "https://a:b@example.com"]) {
    assert.throws(() => publicBaseUrl(value || ""));
  }
  assert.equal(validRedirect("https://client.example/cb"), true);
  assert.equal(validRedirect("http://127.0.0.1:1234/cb"), true);
  for (const uri of ["javascript:alert(1)", "http://client.example/cb", "https://client.example/cb#fragment", "https://u:p@client.example"]) {
    assert.equal(validRedirect(uri), false);
  }
  for (const scope of ["write", "__proto__", "constructor"]) assert.throws(() => validateScopes([scope]));
  assert.equal(validateScopes(undefined).length, 3);
  assert.equal(maskEmail("member@example.test"), "m***@example.test");
  assert.equal(maskPhone("0912345678"), "***78");
  const input = { id: crypto.randomUUID(), publishStatus: "draft", landingPublished: true, external: false, publiclyEntitled: true };
  assert.equal(registrationLink(input, "https://icta-webinar.com").reason, "直播間未發佈");
  assert.equal(registrationLink({ ...input, publishStatus: "published", landingPublished: false }, "https://icta-webinar.com").reason, "落地頁未發佈");
  assert.equal(registrationLink({ ...input, publishStatus: "published", landingPublished: false, external: true }, "https://icta-webinar.com").url, `https://icta-webinar.com/register/${input.id}`);
  assert.equal(registrationLink({ ...input, publishStatus: "published", publiclyEntitled: false }, "https://icta-webinar.com").url, null);
});

test("OAuth and Streamable HTTP: consent, tenant isolation, PKCE, rotation and revocation", { timeout: 120_000 }, async t => {
  await runAppMigrations();
  const base = "https://mcp-test.example";
  const priorBase = process.env.PUBLIC_BASE_URL;
  process.env.PUBLIC_BASE_URL = base;
  const owner = crypto.randomUUID(), other = crypto.randomUUID();
  const selected = crypto.randomUUID(), unselected = crypto.randomUUID(), foreign = crypto.randomUUID();
  const clientIds: string[] = [];
  const grantIds: string[] = [];
  await db.insert(users).values([
    { id: owner, username: `mcp-test-${owner}`, password: "not-a-real-login", email: "mcp-owner@example.test" },
    { id: other, username: `mcp-test-${other}`, password: "not-a-real-login", email: "mcp-other@example.test" },
  ]);
  await db.insert(webinars).values([
    { id: selected, userId: owner, title: "MCP 測試直播間", vimeoUrl: "", startTime: new Date() },
    { id: unselected, userId: owner, title: "未授權直播間", vimeoUrl: "", startTime: new Date() },
    { id: foreign, userId: other, title: "其他會員直播間", vimeoUrl: "", startTime: new Date() },
  ]);
  await db.insert(registrations).values(Array.from({ length: 3 }, (_, i) => ({
    webinarId: selected, name: `測試觀眾 ${i}`, email: `person${i}@example.test`, phone: "0912345678", attended: i === 0,
  })));
  await db.insert(registrations).values({ webinarId: foreign, name: "外部會員", email: "foreign@example.test" });
  await db.insert(webinarSessions).values({ webinarId: selected, scheduledStart: new Date() });
  const app = express();
  app.use(express.json()); app.use(express.urlencoded({ extended: false }));
  // Test-only session stub on a loopback-only fixture server, never installed
  // in the actual app or reachable from the preview/production server.
  app.use((req, _res, next) => {
    (req as any).session = { userId: req.get("X-Test-Member") };
    next();
  });
  registerMcpRoutes(app, async () => true);
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) =>
    res.status(500).json({ message: err.message }));
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const host = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await db.delete(mcpOAuthRequests).where(inArray(mcpOAuthRequests.clientId, clientIds));
    await db.delete(registrationIdentityKeys).where(inArray(registrationIdentityKeys.webinarId, [selected, unselected, foreign]));
    await db.delete(registrations).where(inArray(registrations.webinarId, [selected, unselected, foreign]));
    await db.delete(webinarSessions).where(inArray(webinarSessions.webinarId, [selected, unselected, foreign]));
    await db.delete(webinarLandingPages).where(inArray(webinarLandingPages.webinarId, [selected, unselected, foreign]));
    await db.delete(externalJourneySettings).where(inArray(externalJourneySettings.webinarId, [selected, unselected, foreign]));
    await db.delete(webinars).where(inArray(webinars.id, [selected, unselected, foreign]));
    await db.delete(users).where(inArray(users.id, [owner, other]));
    await db.delete(mcpOAuthClients).where(inArray(mcpOAuthClients.id, clientIds));
    await db.delete(mcpOAuthAudit).where(or(inArray(mcpOAuthAudit.userId, [owner, other]), inArray(mcpOAuthAudit.clientId, clientIds)));
    if (grantIds.length) await db.delete(rateLimitBuckets).where(inArray(rateLimitBuckets.key, grantIds.map(id => `mcp-grant:${id}`)));
    if (priorBase === undefined) delete process.env.PUBLIC_BASE_URL; else process.env.PUBLIC_BASE_URL = priorBase;
    await pool.end();
  });
  async function json(path: string, body: unknown, memberId = owner, origin = base) {
    return fetch(host + path, { method: "POST", headers: { "Content-Type": "application/json", "X-Test-Member": memberId, Origin: origin }, body: JSON.stringify(body), redirect: "manual" });
  }
  async function register(extra: Record<string, unknown> = {}) {
    const response = await json("/register", { client_name: "測試連線", redirect_uris: ["https://client.example/callback"], token_endpoint_auth_method: "none", ...extra });
    assert.equal(response.status, 201);
    const client = await response.json() as any; clientIds.push(client.client_id);
    if (client.token_endpoint_auth_method === "none") assert.equal(client.client_secret, undefined);
    return client;
  }
  const client = await register();
  const verifier = opaque(), challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  async function begin(scopes?: string) {
    const query = new URLSearchParams({ client_id: client.client_id, response_type: "code",
      redirect_uri: client.redirect_uris[0], code_challenge: challenge, code_challenge_method: "S256", state: "opaque-state", resource: `${base}/mcp` });
    if (scopes) query.set("scope", scopes);
    const response = await fetch(`${host}/authorize?${query}`, { redirect: "manual" });
    assert.equal(response.status, 302);
    const handle = new URL(response.headers.get("location")!, base).searchParams.get("request")!;
    assert.ok(handle);
    return handle;
  }
  async function context(handle: string, user = owner) {
    return fetch(`${host}/api/oauth/requests/${handle}`, { headers: { "X-Test-Member": user } });
  }
  async function authorize(scopes?: string) {
    const handle = await begin(scopes);
    const ctx = await (await context(handle)).json() as any;
    assert.equal((await json(`/api/oauth/requests/${handle}/consent`, { csrfToken: ctx.csrfToken })).status, 200);
    const result = await json(`/api/oauth/requests/${handle}/complete`, { csrfToken: ctx.csrfToken, webinarId: selected });
    assert.equal(result.status, 200);
    const redirect = new URL((await result.json() as any).redirectUrl);
    assert.equal(redirect.searchParams.get("state"), "opaque-state");
    return redirect.searchParams.get("code")!;
  }
  async function exchange(code: string, options: Record<string, string> = {}) {
    return fetch(host + "/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", client_id: client.client_id, code, code_verifier: verifier, redirect_uri: client.redirect_uris[0], resource: `${base}/mcp`, ...options }) });
  }
  async function issue(scopes?: string) {
    const response = await exchange(await authorize(scopes));
    assert.equal(response.status, 200);
    const issued = await response.json() as any;
    const [row] = await db.select().from(mcpOAuthTokens).where(eq(mcpOAuthTokens.hash, hash(issued.access_token)));
    grantIds.push(row.grantId);
    return { ...issued, grantId: row.grantId };
  }
  let rpcId = 0;
  async function rpc(token: string | undefined, method: string, params: unknown = {}) {
    return fetch(host + "/mcp", {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-03-26", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    });
  }
  async function call(token: string, name: string, args: Record<string, unknown> = {}) {
    const response = await rpc(token, "tools/call", { name, arguments: args });
    assert.equal(response.status, 200);
    return (await response.json() as any).result;
  }
  await t.test("discovery, public registration and redirect/PKCE validation", async () => {
    const metadata = await (await fetch(host + "/.well-known/oauth-authorization-server")).json() as any;
    assert.deepEqual(metadata.token_endpoint_auth_methods_supported, ["none", "client_secret_post"]);
    assert.deepEqual(metadata.code_challenge_methods_supported, ["S256"]);
    assert.equal(metadata.authorization_endpoint, base + "/authorize");
    const resource = await (await fetch(host + "/.well-known/oauth-protected-resource/mcp")).json() as any;
    assert.equal(resource.resource, base + "/mcp");
    assert.equal((await json("/register", { redirect_uris: ["javascript:alert(1)"], token_endpoint_auth_method: "none" })).status, 400);
    assert.equal((await json("/register", { redirect_uris: ["https://client.example/cb"], token_endpoint_auth_method: "client_secret_basic" })).status, 400);
    const invalid = new URLSearchParams({ client_id: client.client_id, response_type: "code", redirect_uri: "https://evil.example/cb", code_challenge: challenge, code_challenge_method: "S256" });
    assert.equal((await fetch(`${host}/authorize?${invalid}`, { redirect: "manual" })).status, 400);
    invalid.set("redirect_uri", client.redirect_uris[0]); invalid.set("code_challenge_method", "plain");
    const plain = await fetch(`${host}/authorize?${invalid}`, { redirect: "manual" });
    assert.ok(plain.status === 400 || new URL(plain.headers.get("location")!).searchParams.has("error"));
  });
  await t.test("explicit consent, CSRF, selection and owner checks", async () => {
    const handle = await begin();
    assert.equal((await context(handle, "")).status, 401);
    const ctx = await (await context(handle)).json() as any;
    assert.equal(ctx.webinars.length, 2);
    assert.ok(!ctx.webinars.some((w: any) => w.id === foreign));
    assert.equal((await context(handle, other)).status, 410);
    assert.equal((await json(`/api/oauth/requests/${handle}/complete`, { csrfToken: ctx.csrfToken, webinarId: selected })).status, 400);
    assert.equal((await json(`/api/oauth/requests/${handle}/consent`, { csrfToken: opaque() })).status, 400);
    assert.equal((await json(`/api/oauth/requests/${handle}/consent`, { csrfToken: ctx.csrfToken }, owner, "https://evil.example")).status, 403);
    assert.equal((await json(`/api/oauth/requests/${handle}/consent`, { csrfToken: ctx.csrfToken })).status, 200);
    assert.equal((await json(`/api/oauth/requests/${handle}/complete`, { csrfToken: ctx.csrfToken, webinarId: foreign })).status, 400);
    assert.equal((await json(`/api/oauth/requests/${handle}/complete`, { csrfToken: ctx.csrfToken, webinarId: selected })).status, 200);
    assert.equal((await json(`/api/oauth/requests/${handle}/complete`, { csrfToken: ctx.csrfToken, webinarId: selected })).status, 400);
  });
  await t.test("code mismatch, audience binding and concurrent single-use exchange", async () => {
    const code = await authorize();
    assert.equal((await exchange(code, { code_verifier: opaque() })).status, 400);
    assert.equal((await exchange(code, { redirect_uri: "https://evil.example" })).status, 400);
    assert.equal((await exchange(code, { resource: "https://other.example/mcp" })).status, 400);
    assert.equal((await exchange(code, { code_verifier: "short" })).status, 400);
    const pair = await Promise.all([exchange(code), exchange(code)]);
    assert.deepEqual(pair.map(r => r.status).sort(), [200, 400]);
    const issued = await pair.find(r => r.status === 200)!.json() as any;
    // Authorization code replay revokes the whole grant.
    assert.equal((await rpc(issued.access_token, "tools/list")).status, 401);
  });
  await t.test("confidential dynamic clients store only a secret hash and require the secret", async () => {
    const confidential = await register({ token_endpoint_auth_method: "client_secret_post" });
    assert.ok(confidential.client_secret);
    const [stored] = await db.select().from(mcpOAuthClients).where(eq(mcpOAuthClients.id, confidential.client_id));
    assert.equal(stored.metadata.client_secret, hash(confidential.client_secret));
    const query = new URLSearchParams({ client_id: confidential.client_id, response_type: "code",
      redirect_uri: confidential.redirect_uris[0], code_challenge: challenge, code_challenge_method: "S256", resource: `${base}/mcp` });
    const started = await fetch(`${host}/authorize?${query}`, { redirect: "manual" });
    const handle = new URL(started.headers.get("location")!, base).searchParams.get("request")!;
    const ctx = await (await context(handle)).json() as any;
    await json(`/api/oauth/requests/${handle}/consent`, { csrfToken: ctx.csrfToken });
    const result = await (await json(`/api/oauth/requests/${handle}/complete`, { csrfToken: ctx.csrfToken, webinarId: selected })).json() as any;
    const code = new URL(result.redirectUrl).searchParams.get("code")!;
    assert.equal((await exchange(code)).status, 400); // Another client's code.
    assert.equal((await exchange(code, { client_id: confidential.client_id, client_secret: "wrong" })).status, 400);
    const correct = await exchange(code, { client_id: confidential.client_id, client_secret: confidential.client_secret });
    assert.equal(correct.status, 200);
    const issued = await correct.json() as any;
    assert.equal((await rpc(issued.access_token, "tools/list")).status, 200);
  });
  const issued = await issue();
  await t.test("MCP initialize, six read-only tools, selected-webinar isolation and masked pagination", async () => {
    const unauthenticated = await rpc(undefined, "tools/list");
    assert.equal(unauthenticated.status, 401);
    assert.match(unauthenticated.headers.get("www-authenticate")!, /resource_metadata/);
    const init = await (await rpc(issued.access_token, "initialize", {
      protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" },
    })).json() as any;
    assert.equal(init.result.serverInfo.name, "SellCase");
    const list = await (await rpc(issued.access_token, "tools/list")).json() as any;
    assert.equal(list.result.tools.length, 6);
    assert.ok(list.result.tools.every((tool: any) => tool.annotations.readOnlyHint && !tool.annotations.destructiveHint));
    const ownList = JSON.parse((await call(issued.access_token, "list_webinars")).content[0].text);
    assert.deepEqual(ownList.webinars.map((w: any) => w.id), [selected]);
    for (const id of [unselected, foreign]) {
      const denied = await call(issued.access_token, "get_webinar", { webinar_id: id });
      assert.equal(denied.isError, true);
    }
    const page = JSON.parse((await call(issued.access_token, "list_registrations", { webinar_id: selected, limit: 2, offset: 0 })).content[0].text);
    assert.equal(page.registrations.length, 2); assert.equal(page.nextOffset, 2);
    assert.equal(page.contactsMasked, true);
    assert.ok(page.registrations.every((r: any) => r.email.includes("***") && r.phone === "***78"));
    assert.ok(!JSON.stringify(page).includes("0912345678"));
    const last = JSON.parse((await call(issued.access_token, "list_registrations", { webinar_id: selected, limit: 2, offset: 2 })).content[0].text);
    assert.equal(last.registrations.length, 1); assert.equal(last.nextOffset, null);
    const stats = JSON.parse((await call(issued.access_token, "get_registration_stats", { webinar_id: selected })).content[0].text);
    assert.equal(stats.registered, 3); assert.equal(stats.attended, 1);
    const sessions = JSON.parse((await call(issued.access_token, "list_sessions", { webinar_id: selected })).content[0].text);
    assert.equal(sessions.sessions.length, 1);
    assert.equal((await call(issued.access_token, "delete_webinar", { webinar_id: selected })).isError, true);
  });
  await t.test("registration links follow publication snapshots and fixed PUBLIC_BASE_URL", async () => {
    async function link() {
      return JSON.parse((await call(issued.access_token, "get_registration_link", { webinar_id: selected })).content[0].text);
    }
    assert.equal((await link()).url, null);
    await db.update(webinars).set({ publishStatus: "published" }).where(eq(webinars.id, selected));
    assert.equal((await link()).reason, "落地頁未發佈");
    await db.insert(webinarLandingPages).values({ webinarId: selected, title: "測試落地頁", status: "published" });
    assert.equal((await link()).url, `${base}/register/${selected}`);
    await db.update(webinarLandingPages).set({ status: "draft" }).where(eq(webinarLandingPages.webinarId, selected));
    await db.insert(externalJourneySettings).values({ webinarId: selected, settings: { landingMode: "external" } as any, publishedSettings: null });
    assert.equal((await link()).canRegister, false); // Draft settings never count.
    await db.update(externalJourneySettings).set({ publishedSettings: { landingMode: "external" } as any }).where(eq(externalJourneySettings.webinarId, selected));
    assert.equal((await link()).url, `${base}/register/${selected}`);
  });
  await t.test("scopes, expiry, suspension and ownership change fail closed", async () => {
    const limited = await issue("webinars:read");
    assert.equal((await call(limited.access_token, "list_registrations", { webinar_id: selected })).isError, true);
    await db.update(mcpOAuthTokens).set({ expiresAt: new Date(0) }).where(eq(mcpOAuthTokens.hash, hash(limited.access_token)));
    assert.equal((await rpc(limited.access_token, "tools/list")).status, 401);
    await db.update(users).set({ isActive: false }).where(eq(users.id, owner));
    assert.equal((await rpc(issued.access_token, "tools/list")).status, 401);
    await db.update(users).set({ isActive: true }).where(eq(users.id, owner));
    await db.update(webinars).set({ userId: other }).where(eq(webinars.id, selected));
    assert.equal((await rpc(issued.access_token, "tools/list")).status, 401);
    await db.update(webinars).set({ userId: owner }).where(eq(webinars.id, selected));
  });
  await t.test("refresh rotation, replay family revocation and hash-only storage", async () => {
    const fresh = await issue();
    async function refresh(value: string) {
      return fetch(host + "/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", client_id: client.client_id, refresh_token: value, resource: `${base}/mcp` }) });
    }
    const response = await refresh(fresh.refresh_token); assert.equal(response.status, 200);
    const rotated = await response.json() as any;
    assert.notEqual(rotated.refresh_token, fresh.refresh_token);
    const rows = await db.select().from(mcpOAuthTokens).where(eq(mcpOAuthTokens.grantId, fresh.grantId));
    assert.ok(rows.every(row => /^[a-f0-9]{64}$/.test(row.hash)));
    assert.ok(!JSON.stringify(rows).includes(rotated.access_token));
    assert.equal((await refresh(fresh.refresh_token)).status, 400);
    assert.equal((await rpc(rotated.access_token, "tools/list")).status, 401);
  });
  await t.test("member grant list/revoke, OAuth revoke, audit and persistent rate limit", async () => {
    const fresh = await issue();
    assert.equal((await json(`/api/oauth/grants/${fresh.grantId}/revoke`, {}, other)).status, 404);
    const list = await (await fetch(host + "/api/oauth/grants", { headers: { "X-Test-Member": owner } })).json() as any[];
    assert.ok(list.some(row => row.id === fresh.grantId));
    assert.equal((await json(`/api/oauth/grants/${fresh.grantId}/revoke`, {})).status, 200);
    assert.equal((await rpc(fresh.access_token, "tools/list")).status, 401);
    const revokedByClient = await issue();
    const revoke = await fetch(host + "/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: client.client_id, token: revokedByClient.access_token }) });
    assert.equal(revoke.status, 200);
    assert.equal((await rpc(revokedByClient.access_token, "tools/list")).status, 401);
    const throttled = await issue();
    await db.insert(rateLimitBuckets).values({ key: `mcp-grant:${throttled.grantId}`, requestCount: 60,
      windowStartedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) });
    assert.equal((await rpc(throttled.access_token, "tools/list")).status, 429);
    const audit = await db.select().from(mcpOAuthAudit).where(eq(mcpOAuthAudit.userId, owner));
    assert.ok(audit.some(row => row.tool === "list_registrations" && row.outcome === "success"));
    assert.ok(audit.some(row => row.action === "member.revoke"));
    assert.ok(!JSON.stringify(audit).includes(issued.access_token));
  });
  await t.test("deny and expired requests never issue codes", async () => {
    const handle = await begin();
    const ctx = await (await context(handle)).json() as any;
    const denied = await (await json(`/api/oauth/requests/${handle}/deny`, { csrfToken: ctx.csrfToken })).json() as any;
    assert.equal(new URL(denied.redirectUrl).searchParams.get("error"), "access_denied");
    assert.equal(new URL(denied.redirectUrl).searchParams.has("code"), false);
    assert.equal((await context(handle)).status, 410);
    const expired = await begin();
    await db.update(mcpOAuthRequests).set({ expiresAt: new Date(0) }).where(eq(mcpOAuthRequests.hash, hash(expired)));
    assert.equal((await context(expired)).status, 410);
  });
});
