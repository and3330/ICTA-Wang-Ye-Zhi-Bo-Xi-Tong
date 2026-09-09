import dns from "node:dns/promises";
import net from "node:net";
import https from "node:https";
import type { LookupFunction } from "node:net";
import type { LookupAddress } from "node:dns";

export const WEBHOOK_DELIVERY_DEADLINE_MS = 20_000;
export const WEBHOOK_LEASE_MS = 45_000;

function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const parts = address.split(".").map(Number);
    return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
      parts[0] >= 224;
  }
  const normalized = address.toLowerCase();
  return normalized === "::1" || normalized === "::" || normalized.startsWith("fc") ||
    normalized.startsWith("fd") || normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") || normalized.startsWith("fea") ||
    normalized.startsWith("feb") || normalized.startsWith("::ffff:");
}

type PinnedDestination = { url: URL; address: string; family: 4 | 6 };

export function pinnedLookup(address: string, family: 4 | 6): LookupFunction {
  return ((_hostname: string, options: { all?: boolean } | number, callback: Function) => {
    if (typeof options === "object" && options?.all) {
      callback(null, [{ address, family } satisfies LookupAddress]);
      return;
    }
    callback(null, address, family);
  }) as LookupFunction;
}

async function resolveSafeWebhookUrl(value: string): Promise<PinnedDestination> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Webhook URL must be a valid absolute HTTPS URL");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw new Error("Webhook URL must use HTTPS without credentials or a custom port");
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("Webhook URL cannot target a private host");
  }
  const addresses = net.isIP(hostname)
    ? [{ address: hostname }]
    : await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("Webhook URL cannot target a private network");
  }
  const pinned = addresses[0];
  return { url, address: pinned.address, family: net.isIPv6(pinned.address) ? 6 : 4 };
}

export async function assertSafeWebhookUrl(value: string): Promise<URL> {
  return (await resolveSafeWebhookUrl(value)).url;
}

function postPinned(
  destination: PinnedDestination,
  init: { headers: Record<string, string>; body: string },
  deadlineAt: number,
): Promise<{ status: number; location?: string }> {
  return new Promise((resolve, reject) => {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) return reject(new Error("Webhook delivery deadline exceeded"));
    let absoluteTimer: NodeJS.Timeout;
    const request = https.request(destination.url, {
      method: "POST",
      headers: {
        ...init.headers,
        Host: destination.url.host,
        "Content-Length": Buffer.byteLength(init.body),
      },
      servername: destination.url.hostname.replace(/^\[|\]$/g, ""),
      lookup: pinnedLookup(destination.address, destination.family) as any,
    }, response => {
      clearTimeout(absoluteTimer);
      // Delivery success depends on response headers/status only. Never let an
      // unbounded response body hold a delivery lease.
      resolve({
        status: response.statusCode || 0,
        location: typeof response.headers.location === "string" ? response.headers.location : undefined,
      });
      response.destroy();
    });
    absoluteTimer = setTimeout(
      () => request.destroy(new Error("Webhook delivery deadline exceeded")),
      Math.min(10_000, remaining),
    );
    request.once("error", (error) => {
      clearTimeout(absoluteTimer);
      reject(error);
    });
    request.end(init.body);
  });
}

export async function deliverWebhook(
  target: string,
  init: { headers: Record<string, string>; body: string },
  maxRedirects = 3,
): Promise<void> {
  const deadlineAt = Date.now() + WEBHOOK_DELIVERY_DEADLINE_MS;
  const work = async () => {
    let destination = await resolveSafeWebhookUrl(target);
    for (let redirect = 0; redirect <= maxRedirects; redirect++) {
      if (Date.now() >= deadlineAt) throw new Error("Webhook delivery deadline exceeded");
      const response = await postPinned(destination, init, deadlineAt);
      if (response.status >= 300 && response.status < 400) {
        const location = response.location;
        if (!location || redirect === maxRedirects) throw new Error("Unsafe or excessive webhook redirect");
        destination = await resolveSafeWebhookUrl(new URL(location, destination.url).toString());
        continue;
      }
      if (response.status < 200 || response.status >= 300) throw new Error(`Webhook endpoint returned ${response.status}`);
      return;
    }
  };
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Webhook delivery deadline exceeded")), WEBHOOK_DELIVERY_DEADLINE_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}