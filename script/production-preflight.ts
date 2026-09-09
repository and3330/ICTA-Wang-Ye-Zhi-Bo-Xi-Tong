import path from "node:path";

const requiredNames = [
  "DATABASE_URL",
  "SESSION_SECRET",
  "APP_BASE_URL",
  "RESEND_API_KEY",
  "EMAIL_FROM_ADDRESS",
  "ERROR_ALERT_EMAIL",
  "STRIPE_LIVE_PUBLISHABLE_KEY",
  "STRIPE_LIVE_SECRET_KEY",
] as const;

const errors: string[] = [];
for (const name of requiredNames) {
  if (!process.env[name]?.trim()) errors.push(`${name}: missing`);
}

function validatePublicBaseUrl() {
  const raw = process.env.APP_BASE_URL;
  if (!raw) return;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") errors.push("APP_BASE_URL: must use HTTPS");
    if (url.username || url.password) errors.push("APP_BASE_URL: credentials are not allowed");
    if (url.search || url.hash) errors.push("APP_BASE_URL: query strings and fragments are not allowed");
    if (url.pathname !== "/" || raw.endsWith("/")) errors.push("APP_BASE_URL: use the origin only, without a path or trailing slash");
    if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) errors.push("APP_BASE_URL: must be publicly reachable");

    for (const callbackPath of ["/api/stripe/webhook", "/api/ecpay/return"]) {
      const callback = new URL(callbackPath, url);
      if (callback.protocol !== "https:" || callback.origin !== url.origin) {
        errors.push(`APP_BASE_URL: cannot produce a valid callback for ${callbackPath}`);
      }
    }
  } catch {
    errors.push("APP_BASE_URL: invalid absolute URL");
  }
}

function validateOptionalReplitDomains() {
  const configuredDomains = process.env.REPLIT_DOMAINS?.split(",").map((domain) => domain.trim()).filter(Boolean) ?? [];
  for (const domain of configuredDomains) {
    if (domain.includes("://") || domain.includes("/") || domain.includes("?") || domain.includes("#")) {
      errors.push("REPLIT_DOMAINS: entries must be hostnames only");
    }
  }
}

function validateEmailName(name: "EMAIL_FROM_ADDRESS" | "ERROR_ALERT_EMAIL") {
  const value = process.env[name];
  if (value && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) errors.push(`${name}: invalid email address`);
}

validatePublicBaseUrl();
validateOptionalReplitDomains();
validateEmailName("EMAIL_FROM_ADDRESS");
validateEmailName("ERROR_ALERT_EMAIL");

function validateIntegerRange(name: string, min: number, max: number) {
  const raw = process.env[name];
  if (!raw) return;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    errors.push(`${name}: must be an integer from ${min} to ${max}`);
  }
}

validateIntegerRange("DB_POOL_MAX", 1, 100);
validateIntegerRange("DB_CONNECT_TIMEOUT_MS", 100, 60_000);
validateIntegerRange("DB_IDLE_TIMEOUT_MS", 1_000, 600_000);
validateIntegerRange("DB_CONNECTION_MAX_USES", 1, 1_000_000);
validateIntegerRange("SHUTDOWN_TIMEOUT_MS", 5_000, 120_000);

if (process.env.UPLOADS_DIR && !path.isAbsolute(process.env.UPLOADS_DIR)) {
  errors.push("UPLOADS_DIR: must be an absolute legacy/local-assets path");
}
if (process.env.STRIPE_LIVE_PUBLISHABLE_KEY && !process.env.STRIPE_LIVE_PUBLISHABLE_KEY.startsWith("pk_live_")) {
  errors.push("STRIPE_LIVE_PUBLISHABLE_KEY: expected a live publishable-key format");
}

for (const pair of [
  ["AI_INTEGRATIONS_ANTHROPIC_API_KEY", "AI_INTEGRATIONS_ANTHROPIC_BASE_URL"],
  ["ARK_API_KEY", "ARK_BASE_URL"],
] as const) {
  if (Boolean(process.env[pair[0]]) !== Boolean(process.env[pair[1]])) {
    errors.push(`${pair[0]}/${pair[1]}: configure both names or neither`);
  }
}
if (process.env.ARK_API_KEY && !process.env.ARK_MODEL) errors.push("ARK_MODEL: required when ARK_API_KEY is configured");

if (errors.length) {
  console.error("Production preflight failed (values were not read out or printed):");
  errors.forEach((error) => console.error(`- ${error}`));
  process.exitCode = 1;
} else {
  console.log(`Production preflight passed: ${requiredNames.length} required configuration names and public URLs are valid.`);
  console.log("Secret values were not printed. Provider connectivity and database-held ECPay credentials require the staging drill.");
}