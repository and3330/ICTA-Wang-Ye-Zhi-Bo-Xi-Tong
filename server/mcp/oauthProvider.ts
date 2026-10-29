import type { Response } from "express";
import type { OAuthServerProvider, AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthClientInformationFull, OAuthTokens, OAuthTokenRevocationRequest } from "@modelcontextprotocol/sdk/shared/auth.js";
import { InvalidClientMetadataError, InvalidGrantError, InvalidScopeError, InvalidTargetError, InvalidTokenError, InvalidRequestError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { and, eq, isNull, gt } from "drizzle-orm";
import { db } from "../db";
import { mcpOAuthClients as clients, mcpOAuthRequests as requests, mcpOAuthGrants as grants, mcpOAuthCodes as codes, mcpOAuthTokens as tokens, mcpOAuthAudit as audit, users, webinars } from "@shared/schema";
import { ACCESS_SECONDS, GRANT_SECONDS, hash, opaque, validRedirect, validateScopes } from "./policy";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Grant = typeof grants.$inferSelect;
const future = (seconds: number) => new Date(Date.now() + seconds * 1000);
export async function recordAudit(
  action: string, outcome: string,
  context: { userId?: string; clientId?: string; grantId?: string; tool?: string } = {},
  connection: Tx | typeof db = db,
) {
  // No raw tokens, query strings, contact data, callback state or tool output.
  await connection.insert(audit).values({ action, outcome, ...context });
}
export async function liveGrant(connection: Tx | typeof db, id: string): Promise<Grant> {
  const [row] = await connection.select({ grant: grants }).from(grants)
    .innerJoin(users, eq(users.id, grants.userId))
    .innerJoin(webinars, and(eq(webinars.id, grants.webinarId), eq(webinars.userId, grants.userId)))
    .where(and(eq(grants.id, id), isNull(grants.revokedAt), gt(grants.expiresAt, new Date()), eq(users.isActive, true)));
  if (!row) throw new InvalidTokenError("Authorization expired, revoked or unavailable");
  return row.grant;
}
export async function mintTokens(tx: Tx, grant: Grant): Promise<OAuthTokens> {
  const access = opaque(), refresh = opaque();
  await tx.insert(tokens).values([
    { hash: hash(access), grantId: grant.id, kind: "access", expiresAt: future(ACCESS_SECONDS) },
    { hash: hash(refresh), grantId: grant.id, kind: "refresh", expiresAt: grant.expiresAt },
  ]);
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_SECONDS, refresh_token: refresh, scope: grant.scopes.join(" ") };
}
export class SellCaseOAuthProvider implements OAuthServerProvider {
  constructor(readonly base: string) {}
  get resource() { return `${this.base}/mcp`; }
  clientsStore = {
    getClient: async (clientId: string): Promise<OAuthClientInformationFull | undefined> => {
      const [row] = await db.select().from(clients).where(eq(clients.id, clientId));
      return row?.metadata as OAuthClientInformationFull | undefined;
    },
    registerClient: async (input: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">): Promise<OAuthClientInformationFull> => {
      // Both public PKCE clients and confidential clients are supported. The
      // SDK-generated secret is returned once, but only its hash is persisted.
      if (!["none", "client_secret_post"].includes(input.token_endpoint_auth_method || "")) {
        throw new InvalidClientMetadataError("Use none or client_secret_post with S256 PKCE");
      }
      if (!input.redirect_uris?.length || input.redirect_uris.length > 10 ||
          input.redirect_uris.some(uri => !validRedirect(uri))) {
        throw new InvalidClientMetadataError("Register 1–10 exact HTTPS or native loopback redirect URIs");
      }
      if (input.client_name && input.client_name.length > 100) throw new InvalidClientMetadataError("Client name too long");
      if (input.grant_types?.some(type => !["authorization_code", "refresh_token"].includes(type)) ||
          input.response_types?.some(type => type !== "code")) throw new InvalidClientMetadataError("Only authorization code with PKCE is supported");
      try { validateScopes(input.scope?.split(" ")); } catch { throw new InvalidClientMetadataError("Unsupported scope"); }
      const client: OAuthClientInformationFull = {
        client_id: opaque(), client_id_issued_at: Math.floor(Date.now() / 1000),
        client_name: input.client_name || "未命名應用",
        redirect_uris: Array.from(new Set(input.redirect_uris)),
        token_endpoint_auth_method: input.token_endpoint_auth_method,
        ...(input.client_secret ? { client_secret: input.client_secret, client_secret_expires_at: input.client_secret_expires_at } : {}),
        grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
      };
      const stored = { ...client, ...(client.client_secret ? { client_secret: hash(client.client_secret) } : {}) };
      await db.insert(clients).values({ id: client.client_id, metadata: stored as unknown as Record<string, unknown> });
      await recordAudit("client.register", "success", { clientId: client.client_id });
      return client;
    },
  };
  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response) {
    // Stricter than the SDK's native-loopback port exception: exact callbacks.
    if (!client.redirect_uris.includes(params.redirectUri)) throw new InvalidRequestError("redirect_uri must exactly match registration");
    if (!/^[A-Za-z0-9_-]{43}$/.test(params.codeChallenge)) throw new InvalidRequestError("S256 PKCE challenge required");
    let scopes: string[];
    try { scopes = validateScopes(params.scopes); } catch { throw new InvalidScopeError("Unsupported scope"); }
    if (params.resource && params.resource.href !== this.resource) throw new InvalidTargetError("Resource must be the SellCase MCP endpoint");
    if (params.state && params.state.length > 1024) throw new InvalidRequestError("State too long");
    const request = opaque();
    await db.insert(requests).values({
      hash: hash(request), clientId: client.client_id, expiresAt: future(600),
      params: { redirectUri: params.redirectUri, codeChallenge: params.codeChallenge, scopes, state: params.state, resource: this.resource },
    });
    await recordAudit("authorization.start", "success", { clientId: client.client_id });
    res.redirect(`/oauth/consent?request=${request}`);
  }
  async challengeForAuthorizationCode(client: OAuthClientInformationFull, code: string) {
    const [row] = await db.select({ code: codes, clientId: grants.clientId }).from(codes)
      .innerJoin(grants, eq(grants.id, codes.grantId))
      .where(and(eq(codes.hash, hash(code)), eq(grants.clientId, client.client_id)));
    if (!row || row.code.expiresAt < new Date()) throw new InvalidGrantError("Invalid authorization code");
    return row.code.codeChallenge;
  }
  async exchangeAuthorizationCode(client: OAuthClientInformationFull, code: string, _verifier?: string, redirectUri?: string, resource?: URL): Promise<OAuthTokens> {
    const result = await db.transaction(async tx => {
      const [row] = await tx.select().from(codes).where(eq(codes.hash, hash(code))).for("update");
      if (!row || row.expiresAt < new Date()) return undefined;
      const [grant] = await tx.select().from(grants).where(eq(grants.id, row.grantId)).for("update");
      if (!grant || grant.clientId !== client.client_id) return undefined;
      if (row.usedAt) {
        await tx.update(grants).set({ revokedAt: new Date() }).where(eq(grants.id, grant.id));
        await recordAudit("code.replay", "revoked", { userId: grant.userId, clientId: grant.clientId, grantId: grant.id }, tx);
        return undefined;
      }
      if (redirectUri !== row.redirectUri || (resource && resource.href !== grant.resource)) return undefined;
      await liveGrant(tx, grant.id);
      await tx.update(codes).set({ usedAt: new Date() }).where(eq(codes.hash, row.hash));
      const issued = await mintTokens(tx, grant);
      await recordAudit("token.issue", "success", { userId: grant.userId, clientId: grant.clientId, grantId: grant.id }, tx);
      return issued;
    });
    if (!result) throw new InvalidGrantError("Invalid, consumed or mismatched authorization code");
    return result;
  }
  async exchangeRefreshToken(client: OAuthClientInformationFull, refresh: string, scopes?: string[], resource?: URL): Promise<OAuthTokens> {
    const result = await db.transaction(async tx => {
      const [row] = await tx.select().from(tokens).where(and(eq(tokens.hash, hash(refresh)), eq(tokens.kind, "refresh"))).for("update");
      if (!row || row.expiresAt < new Date()) return undefined;
      const [grant] = await tx.select().from(grants).where(eq(grants.id, row.grantId)).for("update");
      if (!grant || grant.clientId !== client.client_id) return undefined;
      if (row.usedAt) {
        await tx.update(grants).set({ revokedAt: new Date() }).where(eq(grants.id, grant.id));
        await recordAudit("refresh.replay", "revoked", { userId: grant.userId, clientId: grant.clientId, grantId: grant.id }, tx);
        return undefined;
      }
      if ((resource && resource.href !== grant.resource) || (scopes && (
        scopes.length !== grant.scopes.length || scopes.some(scope => !grant.scopes.includes(scope))
      ))) return undefined;
      await liveGrant(tx, grant.id);
      await tx.update(tokens).set({ usedAt: new Date() }).where(eq(tokens.hash, row.hash));
      const issued = await mintTokens(tx, grant);
      await recordAudit("token.refresh", "success", { userId: grant.userId, clientId: grant.clientId, grantId: grant.id }, tx);
      return issued;
    });
    if (!result) throw new InvalidGrantError("Invalid or consumed refresh token");
    return result;
  }
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new InvalidTokenError("Invalid access token");
    const [row] = await db.select().from(tokens)
      .where(and(eq(tokens.hash, hash(token)), eq(tokens.kind, "access"), gt(tokens.expiresAt, new Date())));
    if (!row) throw new InvalidTokenError("Invalid or expired access token");
    const grant = await liveGrant(db, row.grantId);
    if (grant.resource !== this.resource) throw new InvalidTokenError("Invalid token audience");
    return { token, clientId: grant.clientId, scopes: grant.scopes, expiresAt: Math.floor(row.expiresAt.getTime() / 1000),
      resource: new URL(grant.resource), extra: { grantId: grant.id, userId: grant.userId, webinarId: grant.webinarId } };
  }
  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest) {
    await db.transaction(async tx => {
      const [row] = await tx.select({ grant: grants }).from(tokens)
        .innerJoin(grants, eq(grants.id, tokens.grantId))
        .where(and(eq(tokens.hash, hash(request.token)), eq(grants.clientId, client.client_id)));
      if (!row) return;
      await tx.update(grants).set({ revokedAt: new Date() }).where(eq(grants.id, row.grant.id));
      await recordAudit("token.revoke", "success", { userId: row.grant.userId, clientId: client.client_id, grantId: row.grant.id }, tx);
    });
  }
}
