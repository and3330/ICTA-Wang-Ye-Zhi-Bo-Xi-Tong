import crypto from "node:crypto";

export const SCOPES = {
  "webinars:read": "讀取直播間",
  "sessions:read": "讀取場次",
  "registrations:read": "讀取報名（Email 與電話遮罩）",
} as const;
export const ACCESS_SECONDS = 3600;
export const GRANT_SECONDS = 30 * 24 * 3600;
export const opaque = () => crypto.randomBytes(32).toString("base64url");
export const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
export function publicBaseUrl(value = process.env.PUBLIC_BASE_URL): string {
  if (!value) throw new Error("PUBLIC_BASE_URL is required for OAuth/MCP");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("PUBLIC_BASE_URL must be an HTTPS origin");
  }
  return url.origin;
}
export function validateScopes(scopes: string[] | undefined): string[] {
  const result = Array.from(new Set(scopes?.length ? scopes : Object.keys(SCOPES)));
  if (result.some(scope => !Object.hasOwn(SCOPES, scope))) throw new Error("Unsupported scope");
  return result;
}
export function validRedirect(value: string): boolean {
  try {
    const url = new URL(value);
    // Native loopback HTTP is the sole HTTPS exception. Never fetch this URL.
    return !url.hash && !url.username && !url.password && (
      url.protocol === "https:" ||
      (url.protocol === "http:" && ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname))
    );
  } catch { return false; }
}
export function maskEmail(value: string): string {
  const at = value.lastIndexOf("@");
  return at > 0 ? `${value.slice(0, 1)}***@${value.slice(at + 1)}` : "***";
}
export function maskPhone(value: string | null): string {
  return value ? `***${value.replace(/\D/g, "").slice(-2)}` : "";
}
export function registrationLink(input: {
  id: string; publishStatus: string; landingPublished: boolean; external: boolean; publiclyEntitled: boolean;
}, base: string) {
  if (input.publishStatus !== "published") return { canRegister: false, reason: "直播間未發佈", url: null };
  if (!input.landingPublished && !input.external) return { canRegister: false, reason: "落地頁未發佈", url: null };
  if (!input.publiclyEntitled) return { canRegister: false, reason: "會員公開發布權限已失效", url: null };
  return { canRegister: true, reason: null, url: `${publicBaseUrl(base)}/register/${encodeURIComponent(input.id)}` };
}
