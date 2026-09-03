import { storage } from "./storage";
import { sendEmail } from "./gmail";
import type { Webinar, Registration, EmailSequence, EmailReminder } from "@shared/schema";
import { createWatchToken, watchTokenExpiry } from "./watchTokens";

function getEmailHtml(type: string, name: string, webinarTitle: string, startTime: Date, webinarUrl: string, timezone: string = "Asia/Taipei", customSubject?: string, customTemplate?: string, onDemand = false): { subject: string; html: string } {
  const formattedDate = startTime.toLocaleString('zh-TW', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: timezone
  });

  const baseStyle = `
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
      .container { max-width: 600px; margin: 0 auto; padding: 20px; }
      .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
      .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
      .button { display: inline-block; background: #667eea; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; margin: 20px 0; }
      .info { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
      .footer { text-align: center; color: #666; font-size: 14px; margin-top: 20px; }
    </style>`;

  if (customSubject && customTemplate) {
    const filledSubject = customSubject
      .replace(/\{\{name\}\}/g, name)
      .replace(/\{\{title\}\}/g, webinarTitle)
      .replace(/\{\{date\}\}/g, formattedDate);
    const filledTemplate = customTemplate
      .replace(/\{\{name\}\}/g, name)
      .replace(/\{\{title\}\}/g, webinarTitle)
      .replace(/\{\{date\}\}/g, formattedDate)
      .replace(/\{\{url\}\}/g, webinarUrl);
    return {
      subject: filledSubject,
      html: `<!DOCTYPE html><html><head><meta charset="utf-8">${baseStyle}</head><body>
        <div class="container">
          <div class="content">${filledTemplate}</div>
          <div class="footer"><p>此郵件由系統自動發送，請勿直接回覆。</p></div>
        </div></body></html>`
    };
  }

  switch (type) {
    case "confirmation":
      return {
        subject: `【報名成功】${webinarTitle}`,
        html: `<!DOCTYPE html><html><head><meta charset="utf-8">${baseStyle}</head><body>
          <div class="container">
            <div class="header"><h1>報名成功！</h1></div>
            <div class="content">
              <p>親愛的 ${name}，</p>
              <p>您已成功報名線上研討會！</p>
              <div class="info">
                <h3>${webinarTitle}</h3>
                 ${onDemand ? "<p><strong>觀看方式：</strong>立即隨選觀看</p>" : `<p><strong>直播時間：</strong>${formattedDate}</p>`}
              </div>
              <p>請記得準時參加：</p>
              <center><a href="${webinarUrl}" class="button">進入直播間</a></center>
            </div>
            <div class="footer"><p>此郵件由系統自動發送，請勿直接回覆。</p></div>
          </div></body></html>`
      };
    case "reminder_24h":
      return {
        subject: `【明天開播】${webinarTitle}`,
        html: `<!DOCTYPE html><html><head><meta charset="utf-8">${baseStyle}</head><body>
          <div class="container">
            <div class="header"><h1>明天就要開播了！</h1></div>
            <div class="content">
              <p>親愛的 ${name}，</p>
              <p>提醒您，您報名的線上研討會將在明天開始！</p>
              <div class="info">
                <h3>${webinarTitle}</h3>
                <p><strong>直播時間：</strong>${formattedDate}</p>
              </div>
              <p>請記得準時參加：</p>
              <center><a href="${webinarUrl}" class="button">進入直播間</a></center>
            </div>
            <div class="footer"><p>此郵件由系統自動發送，請勿直接回覆。</p></div>
          </div></body></html>`
      };
    case "reminder_1h":
      return {
        subject: `【即將開播】${webinarTitle} - 1小時後開始`,
        html: `<!DOCTYPE html><html><head><meta charset="utf-8">${baseStyle}</head><body>
          <div class="container">
            <div class="header"><h1>1 小時後開播！</h1></div>
            <div class="content">
              <p>親愛的 ${name}，</p>
              <p>您報名的線上研討會即將在 1 小時後開始！</p>
              <div class="info">
                <h3>${webinarTitle}</h3>
                <p><strong>直播時間：</strong>${formattedDate}</p>
              </div>
              <p>請準備好，點擊下方按鈕進入直播間：</p>
              <center><a href="${webinarUrl}" class="button">立即進入直播間</a></center>
            </div>
            <div class="footer"><p>此郵件由系統自動發送，請勿直接回覆。</p></div>
          </div></body></html>`
      };
    case "followup":
      return {
        subject: `【感謝參與】${webinarTitle}`,
        html: `<!DOCTYPE html><html><head><meta charset="utf-8">${baseStyle}</head><body>
          <div class="container">
            <div class="header"><h1>感謝您的參與！</h1></div>
            <div class="content">
              <p>親愛的 ${name}，</p>
              <p>感謝您參加我們的線上研討會「${webinarTitle}」！</p>
              <div class="info">
                <p>希望您在本次研討會中收穫滿滿。如果您有任何問題或建議，歡迎隨時與我們聯繫。</p>
              </div>
              <p>期待下次再見！</p>
            </div>
            <div class="footer"><p>此郵件由系統自動發送，請勿直接回覆。</p></div>
          </div></body></html>`
      };
    default:
      return { subject: "", html: "" };
  }
}

export async function createEmailRemindersForRegistration(
  registration: Registration,
  webinar: Webinar,
  baseUrl: string,
  watchToken?: string,
) {
  const emailSettings = (webinar.emailSettings as any) ?? { confirmationEnabled: true };

  const webinarUrl = `${baseUrl}/webinar/${webinar.id}?watchToken=${encodeURIComponent(
    watchToken ?? createWatchToken(registration.id, webinar.id, watchTokenExpiry(registration.selectedSession, webinar.replayAvailableHours ?? 48)),
  )}`;
  const startTime = registration.selectedSession ? new Date(registration.selectedSession) : null;
  const now = new Date();

  const remindersToCreate: Array<{
    type: string;
    scheduledFor: Date;
    enabled: boolean;
  }> = [];

  if (startTime && emailSettings.reminder24hEnabled) {
    const t = new Date(startTime.getTime() - 24 * 60 * 60 * 1000);
    if (t > now) {
      remindersToCreate.push({ type: "reminder_24h", scheduledFor: t, enabled: true });
    }
  }

  if (startTime && emailSettings.reminder1hEnabled) {
    const t = new Date(startTime.getTime() - 60 * 60 * 1000);
    if (t > now) {
      remindersToCreate.push({ type: "reminder_1h", scheduledFor: t, enabled: true });
    }
  }

  if (startTime && emailSettings.followUpEnabled) {
    const duration = webinar.videoDuration || 3600;
    const t = new Date(startTime.getTime() + duration * 1000 + 30 * 60 * 1000);
    remindersToCreate.push({ type: "followup", scheduledFor: t, enabled: true });
  }

  for (const reminder of remindersToCreate) {
    try {
      await storage.createEmailReminder({
        webinarId: webinar.id,
        registrationId: registration.id,
        reminderType: reminder.type,
        scheduledFor: reminder.scheduledFor,
        status: "pending",
      });
    } catch (err) {
      console.error(`Failed to create ${reminder.type} reminder:`, err);
    }
  }

  if (emailSettings.confirmationEnabled !== false) {
    try {
      const webinarUrl = `${baseUrl}/webinar/${webinar.id}?watchToken=${encodeURIComponent(
        createWatchToken(registration.id, webinar.id, watchTokenExpiry(registration.selectedSession, webinar.replayAvailableHours ?? 48)),
      )}`;
      const { subject, html } = getEmailHtml(
        "confirmation",
        registration.name,
        webinar.title,
        startTime ?? now,
        webinarUrl,
        webinar.timezone || "Asia/Taipei",
        emailSettings.customSubject,
        emailSettings.customTemplate,
        !startTime
      );
      if (subject && html) {
        await sendEmail({ to: registration.email, subject, htmlBody: html });
        console.log(`Sent confirmation email to ${registration.email}`);
      }
    } catch (err) {
      console.error(`Failed to send confirmation email:`, err);
    }
  }
}

function fillSequenceTemplate(seq: EmailSequence, name: string, webinarTitle: string, webinarUrl: string): { subject: string; html: string } {
  const baseStyle = `
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
      .container { max-width: 600px; margin: 0 auto; padding: 20px; }
      .content { background: #f9fafb; padding: 30px; border-radius: 10px; }
      .button { display: inline-block; background: #667eea; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; margin: 20px 0; }
      .footer { text-align: center; color: #666; font-size: 14px; margin-top: 20px; }
      a.button { color: #fff; }
    </style>`;
  const fill = (s: string) => (s || "")
    .replace(/\{\{name\}\}/g, name)
    .replace(/\{\{title\}\}/g, webinarTitle)
    .replace(/\{\{url\}\}/g, webinarUrl);
  return {
    subject: fill(seq.subject),
    html: `<!DOCTYPE html><html><head><meta charset="utf-8">${baseStyle}</head><body>
      <div class="container">
        <div class="content">${fill(seq.htmlBody)}</div>
        <div class="footer"><p>此郵件由系統自動發送，請勿直接回覆。</p></div>
      </div></body></html>`,
  };
}

export function registrationWebinarUrl(
  baseUrl: string,
  registration: Registration,
  webinar: Webinar,
): string {
  const token = createWatchToken(
    registration.id,
    webinar.id,
    watchTokenExpiry(registration.selectedSession, webinar.replayAvailableHours ?? 48),
  );
  return `${baseUrl}/webinar/${webinar.id}?watchToken=${encodeURIComponent(token)}`;
}

export function buildDeferredEmail(
  reminder: EmailReminder,
  registration: Registration,
  webinar: Webinar,
  baseUrl: string,
  sequence?: EmailSequence,
): { subject: string; html: string } {
  const webinarUrl = registrationWebinarUrl(baseUrl, registration, webinar);
  if (reminder.reminderType === "sequence") {
    if (!sequence) return { subject: "", html: "" };
    return fillSequenceTemplate(sequence, registration.name, webinar.title, webinarUrl);
  }
  const emailSettings = webinar.emailSettings as any;
  return getEmailHtml(
    reminder.reminderType,
    registration.name,
    webinar.title,
    registration.selectedSession ? new Date(registration.selectedSession) : new Date(),
    webinarUrl,
    webinar.timezone || "Asia/Taipei",
    emailSettings?.customSubject,
    emailSettings?.customTemplate,
  );
}

// 依觀看行為判斷觀眾屬於哪個分眾
function matchesSegment(segment: string, reg: Registration, durationSec: number): boolean {
  if (segment === "all") return true;
  const attended = !!reg.attended;
  if (segment === "no_show") return !attended;
  // watched / not_watched 只針對有出席者
  if (!attended) return false;
  const watched = reg.watchDuration || 0;
  const ratio = durationSec > 0 ? watched / durationSec : 0;
  const WATCHED_THRESHOLD = 0.7; // 看完 70% 以上算 watched
  if (segment === "watched") return ratio >= WATCHED_THRESHOLD;
  if (segment === "not_watched") return ratio < WATCHED_THRESHOLD;
  return false;
}

// 研討會結束後，為符合分眾的報名者排入追蹤序列郵件（idempotent）
async function enqueueSequenceEmails() {
  try {
    const now = new Date();
    const webinars = await storage.getAllWebinars();
    for (const webinar of webinars) {
      if (webinar.publishStatus !== "published") continue;
      const sequences = await storage.getEnabledEmailSequences(webinar.id);
      if (sequences.length === 0) continue;

      const registrations = await storage.getRegistrationsByWebinar(webinar.id);
      if (registrations.length === 0) continue;

      for (const seq of sequences) {
        for (const reg of registrations) {
          // On-demand registrations have no event end and must never be
          // swept into a time-based post-event sequence for the webinar's
          // unrelated default start time.
          if (!reg.selectedSession) continue;
          const duration = webinar.videoDuration || 3600;
          const endTime = new Date(new Date(reg.selectedSession).getTime() + duration * 1000);
          if (endTime > now) continue;
          const scheduledFor = new Date(endTime.getTime() + (seq.delayMinutes || 0) * 60 * 1000);
          if (!matchesSegment(seq.segment, reg, duration)) continue;
          const already = await storage.hasSequenceReminder(reg.id, seq.id);
          if (already) continue;
          try {
            await storage.createEmailReminder({
              webinarId: webinar.id,
              registrationId: reg.id,
              reminderType: "sequence",
              sequenceId: seq.id,
              scheduledFor,
              status: "pending",
            } as any);
          } catch (err) {
            console.error(`Failed to enqueue sequence ${seq.id} for reg ${reg.id}:`, err);
          }
        }
      }
    }
  } catch (err) {
    console.error("enqueueSequenceEmails error:", err);
  }
}

export function startEmailScheduler() {
  console.log("Email scheduler started - checking every 60 seconds");

  // 每 5 分鐘掃描已結束研討會，排入追蹤序列郵件
  enqueueSequenceEmails();
  setInterval(enqueueSequenceEmails, 5 * 60 * 1000);

  setInterval(async () => {
    try {
      const now = new Date();
      const pendingReminders = await storage.getPendingEmailReminders(now);

      if (pendingReminders.length === 0) return;

      console.log(`Processing ${pendingReminders.length} pending email reminders`);

      for (const reminder of pendingReminders) {
        try {
          const registration = await storage.getRegistration(reminder.registrationId);
          if (!registration) {
            await storage.updateEmailReminder(reminder.id, { status: "failed", errorMessage: "Registration not found" });
            continue;
          }

          const webinar = await storage.getWebinar(reminder.webinarId);
          if (!webinar) {
            await storage.updateEmailReminder(reminder.id, { status: "failed", errorMessage: "Webinar not found" });
            continue;
          }

          const baseUrl = process.env.REPLIT_DEV_DOMAIN
            ? `https://${process.env.REPLIT_DEV_DOMAIN}`
            : "http://localhost:5000";
          let subject = "";
          let html = "";
          if (reminder.reminderType === "sequence" && reminder.sequenceId) {
            const seq = await storage.getEmailSequence(reminder.sequenceId);
            if (!seq) {
              await storage.updateEmailReminder(reminder.id, { status: "failed", errorMessage: "Sequence not found" });
              continue;
            }
            const filled = buildDeferredEmail(reminder, registration, webinar, baseUrl, seq);
            subject = filled.subject;
            html = filled.html;
          } else {
            const built = buildDeferredEmail(reminder, registration, webinar, baseUrl);
            subject = built.subject;
            html = built.html;
          }

          if (subject && html) {
            await sendEmail({ to: registration.email, subject, htmlBody: html });
            await storage.updateEmailReminder(reminder.id, {
              status: "sent",
              sentAt: new Date(),
            });
            console.log(`Sent ${reminder.reminderType} email to ${registration.email}`);
          } else {
            await storage.updateEmailReminder(reminder.id, { status: "failed", errorMessage: "Unknown reminder type" });
          }
        } catch (err: any) {
          console.error(`Failed to send reminder ${reminder.id}:`, err);
          await storage.updateEmailReminder(reminder.id, {
            status: "failed",
            errorMessage: err.message || "Send failed",
          });
        }
      }
    } catch (err) {
      console.error("Email scheduler error:", err);
    }
  }, 60 * 1000);
}
