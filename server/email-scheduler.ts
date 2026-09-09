import { storage } from "./storage";
import { sendEmail } from "./gmail";
import type { Webinar, Registration, EmailSequence, EmailReminder } from "@shared/schema";
import { createWatchToken, watchTokenExpiry } from "./watchTokens";
import crypto from "node:crypto";
import { appBaseUrl } from "./mail";
import { scoreLeadInsight } from "./leadInsights";
import {
  isAcceptingWork,
  registerStopper,
  schedulerAttempt,
  schedulerFailure,
  schedulerSuccess,
  trackOperation,
} from "./operationsRuntime";
import {
  EMAIL_CLAIM_BATCH_SIZE, EMAIL_MAX_BATCHES_PER_TICK, EMAIL_LEASE_MS,
} from "./emailDeliveryPolicy";
export {
  EMAIL_CLAIM_BATCH_SIZE, EMAIL_MAX_BATCHES_PER_TICK,
  EMAIL_PROVIDER_DEADLINE_MS, EMAIL_LEASE_MS,
} from "./emailDeliveryPolicy";

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
      // Confirmation uses the same durable leased queue as every deferred
      // message; request retries and scheduler replicas cannot double-send it.
      await storage.createEmailReminder({
        webinarId: webinar.id,
        registrationId: registration.id,
        reminderType: "confirmation",
        scheduledFor: now,
        status: "pending",
      });
    } catch (err) {
      console.error(`Failed to enqueue confirmation email:`, err);
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
    !registration.selectedSession,
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
  if (!isAcceptingWork()) return;
  schedulerAttempt("email_sequence_enqueue");
  try {
    for (let batch = 0; batch < 5 && isAcceptingWork(); batch += 1) {
      const inserted = await storage.enqueueDueSequenceReminders(new Date(), 1_000);
      if (inserted < 1_000) break;
    }
    schedulerSuccess("email_sequence_enqueue");
  } catch (err) {
    schedulerFailure("email_sequence_enqueue");
    console.error("enqueueSequenceEmails error:", err);
  }
}

export function startEmailScheduler(): { stop: () => Promise<void> } {
  console.log("Email scheduler started - checking every 60 seconds");
  const active = new Set<Promise<unknown>>();
  const run = (operation: () => Promise<void>) => {
    if (!isAcceptingWork()) return;
    const promise = trackOperation(operation());
    active.add(promise);
    void promise.finally(() => active.delete(promise)).catch(() => undefined);
  };

  // 每 5 分鐘掃描已結束研討會，排入追蹤序列郵件
  run(enqueueSequenceEmails);
  const sequenceTimer = setInterval(() => run(enqueueSequenceEmails), 5 * 60 * 1000);

  const deliveryTimer = setInterval(() => run(async () => {
    schedulerAttempt("email_delivery");
    try {
      // Drain multiple bounded batches per tick. Each batch sends concurrently,
      // so 25 provider calls bounded at 15s remain safely inside the 45s lease.
      for (let batch = 0; batch < EMAIL_MAX_BATCHES_PER_TICK; batch += 1) {
        if (!isAcceptingWork()) return;
        const leaseToken = crypto.randomBytes(18).toString("base64url");
        const pendingReminders = await storage.claimPendingEmailReminders(new Date(), leaseToken, EMAIL_CLAIM_BATCH_SIZE);
        if (pendingReminders.length === 0) {
          schedulerSuccess("email_delivery");
          return;
        }
        console.log(`Processing ${pendingReminders.length} pending email reminders`);

        await Promise.all(pendingReminders.map(async (reminder) => {
        const finish = (data: Partial<EmailReminder>) =>
          storage.updateClaimedEmailReminder(reminder.id, leaseToken, data);
        try {
          const registration = await storage.getRegistration(reminder.registrationId);
          if (!registration) {
            await finish({ status: "failed", errorMessage: "Registration not found", leaseToken: null, leaseExpiresAt: null });
            return;
          }

          const webinar = await storage.getWebinar(reminder.webinarId);
          if (!webinar) {
            await finish({ status: "failed", errorMessage: "Webinar not found", leaseToken: null, leaseExpiresAt: null });
            return;
          }
          if (webinar.publishStatus !== "published") {
            await finish({ status: "failed", errorMessage: "Webinar is not published", leaseToken: null, leaseExpiresAt: null });
            return;
          }

          const baseUrl = appBaseUrl();
          let subject = "";
          let html = "";
          if (reminder.reminderType === "sequence" && reminder.sequenceId) {
            const seq = await storage.getEmailSequence(reminder.sequenceId);
            if (!seq || !seq.enabled || seq.webinarId !== webinar.id) {
              await finish({ status: "failed", errorMessage: "Sequence not found", leaseToken: null, leaseExpiresAt: null });
              return;
            }
            const events = await storage.getFunnelEventsByRegistration(webinar.id, registration.id);
            if (scoreLeadInsight(registration, events, webinar.videoDuration || 0).suppressSalesFollowUp) {
              await finish({ status: "failed", errorMessage: "Suppressed after refund", leaseToken: null, leaseExpiresAt: null });
              return;
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
            const renewed = await storage.renewClaimedEmailReminder(
              reminder.id,
              leaseToken,
              new Date(Date.now() + EMAIL_LEASE_MS),
            );
            if (!renewed) return;
            await sendEmail({ to: registration.email, subject, htmlBody: html });
            await finish({
              status: "sent",
              sentAt: new Date(),
              leaseToken: null,
              leaseExpiresAt: null,
            });
            console.log(`Sent ${reminder.reminderType} email to ${registration.email}`);
          } else {
            await finish({ status: "failed", errorMessage: "Unknown reminder type", leaseToken: null, leaseExpiresAt: null });
          }
        } catch (err: any) {
          console.error(`Failed to send reminder ${reminder.id}:`, err);
          await finish({
            status: (reminder.attemptCount || 0) >= 5 ? "failed" : "pending",
            scheduledFor: new Date(Date.now() + Math.min(60, 2 ** (reminder.attemptCount || 1)) * 60_000),
            errorMessage: err.message || "Send failed",
            leaseToken: null,
            leaseExpiresAt: null,
          });
        }
        }));
        if (pendingReminders.length < EMAIL_CLAIM_BATCH_SIZE) {
          schedulerSuccess("email_delivery");
          return;
        }
      }
      schedulerSuccess("email_delivery");
    } catch (err) {
      schedulerFailure("email_delivery");
      console.error("Email scheduler error:", err);
    }
  }), 60 * 1000);
  const stop = async () => {
    clearInterval(sequenceTimer);
    clearInterval(deliveryTimer);
    await Promise.allSettled(Array.from(active));
  };
  registerStopper(stop);
  return { stop };
}
