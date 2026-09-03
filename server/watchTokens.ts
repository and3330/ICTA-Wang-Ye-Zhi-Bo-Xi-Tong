import crypto from "node:crypto";

type WatchPayload = { v: 1; registrationId: string; webinarId: string; exp: number };
type JitPayload = { v: 1; webinarId: string; scheduledStart: number; exp: number };

function secret(): string {
  if (!process.env.SESSION_SECRET) throw new Error("Watch tokens are not configured");
  return process.env.SESSION_SECRET;
}

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sign(encoded: string): string {
  return crypto.createHmac("sha256", secret()).update(encoded).digest("base64url");
}

function verify<T extends { v: 1; exp: number }>(token: unknown): T | null {
  if (typeof token !== "string") return null;
  const [encoded, signature, ...extra] = token.split(".");
  if (!encoded || !signature || extra.length || !/^[A-Za-z0-9_-]+$/.test(encoded) || !/^[A-Za-z0-9_-]+$/.test(signature)) return null;
  let expected: Buffer;
  let supplied: Buffer;
  try {
    expected = Buffer.from(sign(encoded), "base64url");
    supplied = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as T;
    return payload.v === 1 && Number.isSafeInteger(payload.exp) && payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

export function watchTokenExpiry(selectedSession: Date | null | undefined, replayHours = 48): number {
  const normal = Date.now() + 30 * 24 * 60 * 60 * 1000;
  if (!selectedSession) return normal;
  // Keep the token usable through the chosen event, replay window, and an
  // additional week for mail delivery or delayed viewing.
  return Math.max(normal, selectedSession.getTime() + Math.max(0, replayHours) * 60 * 60 * 1000 + 7 * 24 * 60 * 60 * 1000);
}

export function createWatchToken(registrationId: string, webinarId: string, expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000): string {
  const payload: WatchPayload = { v: 1, registrationId, webinarId, exp: expiresAt };
  const encoded = encode(payload);
  return `${encoded}.${sign(encoded)}`;
}

export function verifyWatchToken(token: unknown): WatchPayload | null {
  const payload = verify<WatchPayload>(token);
  return payload && typeof payload.registrationId === "string" && typeof payload.webinarId === "string" ? payload : null;
}

export function verifyWatchTokenFor(token: unknown, registrationId: string, webinarId: string): WatchPayload | null {
  const payload = verifyWatchToken(token);
  return payload?.registrationId === registrationId && payload.webinarId === webinarId ? payload : null;
}

export function createJitSelectionToken(webinarId: string, scheduledStart: Date, submissionGraceMs = 15 * 60 * 1000): string {
  const payload: JitPayload = { v: 1, webinarId, scheduledStart: scheduledStart.getTime(), exp: scheduledStart.getTime() + submissionGraceMs };
  const encoded = encode(payload);
  return `${encoded}.${sign(encoded)}`;
}

export function verifyJitSelectionToken(token: unknown, webinarId: string): Date | null {
  const payload = verify<JitPayload>(token);
  if (!payload || payload.webinarId !== webinarId || !Number.isSafeInteger(payload.scheduledStart)) return null;
  const date = new Date(payload.scheduledStart);
  return date.getTime() > Date.now() ? date : null;
}