import type { Express, Request, Response, NextFunction, RequestHandler } from "express";
import { mcpAuthRouter, createOAuthMetadata } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { and, eq, gt, isNull, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { postgresRateLimit } from "../rateLimit";
import { users, webinars, mcpOAuthClients as clients, mcpOAuthRequests as requests, mcpOAuthGrants as grants, mcpOAuthCodes as codes, type User } from "@shared/schema";
import { SellCaseOAuthProvider, recordAudit } from "./oauthProvider";
import { createMcpServer } from "./tools";
import { SCOPES, GRANT_SECONDS, hash, opaque, publicBaseUrl } from "./policy";

const handleSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const asyncRoute = (handler: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { void handler(req, res).catch(next); };
function privateHeaders(_req: Request, res: Response, next: NextFunction) {
  res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" });
  next();
}
async function member(req: Request, res: Response) {
  const id = req.session?.userId;
  const [user] = id ? await db.select({ id: users.id, isActive: users.isActive }).from(users).where(eq(users.id, id)) : [];
  if (!user?.isActive) {
    res.status(401).json({ message: "請先登入有效的 SellCase 帳號" });
    return;
  }
  return user.id;
}
function callback(redirectUri: string, state: string | undefined, result: Record<string, string>) {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(result)) url.searchParams.set(key, value);
  if (state !== undefined) url.searchParams.set("state", state);
  return url.href;
}
export function registerMcpRoutes(app: Express, hasEntitlement: (user: User | undefined) => Promise<boolean>) {
  // Missing configuration disables only the new integration, never existing
  // login, billing, webhooks or startup health checks.
  let base: string;
  try { base = publicBaseUrl(); } catch {
    for (const path of ["/mcp", "/authorize", "/token", "/register", "/revoke", "/.well-known/oauth-authorization-server", "/.well-known/oauth-protected-resource", "/api/oauth"]) {
      app.use(path, (_req, res) => res.status(503).json({ message: "OAuth/MCP 尚未設定 PUBLIC_BASE_URL" }));
    }
    return;
  }
  const provider = new SellCaseOAuthProvider(base);
  const publicPaths = ["/mcp", "/authorize", "/token", "/register", "/revoke", "/.well-known/oauth-authorization-server", "/.well-known/oauth-protected-resource"];
  // Override the legacy app-wide credentialed CORS for machine OAuth/MCP.
  // Tokens, not cookies, authenticate these public protocol endpoints.
  for (const path of publicPaths) app.use(path, (req, res, next) => {
    res.removeHeader("Access-Control-Allow-Credentials");
    res.set({
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id",
      "Access-Control-Expose-Headers": "WWW-Authenticate, MCP-Session-Id, MCP-Protocol-Version",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
    });
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  app.use("/api/oauth", privateHeaders, (req, res, next) => {
    // Defend these cookie-authenticated UI routes from the existing global CORS.
    const origin = req.get("Origin");
    res.removeHeader("Access-Control-Allow-Credentials");
    res.setHeader("Access-Control-Allow-Origin", base);
    if (origin && origin !== base) return res.status(403).json({ message: "不允許跨來源授權操作" });
    if (req.method !== "GET" && req.method !== "HEAD" && origin !== base) {
      return res.status(403).json({ message: "授權操作需要同來源驗證" });
    }
    next();
  }, postgresRateLimit({ namespace: "mcp-oauth-ui", limit: 90, windowSeconds: 60 }));
  app.use(["/oauth/consent", "/admin/settings/authorized-apps"], privateHeaders, (_req, res, next) => {
    res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
    res.setHeader("X-Frame-Options", "DENY");
    next();
  });
  const protocolLimit = postgresRateLimit({ namespace: "mcp-oauth-protocol", limit: 120, windowSeconds: 60 });
  for (const path of ["/authorize", "/token", "/revoke"]) app.use(path, protocolLimit);
  app.use("/token", (req, res, next) => {
    if (req.method === "POST" && req.body?.grant_type === "authorization_code" &&
        !/^[A-Za-z0-9._~-]{43,128}$/.test(req.body?.code_verifier || "")) {
      return res.status(400).json({ error: "invalid_request", error_description: "A 43–128 character PKCE verifier is required" });
    }
    next();
  });
  // The SDK checks equality against clientsStore.getClient(). Hash confidential
  // client credentials before that comparison so the store never needs plaintext.
  for (const path of ["/token", "/revoke"]) app.use(path, (req, _res, next) => {
    if (typeof req.body?.client_secret === "string") req.body.client_secret = hash(req.body.client_secret);
    next();
  });
  app.use("/register", postgresRateLimit({ namespace: "mcp-client-registration", limit: 20, windowSeconds: 3600 }), (req, _res, next) => {
    if (req.method === "POST" && req.body && req.body.token_endpoint_auth_method === undefined) {
      req.body.token_endpoint_auth_method = "none";
    }
    next();
  });
  const metadata = createOAuthMetadata({ provider, issuerUrl: new URL(base), scopesSupported: Object.keys(SCOPES) });
  metadata.token_endpoint_auth_methods_supported = ["none", "client_secret_post"];
  metadata.revocation_endpoint_auth_methods_supported = ["none", "client_secret_post"];
  app.get("/.well-known/oauth-authorization-server", (_req, res) => res.json(metadata));
  const resourceMetadata = {
    resource: provider.resource, authorization_servers: [new URL(base).href], scopes_supported: Object.keys(SCOPES),
    bearer_methods_supported: ["header"], resource_name: "SellCase 唯讀直播間",
  };
  app.get(["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"], (_req, res) => res.json(resourceMetadata));
  app.use(mcpAuthRouter({
    provider, issuerUrl: new URL(base), resourceServerUrl: new URL(provider.resource), scopesSupported: Object.keys(SCOPES),
    authorizationOptions: { rateLimit: false }, tokenOptions: { rateLimit: false },
    clientRegistrationOptions: { rateLimit: false }, revocationOptions: { rateLimit: false },
  }));

  app.get("/api/oauth/requests/:request", asyncRoute(async (req, res) => {
    const userId = await member(req, res); if (!userId) return;
    const handle = handleSchema.safeParse(req.params.request);
    if (!handle.success) return res.status(400).json({ message: "無效的授權請求" });
    const csrfToken = opaque();
    const data = await db.transaction(async tx => {
      const [flow] = await tx.select().from(requests).where(and(eq(requests.hash, hash(handle.data)), gt(requests.expiresAt, new Date()), isNull(requests.usedAt))).for("update");
      if (!flow || (flow.userId && flow.userId !== userId)) return;
      await tx.update(requests).set({ userId, csrfHash: hash(csrfToken) }).where(eq(requests.hash, flow.hash));
      const [client] = await tx.select().from(clients).where(eq(clients.id, flow.clientId));
      const owned = await tx.select({
        id: webinars.id, title: webinars.title, coverImage: webinars.coverImage, status: webinars.status, publishStatus: webinars.publishStatus,
      }).from(webinars).where(eq(webinars.userId, userId)).orderBy(desc(webinars.createdAt));
      return { client: { name: String(client.metadata.client_name), redirectUri: flow.params.redirectUri },
        scopes: flow.params.scopes.map(name => ({ name, label: SCOPES[name as keyof typeof SCOPES] })),
        csrfToken, consented: Boolean(flow.consentedAt), webinars: owned };
    });
    if (!data) return res.status(410).json({ message: "授權請求已過期、已使用或屬於其他帳號，請從外部應用重新連線" });
    res.json(data);
  }));
  for (const operation of ["consent", "complete", "deny"] as const) {
    app.post(`/api/oauth/requests/:request/${operation}`, asyncRoute(async (req, res) => {
      const userId = await member(req, res); if (!userId) return;
      const handle = handleSchema.safeParse(req.params.request);
      const input = z.object({
        csrfToken: handleSchema, webinarId: z.string().uuid().optional(),
      }).strict().safeParse(req.body);
      if (!handle.success || !input.success) return res.status(400).json({ message: "無效的授權操作" });
      const result = await db.transaction(async tx => {
        const [flow] = await tx.select().from(requests).where(and(eq(requests.hash, hash(handle.data)), eq(requests.userId, userId),
          gt(requests.expiresAt, new Date()), isNull(requests.usedAt))).for("update");
        if (!flow || flow.csrfHash !== hash(input.data.csrfToken)) return;
        const context = { userId, clientId: flow.clientId };
        if (operation === "consent") {
          await tx.update(requests).set({ consentedAt: new Date() }).where(eq(requests.hash, flow.hash));
          await recordAudit("authorization.consent", "success", context, tx);
          return { success: true };
        }
        if (operation === "deny") {
          await tx.update(requests).set({ usedAt: new Date() }).where(eq(requests.hash, flow.hash));
          await recordAudit("authorization.deny", "success", context, tx);
          return { redirectUrl: callback(flow.params.redirectUri, flow.params.state, { error: "access_denied" }) };
        }
        if (!flow.consentedAt || !input.data.webinarId) return;
        const [owned] = await tx.select({ id: webinars.id }).from(webinars)
          .where(and(eq(webinars.id, input.data.webinarId), eq(webinars.userId, userId))).for("share");
        if (!owned) return;
        const [grant] = await tx.insert(grants).values({
          userId, webinarId: owned.id, clientId: flow.clientId, scopes: flow.params.scopes,
          resource: flow.params.resource, expiresAt: new Date(Date.now() + GRANT_SECONDS * 1000),
        }).returning();
        const code = opaque();
        await tx.insert(codes).values({ hash: hash(code), grantId: grant.id, redirectUri: flow.params.redirectUri,
          codeChallenge: flow.params.codeChallenge, expiresAt: new Date(Date.now() + 60_000) });
        await tx.update(requests).set({ usedAt: new Date() }).where(eq(requests.hash, flow.hash));
        await recordAudit("authorization.complete", "success", { ...context, grantId: grant.id }, tx);
        return { redirectUrl: callback(flow.params.redirectUri, flow.params.state, { code }) };
      });
      if (!result) {
        await recordAudit("authorization.operation", "denied", { userId });
        return res.status(400).json({ message: "授權已失效、尚未同意、驗證碼不符或直播間不屬於您" });
      }
      res.json(result);
    }));
  }
  app.get("/api/oauth/grants", asyncRoute(async (req, res) => {
    const userId = await member(req, res); if (!userId) return;
    const rows = await db.select({ grant: grants, metadata: clients.metadata, title: webinars.title }).from(grants)
      .innerJoin(clients, eq(clients.id, grants.clientId)).innerJoin(webinars, eq(webinars.id, grants.webinarId))
      .where(eq(grants.userId, userId)).orderBy(desc(grants.createdAt));
    res.json(rows.map(row => ({ id: row.grant.id, clientName: row.metadata.client_name,
      webinarTitle: row.title, webinarId: row.grant.webinarId, scopes: row.grant.scopes,
      createdAt: row.grant.createdAt, expiresAt: row.grant.expiresAt, revokedAt: row.grant.revokedAt })));
  }));
  app.post("/api/oauth/grants/:id/revoke", asyncRoute(async (req, res) => {
    const userId = await member(req, res); if (!userId) return;
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ message: "無效的授權 ID" });
    const revoked = await db.transaction(async tx => {
      const [row] = await tx.update(grants).set({ revokedAt: new Date() })
        .where(and(eq(grants.id, id.data), eq(grants.userId, userId))).returning({ id: grants.id });
      if (row) await recordAudit("member.revoke", "success", { userId, grantId: row.id }, tx);
      return row;
    });
    if (!revoked) return res.status(404).json({ message: "找不到授權" });
    res.json({ success: true });
  }));

  app.all("/mcp", postgresRateLimit({ namespace: "mcp-ip", limit: 180, windowSeconds: 60 }), asyncRoute(async (req, res) => {
    const bearer = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(req.get("Authorization") || "")?.[1];
    let info;
    try {
      if (!bearer) throw new Error("Missing token");
      info = await provider.verifyAccessToken(bearer);
    } catch {
      await recordAudit("mcp.authenticate", "denied");
      res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp", error="invalid_token"`);
      return res.status(401).json({ error: "invalid_token" });
    }
    // Persistent per-grant quota, independent of browser sessions and source IP.
    const limit = await db.execute(sql`
      INSERT INTO rate_limit_buckets ("key", window_started_at, request_count, expires_at)
      VALUES (${`mcp-grant:${info.extra!.grantId}`}, now(), 1, now() + interval '1 minute')
      ON CONFLICT ("key") DO UPDATE SET
        request_count = CASE WHEN rate_limit_buckets.expires_at <= now() THEN 1 ELSE rate_limit_buckets.request_count + 1 END,
        window_started_at = CASE WHEN rate_limit_buckets.expires_at <= now() THEN now() ELSE rate_limit_buckets.window_started_at END,
        expires_at = CASE WHEN rate_limit_buckets.expires_at <= now() THEN now() + interval '1 minute' ELSE rate_limit_buckets.expires_at END
      RETURNING request_count`);
    if (Number(limit.rows[0]?.request_count) > 60) {
      await recordAudit("mcp.rate_limit", "denied", { userId: info.extra!.userId as string, grantId: info.extra!.grantId as string, clientId: info.clientId });
      return res.status(429).set("Retry-After", "60").json({ error: "rate_limit_exceeded" });
    }
    if (req.method !== "POST") return res.status(405).set("Allow", "POST").json({ error: "Stateless MCP uses POST" });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    const server = createMcpServer(info, base, hasEntitlement);
    res.once("close", () => { void server.close().catch(() => {}); });
    await server.connect(transport);
    await transport.handleRequest(req as unknown as Parameters<typeof transport.handleRequest>[0], res, req.body);
  }));
}
