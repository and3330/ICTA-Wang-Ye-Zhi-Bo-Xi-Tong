import crypto from "node:crypto";

const VERSION = "v1";
const CONTEXT = "livecast/ecpay-credentials/aes-256-gcm/v1";

function encryptionKey(secret = process.env.SESSION_SECRET): Buffer {
  if (!secret) throw new Error("SESSION_SECRET is required");
  return Buffer.from(crypto.hkdfSync("sha256", Buffer.from(secret), Buffer.from("livecast-ecpay-v1"), Buffer.from(CONTEXT), 32));
}

export function encryptEcpayCredential(value: string, secret?: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  cipher.setAAD(Buffer.from(CONTEXT));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptEcpayCredential(value: string, secret?: string): string {
  const [version, iv, tag, ciphertext] = value.split(".");
  if (version !== VERSION || !iv || !tag || !ciphertext) throw new Error("Unsupported encrypted credential");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(secret), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(CONTEXT));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

export type EcpayFields = Record<string, string | number>;

export function ecpayUrlEncode(value: string): string {
  // Start from a PHP urlencode-compatible representation. encodeURIComponent
  // deliberately leaves several RFC3986 punctuation characters untouched, so
  // encode them before applying ECPay's documented .NET compatibility table.
  const phpEncoded = encodeURIComponent(value)
    .replace(/%20/g, "+")
    .replace(/-/g, "%2D")
    .replace(/_/g, "%5F")
    .replace(/\./g, "%2E")
    .replace(/!/g, "%21")
    .replace(/'/g, "%27")
    .replace(/\*/g, "%2A")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/~/g, "%7E")
    .toLowerCase();
  return phpEncoded
    .replace(/%2d/g, "-")
    .replace(/%5f/g, "_")
    .replace(/%2e/g, ".")
    .replace(/%21/g, "!")
    .replace(/%2a/g, "*")
    .replace(/%28/g, "(")
    .replace(/%29/g, ")");
}

export function createCheckMacValue(fields: EcpayFields, hashKey: string, hashIv: string): string {
  const pairs = Object.entries(fields)
    .filter(([key, value]) => key.toLowerCase() !== "checkmacvalue" && value !== undefined && value !== null)
    .sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join("&");
  return crypto.createHash("sha256")
    .update(ecpayUrlEncode(`HashKey=${hashKey}&${pairs}&HashIV=${hashIv}`))
    .digest("hex")
    .toUpperCase();
}

export function verifyCheckMacValue(fields: EcpayFields, hashKey: string, hashIv: string): boolean {
  const supplied = String(fields.CheckMacValue ?? fields.checkmacvalue ?? "").toUpperCase();
  const expected = createCheckMacValue(fields, hashKey, hashIv);
  if (!/^[A-F0-9]{64}$/.test(supplied)) return false;
  return crypto.timingSafeEqual(Buffer.from(supplied, "ascii"), Buffer.from(expected, "ascii"));
}

export const ecpayActionUrl = (environment: "stage" | "production") =>
  environment === "production"
    ? "https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5"
    : "https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5";

export function merchantTradeNo(): string {
  return `LC${Date.now().toString(36)}${crypto.randomBytes(4).toString("hex")}`.slice(0, 20);
}

/** ECPay requires Taiwan civil time, including a zero-padded 24-hour clock. */
export function merchantTradeDate(date = new Date()): string {
  const taipei = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const two = (value: number) => String(value).padStart(2, "0");
  return `${taipei.getUTCFullYear()}/${two(taipei.getUTCMonth() + 1)}/${two(taipei.getUTCDate())} ${two(taipei.getUTCHours())}:${two(taipei.getUTCMinutes())}:${two(taipei.getUTCSeconds())}`;
}

export function validateEcpayCallback(
  fields: Record<string, string>,
  expected: { merchantId: string; merchantTradeNo: string; amount: number; hashKey: string; hashIv: string; allowSimulated?: boolean },
): boolean {
  return validateEcpayCallbackIntegrity(fields, expected)
    && fields.RtnCode === "1"
    && (expected.allowSimulated === true || fields.SimulatePaid !== "1");
}

/** Authenticates callback attribution independently from its payment outcome. */
export function validateEcpayCallbackIntegrity(
  fields: Record<string, string>,
  expected: { merchantId: string; merchantTradeNo: string; amount: number; hashKey: string; hashIv: string },
): boolean {
  return fields.MerchantID === expected.merchantId
    && fields.MerchantTradeNo === expected.merchantTradeNo
    && /^\d+$/.test(fields.TradeAmt || "")
    && Number(fields.TradeAmt) === expected.amount
    && verifyCheckMacValue(fields, expected.hashKey, expected.hashIv);
}