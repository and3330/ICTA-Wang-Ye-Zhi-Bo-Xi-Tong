import { EMAIL_PROVIDER_DEADLINE_MS } from "./emailDeliveryPolicy";

type MailInput = { to: string; subject: string; html: string; text?: string };

export async function sendTransactionalMail(input: MailInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM_ADDRESS;
  if (!apiKey || !from) throw new Error("Transactional email is not configured");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      ...(input.text ? { text: input.text } : {}),
    }),
    signal: AbortSignal.timeout(EMAIL_PROVIDER_DEADLINE_MS),
  });
  if (!response.ok) throw new Error(`Transactional email provider returned ${response.status}`);
}

export function emailVerificationMail(code: string): Pick<MailInput, "subject" | "html" | "text"> {
  const subject = "您的 SellCase 電子郵件驗證碼";
  const text = [
    "開賣啦 SellCase",
    "",
    "您的電子郵件驗證碼：",
    code,
    "",
    "驗證碼將在 10 分鐘後失效，且只能使用一次。",
    "如果您沒有註冊 SellCase，請忽略這封信。",
  ].join("\n");
  const html = `<!doctype html>
<html lang="zh-Hant">
  <body style="margin:0;padding:0;background:#f4f8f7;font-family:Arial,'Noto Sans TC',sans-serif;color:#173f48">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f8f7;padding:32px 12px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #dceae6;border-radius:16px">
          <tr><td style="padding:30px 32px 12px;font-size:20px;font-weight:700;color:#087f83">開賣啦 SellCase</td></tr>
          <tr><td style="padding:8px 32px 0;font-size:22px;font-weight:700">驗證您的電子郵件</td></tr>
          <tr><td style="padding:12px 32px 0;font-size:15px;line-height:1.7;color:#567078">請在註冊畫面輸入以下六位數驗證碼：</td></tr>
          <tr><td align="center" style="padding:24px 32px">
            <div style="display:inline-block;padding:16px 24px;border-radius:12px;background:#e8f6f3;color:#075d60;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:32px;font-weight:800;letter-spacing:8px">${code}</div>
          </td></tr>
          <tr><td style="padding:0 32px 28px;font-size:14px;line-height:1.7;color:#657d82">驗證碼將在 10 分鐘後失效，且只能使用一次。若您沒有註冊 SellCase，請直接忽略這封信。</td></tr>
          <tr><td style="padding:18px 32px;border-top:1px solid #e7efed;font-size:12px;color:#8a9c9f">一開講，就開賣。</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
  return { subject, html, text };
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