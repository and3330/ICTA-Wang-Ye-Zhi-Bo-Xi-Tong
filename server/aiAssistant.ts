import Anthropic from "@anthropic-ai/sdk";
import { storage } from "./storage";

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

const MAX_CONTEXT_CHARS = 24000;

// 判斷一則訊息是否「看起來像問題」，避免對招呼語等浪費 API 呼叫
export function looksLikeQuestion(text: string): boolean {
  const t = (text || "").trim();
  if (t.length < 3) return false;

  // 問號（中英文）
  if (/[?？]/.test(t)) return true;

  // 中文疑問詞
  const zhCues = [
    "嗎", "呢", "怎麼", "怎樣", "如何", "為什麼", "為何", "什麼", "甚麼",
    "哪", "多少", "可以", "能不能", "是否", "要不要", "請問", "有沒有",
    "幾", "何時", "什麼時候", "教我", "怎办", "怎辦",
  ];
  if (zhCues.some((c) => t.includes(c))) return true;

  // 英文疑問詞 / 句首
  if (/\b(how|what|why|when|where|who|which|can|could|should|do|does|is|are|will|would)\b/i.test(t)) {
    return true;
  }

  return false;
}

// 用文檔內容回答觀眾問題，以老師名義
const NO_ANSWER_TOKEN = "[[NO_ANSWER]]";

export async function answerViewerQuestion(
  webinarId: string,
  webinarTitle: string,
  teacherName: string,
  question: string,
  fallbackMessage?: string,
  knowledgeOnly = false,
): Promise<string | null> {
  try {
    const docs = await storage.getWebinarDocuments(webinarId);

    let knowledge = docs
      .map((d) => `【${d.title}】\n${d.content}`)
      .join("\n\n---\n\n");

    if (knowledge.length > MAX_CONTEXT_CHARS) {
      knowledge = knowledge.slice(0, MAX_CONTEXT_CHARS);
    }

    const hasKnowledge = knowledge.trim().length > 0;

    const systemPrompt = [
      `你是「${teacherName}」，正在主持線上研討會「${webinarTitle}」，要即時回覆觀眾在聊天室提出的問題。`,
      `請完全以「${teacherName}」本人的口吻、用第一人稱回覆，語氣親切、專業、自然，像真人在直播中互動。`,
      `回覆要精簡（盡量 2-4 句、120 字內），直接給答案，不要冗長開場白。`,
      `使用與觀眾相同的語言回覆（觀眾用繁體中文就用繁體中文）。`,
      hasKnowledge
        ? knowledgeOnly
          ? `以下是本研討會唯一可使用的知識來源。只能根據這些內容回答，不可使用外部知識、常識或自行推測：\n\n${knowledge}`
          : `以下是本研討會的相關資料，請優先根據這些資料回答：\n\n${knowledge}`
        : `目前沒有提供額外資料，請依你的專業常識友善回答；若超出研討會主題範圍，可禮貌引導觀眾稍後私訊或聯繫主辦團隊。`,
      fallbackMessage && fallbackMessage.trim()
        ? `若你無法根據以上資料或專業常識確定答案，請「只」輸出這個標記：${NO_ANSWER_TOKEN}（不要加任何其他文字）。`
        : knowledgeOnly
          ? `若知識來源中找不到答案，不要編造，請直接說明目前提供的內容不足以回答這個問題。`
          : `若資料中找不到答案，不要編造，誠實說明你會請團隊後續補充，或建議觀眾留下聯絡方式。`,
      `絕對不要提到「資料」「文檔」「AI」「系統提示」這類字眼，要表現得像老師本人在回答。`,
    ].join("\n\n");

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: question }],
    });

    const block = response.content[0];
    const text = block && block.type === "text" ? block.text.trim() : "";
    if (!text) return null;

    // AI 判定答不出來 → 用自訂回覆
    if (text.includes(NO_ANSWER_TOKEN)) {
      return (fallbackMessage && fallbackMessage.trim()) || null;
    }
    return text;
  } catch (error) {
    console.error("AI answer error:", error);
    return null;
  }
}
