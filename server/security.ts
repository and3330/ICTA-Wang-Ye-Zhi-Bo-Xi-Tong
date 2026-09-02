import crypto from "node:crypto";

export function createRawToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

export function safeErrorText(value: unknown, maxLength = 1000): string {
  const text = value instanceof Error ? value.message : String(value ?? "Unknown error");
  return text
    .replace(/(bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/([?&](?:token|session_id|key|secret|password)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/(["']?(?:token|password|secret|api[_-]?key)["']?\s*[:=]\s*["'])[^"']+/gi, "$1[REDACTED]")
    .replace(/\b(?:sk|pk|re)_[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]")
    .slice(0, maxLength);
}