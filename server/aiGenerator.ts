import Anthropic from "@anthropic-ai/sdk";
import { storage } from "./storage";

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

const MODEL = "claude-sonnet-4-6";
const MAX_CONTEXT_CHARS = 24000;

// 從 AI 回覆中萃取 JSON（容忍 ```json 圍欄或前後雜訊）
function parseJson<T>(text: string): T | null {
  if (!text) return null;
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  // 取第一個 { 到最後一個 } 之間
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    t = t.slice(start, end + 1);
  }
  try {
    return JSON.parse(t) as T;
  } catch {
    return null;
  }
}

async function callJson(system: string, user: string, maxTokens = 4096): Promise<string> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  });
  const block = response.content[0];
  return block && block.type === "text" ? block.text : "";
}

function clampTime(sec: number, duration: number): number {
  if (!Number.isFinite(sec) || sec < 0) return 0;
  if (duration > 0 && sec > duration) return duration;
  return Math.round(sec);
}

export interface GeneratedWebinarPlan {
  title: string;
  description: string;
  teacherName: string;
  fallbackMessage: string;
  scarcity: {
    countdownEnabled: boolean;
    seatsEnabled: boolean;
    totalSeats: number;
    urgencyText: string;
  };
  thankYou: {
    enabled: boolean;
    headline: string;
    message: string;
    ctaText: string;
    ctaUrl: string;
  };
  replay: {
    headline: string;
    message: string;
    ctaText: string;
    ctaUrl: string;
  };
}

export async function generateWebinarPlan(input: {
  title: string;
  audience: string;
  goal: string;
  ctaText: string;
  ctaUrl: string;
  sourceContent: string;
}): Promise<GeneratedWebinarPlan | null> {
  try {
    const source = input.sourceContent.trim().slice(0, MAX_CONTEXT_CHARS);
    const system = [
      "你是台灣市場的 Webinar 策略與轉換文案專家。",
      "請建立可直接保存為草稿的結構化 Webinar 設定，不可捏造保證、數據或客戶見證。",
      `原始主題：${input.title}`,
      `目標受眾：${input.audience}`,
      `商業目標：${input.goal}`,
      `主要行動：${input.ctaText || "了解更多"}`,
      `行動網址：${input.ctaUrl || "#"}`,
      "description 請用 2-4 段繁體中文，清楚說明受眾、痛點、可學到的內容與行動價值。",
      "teacherName 請產生自然的 AI 助教名稱；fallbackMessage 要誠實表示會交由團隊回覆。",
      "只輸出 JSON，不要 markdown 或解說。",
      '{"title":"...","description":"...","teacherName":"...","fallbackMessage":"...","scarcity":{"countdownEnabled":true,"seatsEnabled":false,"totalSeats":100,"urgencyText":"..."},"thankYou":{"enabled":true,"headline":"...","message":"...","ctaText":"...","ctaUrl":"..."},"replay":{"headline":"...","message":"...","ctaText":"...","ctaUrl":"..."}}',
    ].join("\n");
    const raw = await callJson(
      system,
      source ? `以下是主辦方提供的參考資料：\n\n${source}` : "沒有額外參考資料，請僅依已提供資訊撰寫。",
      4096,
    );
    const parsed = parseJson<GeneratedWebinarPlan>(raw);
    if (!parsed || typeof parsed.title !== "string" || typeof parsed.description !== "string") return null;
    const ctaUrl = input.ctaUrl.trim() || "#";
    return {
      title: parsed.title.trim() || input.title.trim(),
      description: parsed.description.trim(),
      teacherName: typeof parsed.teacherName === "string" && parsed.teacherName.trim() ? parsed.teacherName.trim() : "AI 助教",
      fallbackMessage: typeof parsed.fallbackMessage === "string" ? parsed.fallbackMessage.trim() : "",
      scarcity: {
        countdownEnabled: parsed.scarcity?.countdownEnabled !== false,
        seatsEnabled: parsed.scarcity?.seatsEnabled === true,
        totalSeats: Number.isFinite(parsed.scarcity?.totalSeats) ? Math.max(1, Math.round(parsed.scarcity.totalSeats)) : 100,
        urgencyText: typeof parsed.scarcity?.urgencyText === "string" ? parsed.scarcity.urgencyText.trim() : "",
      },
      thankYou: {
        enabled: parsed.thankYou?.enabled !== false,
        headline: typeof parsed.thankYou?.headline === "string" ? parsed.thankYou.headline.trim() : "報名成功",
        message: typeof parsed.thankYou?.message === "string" ? parsed.thankYou.message.trim() : "",
        ctaText: input.ctaText.trim() || (typeof parsed.thankYou?.ctaText === "string" ? parsed.thankYou.ctaText.trim() : ""),
        ctaUrl,
      },
      replay: {
        headline: typeof parsed.replay?.headline === "string" ? parsed.replay.headline.trim() : "感謝觀看",
        message: typeof parsed.replay?.message === "string" ? parsed.replay.message.trim() : "",
        ctaText: input.ctaText.trim() || (typeof parsed.replay?.ctaText === "string" ? parsed.replay.ctaText.trim() : ""),
        ctaUrl,
      },
    };
  } catch (error) {
    console.error("generateWebinarPlan error:", error);
    return null;
  }
}

// ============ 1. 一鍵生成互動 ============

export interface GeneratedInteractions {
  fakeUsers: string[];
  messages: { name: string; message: string; triggerTime: number }[];
  polls: { question: string; options: string[]; triggerTime: number }[];
  tips: { title: string; content: string; triggerTime: number; icon: string }[];
  ctas: { text: string; url: string; startTime: number }[];
}

export async function generateInteractions(
  webinarTitle: string,
  transcript: string,
  durationSec: number,
  goal: string,
): Promise<GeneratedInteractions | null> {
  try {
    let context = (transcript || "").trim();
    if (context.length > MAX_CONTEXT_CHARS) context = context.slice(0, MAX_CONTEXT_CHARS);

    const durHint = durationSec > 0
      ? `影片總長度約 ${durationSec} 秒（${Math.round(durationSec / 60)} 分鐘）。所有 triggerTime / startTime 必須介於 0 到 ${durationSec} 之間。`
      : `若無法判斷影片長度，triggerTime 請以逐字稿時間軸（秒）為準。`;

    const system = [
      `你是線上研討會「模擬直播」的互動設計專家。根據逐字稿，自動生成讓直播間感覺真實、熱絡並促進銷售轉換的互動內容。`,
      `研討會主題：「${webinarTitle}」。`,
      goal && goal.trim() ? `主辦方目標 / 補充：${goal.trim()}` : ``,
      durHint,
      `請生成：`,
      `1. fakeUsers：8-12 個自然的觀眾暱稱（繁體中文為主，可少量英文名），像真實台灣觀眾。`,
      `2. messages：15-30 則假觀眾聊天訊息，分散在整段影片時間軸，name 必須出自 fakeUsers，內容口語、簡短、有溫度（含提問、附和、稱讚、分享心得），對應當下逐字稿內容。`,
      `3. polls：1-3 個投票，options 2-4 個，安排在合適的時間點。`,
      `4. tips：2-5 張提示卡（重點摘要 / 行動提醒），icon 從 info/tip/warning/agenda 擇一。`,
      `5. ctas：1-3 個行動呼籲按鈕，安排在銷售或引導報名的時機；url 若不確定請填 "#"。`,
      `只輸出 JSON，不要任何解說或 markdown。格式：`,
      `{"fakeUsers":["..."],"messages":[{"name":"...","message":"...","triggerTime":120}],"polls":[{"question":"...","options":["...","..."],"triggerTime":600}],"tips":[{"title":"...","content":"...","triggerTime":300,"icon":"tip"}],"ctas":[{"text":"...","url":"#","startTime":1500}]}`,
    ].filter(Boolean).join("\n");

    const userMsg = context
      ? `以下是研討會逐字稿（可能含時間軸）：\n\n${context}`
      : `（沒有逐字稿，請依研討會主題與目標合理推估時間軸生成互動內容。）`;

    const raw = await callJson(system, userMsg, 8192);
    const parsed = parseJson<GeneratedInteractions>(raw);
    if (!parsed) return null;

    const fakeUsers = Array.isArray(parsed.fakeUsers) ? parsed.fakeUsers.filter((n) => typeof n === "string" && n.trim()).map((n) => n.trim()) : [];
    const nameSet = new Set(fakeUsers);

    const messages = (Array.isArray(parsed.messages) ? parsed.messages : [])
      .filter((m) => m && typeof m.message === "string" && m.message.trim())
      .map((m) => ({
        name: nameSet.has(m.name) ? m.name : (fakeUsers[0] || "觀眾"),
        message: m.message.trim(),
        triggerTime: clampTime(m.triggerTime, durationSec),
      }));

    const polls = (Array.isArray(parsed.polls) ? parsed.polls : [])
      .filter((p) => p && typeof p.question === "string" && p.question.trim() && Array.isArray(p.options) && p.options.length >= 2)
      .map((p) => ({
        question: p.question.trim(),
        options: p.options.filter((o) => typeof o === "string" && o.trim()).map((o) => o.trim()),
        triggerTime: clampTime(p.triggerTime, durationSec),
      }));

    const tips = (Array.isArray(parsed.tips) ? parsed.tips : [])
      .filter((t) => t && typeof t.title === "string" && t.title.trim())
      .map((t) => ({
        title: t.title.trim(),
        content: typeof t.content === "string" ? t.content.trim() : "",
        triggerTime: clampTime(t.triggerTime, durationSec),
        icon: ["info", "tip", "warning", "agenda"].includes(t.icon) ? t.icon : "info",
      }));

    const ctas = (Array.isArray(parsed.ctas) ? parsed.ctas : [])
      .filter((c) => c && typeof c.text === "string" && c.text.trim())
      .map((c) => ({
        text: c.text.trim(),
        url: typeof c.url === "string" && c.url.trim() ? c.url.trim() : "#",
        startTime: clampTime(c.startTime, durationSec),
      }));

    return { fakeUsers, messages, polls, tips, ctas };
  } catch (error) {
    console.error("generateInteractions error:", error);
    return null;
  }
}

// ============ 2. 銷售追蹤電子報序列 ============

export interface GeneratedEmail {
  name: string;
  segment: string; // all, watched, not_watched, no_show
  delayMinutes: number;
  subject: string;
  htmlBody: string;
}

const VALID_SEGMENTS = ["all", "watched", "not_watched", "no_show"];

export async function generateEmailSequence(
  webinarTitle: string,
  goal: string,
  knowledge: string,
): Promise<GeneratedEmail[] | null> {
  try {
    let context = (knowledge || "").trim();
    if (context.length > MAX_CONTEXT_CHARS) context = context.slice(0, MAX_CONTEXT_CHARS);

    const system = [
      `你是 eWebinar 風格的銷售追蹤電子報文案專家。研討會結束後，要對不同觀眾分眾發送追蹤郵件，提升轉換。`,
      `研討會主題：「${webinarTitle}」。`,
      goal && goal.trim() ? `主辦方目標 / 銷售訴求：${goal.trim()}` : ``,
      `分眾 segment 只能是：all（全部）、watched（有看完大部分）、not_watched（有出席但沒看完）、no_show（報名沒出席）。`,
      `請生成 4-6 封郵件，至少涵蓋 watched、not_watched、no_show 三種分眾各一封，並可加 all 的通用感謝信。`,
      `delayMinutes 是研討會結束後幾分鐘寄出（例：感謝信 60、回放提醒 1440、限時優惠 2880、最後通知 4320）。`,
      `htmlBody 用簡潔 HTML（<p> <strong> <ul> <a> 等），可使用變數 {{name}} {{title}} {{url}}（{{url}} 是直播間/回放連結）。語氣親切專業、有銷售說服力但不誇大。繁體中文。`,
      `只輸出 JSON，不要解說或 markdown。格式：`,
      `{"emails":[{"name":"第1封-感謝","segment":"all","delayMinutes":60,"subject":"...","htmlBody":"<p>親愛的 {{name}}...</p>"}]}`,
    ].filter(Boolean).join("\n");

    const userMsg = context
      ? `研討會內容參考資料：\n\n${context}`
      : `（無額外資料，請依主題與目標撰寫。）`;

    const raw = await callJson(system, userMsg, 8192);
    const parsed = parseJson<{ emails: GeneratedEmail[] }>(raw);
    const emails = parsed?.emails;
    if (!Array.isArray(emails)) return null;

    return emails
      .filter((e) => e && typeof e.subject === "string" && e.subject.trim() && typeof e.htmlBody === "string" && e.htmlBody.trim())
      .map((e) => ({
        name: typeof e.name === "string" && e.name.trim() ? e.name.trim() : e.subject.trim(),
        segment: VALID_SEGMENTS.includes(e.segment) ? e.segment : "all",
        delayMinutes: Number.isFinite(e.delayMinutes) && e.delayMinutes >= 0 ? Math.round(e.delayMinutes) : 60,
        subject: e.subject.trim(),
        htmlBody: e.htmlBody.trim(),
      }));
  } catch (error) {
    console.error("generateEmailSequence error:", error);
    return null;
  }
}

// ============ 3. 排程社群貼文草稿 ============

export interface GeneratedPost {
  platform: string;
  content: string;
}

const VALID_PLATFORMS = ["facebook", "instagram", "linkedin", "x", "threads"];

export async function generateSocialPosts(
  webinarTitle: string,
  goal: string,
  knowledge: string,
): Promise<GeneratedPost[] | null> {
  try {
    let context = (knowledge || "").trim();
    if (context.length > MAX_CONTEXT_CHARS) context = context.slice(0, MAX_CONTEXT_CHARS);

    const system = [
      `你是社群行銷文案專家，為線上研討會撰寫宣傳貼文（用於招募報名與會後導流）。`,
      `研討會主題：「${webinarTitle}」。`,
      goal && goal.trim() ? `主辦方目標 / 訴求：${goal.trim()}` : ``,
      `平台 platform 只能是：facebook、instagram、linkedin、x、threads。`,
      `請針對不同平台生成 5-8 則貼文（涵蓋預告、開課提醒、會後回放導流等情境），符合各平台語氣與長度，包含適當 emoji 與 hashtag，並以「報名/觀看」行動呼籲收尾。繁體中文。`,
      `只輸出 JSON，不要解說或 markdown。格式：`,
      `{"posts":[{"platform":"facebook","content":"..."}]}`,
    ].filter(Boolean).join("\n");

    const userMsg = context
      ? `研討會內容參考資料：\n\n${context}`
      : `（無額外資料，請依主題與目標撰寫。）`;

    const raw = await callJson(system, userMsg, 6144);
    const parsed = parseJson<{ posts: GeneratedPost[] }>(raw);
    const posts = parsed?.posts;
    if (!Array.isArray(posts)) return null;

    return posts
      .filter((p) => p && typeof p.content === "string" && p.content.trim())
      .map((p) => ({
        platform: VALID_PLATFORMS.includes(p.platform) ? p.platform : "facebook",
        content: p.content.trim(),
      }));
  } catch (error) {
    console.error("generateSocialPosts error:", error);
    return null;
  }
}

// 取得研討會知識內容（逐字稿 / 文件）供 email & social 生成參考
export async function getWebinarKnowledge(webinarId: string): Promise<string> {
  const docs = await storage.getWebinarDocuments(webinarId);
  return docs.map((d) => `【${d.title}】\n${d.content}`).join("\n\n---\n\n");
}
