import crypto from "node:crypto";

const VERSION = 1;
const NONCE_BYTES = 12;
const WEBINAR_HASH_BYTES = 8;
const SIGNATURE_BYTES = 12;
const PAYLOAD_BYTES = 4 + 4 + NONCE_BYTES + WEBINAR_HASH_BYTES;
const KEY_BYTES = PAYLOAD_BYTES + SIGNATURE_BYTES;
export const LIVE_CTA_KEY_MAX_AGE_SECONDS = 2 * 60 * 60;

function webinarHash(webinarId: string): Buffer {
  return crypto.createHash("sha256").update(webinarId, "utf8").digest().subarray(0, WEBINAR_HASH_BYTES);
}

function signature(payload: Buffer, secret: string): Buffer {
  return crypto.createHmac("sha256", secret).update(payload).digest().subarray(0, SIGNATURE_BYTES);
}

/** A 54-character base64url token containing version, issue/expiry, nonce, webinar binding and HMAC. */
export function createLiveCtaKey(
  webinarId: string,
  secret: string,
  options: { now?: Date; expiresAt?: Date } = {},
): string {
  const nowSeconds = Math.floor((options.now?.getTime() ?? Date.now()) / 1000);
  const requestedExpiry = Math.floor((options.expiresAt?.getTime() ?? ((nowSeconds + LIVE_CTA_KEY_MAX_AGE_SECONDS) * 1000)) / 1000);
  const expiresAt = Math.max(nowSeconds + 1, Math.min(requestedExpiry, nowSeconds + LIVE_CTA_KEY_MAX_AGE_SECONDS));
  const payload = Buffer.alloc(PAYLOAD_BYTES);
  payload.writeUInt32BE(nowSeconds, 0);
  payload.writeUInt32BE(expiresAt, 4);
  crypto.randomBytes(NONCE_BYTES).copy(payload, 8);
  webinarHash(webinarId).copy(payload, 8 + NONCE_BYTES);
  return Buffer.concat([payload, signature(payload, secret)]).toString("base64url");
}

export function verifyLiveCtaKey(
  key: string,
  webinarId: string,
  secret: string,
  now = new Date(),
): boolean {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(key)) return false;
  let raw: Buffer;
  try {
    raw = Buffer.from(key, "base64url");
  } catch {
    return false;
  }
  if (raw.length !== KEY_BYTES) return false;
  // Reject alternate/non-canonical base64url encodings of the same bytes.
  if (raw.toString("base64url") !== key) return false;
  const payload = raw.subarray(0, PAYLOAD_BYTES);
  const provided = raw.subarray(PAYLOAD_BYTES);
  const expected = signature(payload, secret);
  if (!crypto.timingSafeEqual(provided, expected)) return false;
  const issuedAt = payload.readUInt32BE(0);
  const expiresAt = payload.readUInt32BE(4);
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (expiresAt <= issuedAt || expiresAt - issuedAt > LIVE_CTA_KEY_MAX_AGE_SECONDS) return false;
  if (issuedAt > nowSeconds + 5 * 60 || nowSeconds > expiresAt) return false;
  return crypto.timingSafeEqual(payload.subarray(8 + NONCE_BYTES), webinarHash(webinarId));
}