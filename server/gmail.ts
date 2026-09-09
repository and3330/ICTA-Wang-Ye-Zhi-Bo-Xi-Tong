// Legacy module name retained to avoid changing template and scheduler imports.
// All application email is delivered through Resend.
import { sendTransactionalMail } from "./mail";

interface SendEmailParams {
  to: string;
  subject: string;
  htmlBody: string;
}

export async function sendEmail({ to, subject, htmlBody }: SendEmailParams) {
  try {
    await sendTransactionalMail({ to, subject, html: htmlBody });
    console.log(`Email sent to ${to}`);
    return true;
  } catch (error) {
    console.error('Failed to send email:', error);
    throw error;
  }
}

export async function sendWebinarRegistrationEmail(
  email: string, 
  name: string, 
  webinarTitle: string, 
  startTime: Date,
  webinarUrl: string
) {
  const formattedDate = startTime.toLocaleString('zh-TW', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Taipei'
  });

  const htmlBody = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
        .button { display: inline-block; background: #667eea; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; margin: 20px 0; }
        .info { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .footer { text-align: center; color: #666; font-size: 14px; margin-top: 20px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>報名成功！</h1>
        </div>
        <div class="content">
          <p>親愛的 ${name}，</p>
          <p>感謝您報名參加我們的線上研討會！</p>
          
          <div class="info">
            <h3>📺 ${webinarTitle}</h3>
            <p><strong>直播時間：</strong>${formattedDate}</p>
          </div>
          
          <p>請在直播開始前點擊下方按鈕進入直播間：</p>
          
          <center>
            <a href="${webinarUrl}" class="button">進入直播間</a>
          </center>
          
          <p>如果您有任何問題，請隨時與我們聯繫。</p>
          <p>期待在直播中見到您！</p>
        </div>
        <div class="footer">
          <p>此郵件由系統自動發送，請勿直接回覆。</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: email,
    subject: `【報名確認】${webinarTitle}`,
    htmlBody
  });
}

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendQuestionNotificationEmail(
  to: string,
  webinarTitle: string,
  askerName: string,
  question: string,
  controlUrl: string,
) {
  const safeTitle = escapeHtml(webinarTitle);
  const safeAsker = escapeHtml(askerName);
  const safeQuestion = escapeHtml(question);
  const htmlBody = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 24px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9fafb; padding: 28px; border-radius: 0 0 10px 10px; }
        .q { background: white; padding: 18px; border-left: 4px solid #667eea; border-radius: 6px; margin: 18px 0; }
        .button { display: inline-block; background: #667eea; color: white; padding: 12px 26px; text-decoration: none; border-radius: 8px; margin: 14px 0; }
        .footer { text-align: center; color: #888; font-size: 13px; margin-top: 18px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header"><h2>有新觀眾提問 💬</h2></div>
        <div class="content">
          <p>研討會「<strong>${safeTitle}</strong>」有觀眾發問：</p>
          <div class="q">
            <p style="margin:0 0 6px;color:#666;">來自 ${safeAsker}</p>
            <p style="margin:0;font-size:16px;">${safeQuestion}</p>
          </div>
          <center><a href="${controlUrl}" class="button">前往控制台回覆</a></center>
        </div>
        <div class="footer"><p>此郵件由系統自動發送，請勿直接回覆。</p></div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to,
    subject: `【新提問】${webinarTitle}`,
    htmlBody,
  });
}
