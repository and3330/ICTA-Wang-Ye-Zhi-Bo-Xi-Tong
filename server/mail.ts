import { EMAIL_PROVIDER_DEADLINE_MS } from "./emailDeliveryPolicy";

type MailInput = { to: string; subject: string; html: string };

export async function sendTransactionalMail(input: MailInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM_ADDRESS;
  if (!apiKey || !from) throw new Error("Transactional email is not configured");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [input.to], subject: input.subject, html: input.html }),
    signal: AbortSignal.timeout(EMAIL_PROVIDER_DEADLINE_MS),
  });
  if (!response.ok) throw new Error(`Transactional email provider returned ${response.status}`);
}

export function appBaseUrl(): string {
  const configured = process.env.APP_BASE_URL;
  if (configured) return configured.replace(/\/+$/, "");
  if (process.env.NODE_ENV === "production") {
    throw new Error("APP_BASE_URL is not configured");
  }
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
  if (!domain) throw new Error("APP_BASE_URL is not configured");
  return `https://${domain}`;
}