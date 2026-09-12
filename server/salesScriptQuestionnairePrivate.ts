import type {
  SalesScriptQuestionGroup,
  SalesScriptQuestionnaireAnswers,
  SalesScriptQuestionnaireField,
  SalesScriptQuestionId,
} from "@shared/salesScriptQuestionnaire";

const field = (id: SalesScriptQuestionId, label: string, required: boolean, help: string, example: string, multiline = false): SalesScriptQuestionnaireField =>
  ({ id, label, required, help, example, placeholder: example, multiline });

export const REQUIRED_SALES_SCRIPT_QUESTION_IDS = [
  "planName", "instructor", "audience", "painPoints", "modules", "pricing", "bonuses",
] as const satisfies readonly SalesScriptQuestionId[];

// This module is intentionally server-only. Do not import it from shared or
// browser code: all advanced wording and examples are confidential until paid.
export const SALES_SCRIPT_QUESTIONNAIRE_GROUPS: readonly SalesScriptQuestionGroup[] = [
  { id: "foundation", title: "課程與觀眾", description: "說清楚課程承諾、受眾與真實痛點。", fields: [
    field("planName", "課程／方案正式名稱", true, "請填正式名稱；副標可另填。", "示例：內容行銷實作班"),
    field("subtitle", "副標題", false, "一句話說明對象與方向。", "示例：給想穩定產出內容的工作者"),
    field("outcome", "學完後的具體成果", false, "描述可觀察成果，不保證收入。", "示例：完成一份可執行的 30 天計畫", true),
    field("timeframe", "成果預計時間／學習期間", false, "填課程時長或實際學習節奏。", "示例：四週、每週兩次"),
    field("audience", "目標受眾", true, "誰最適合參加，以及目前處於哪個階段。", "示例：已有服務但沒有穩定流程的個人工作者", true),
    field("painPoints", "核心痛點", true, "填觀眾真實困難與代價。", "示例：不知道如何整理成每週可執行主題", true),
  ]},
  { id: "story", title: "講師與公開資料", description: "只填可公開的真實資料。", fields: [
    field("instructor", "講師姓名與背景", true, "可公開的經歷、專業與目前角色。", "示例：王小明，產品設計師與課程講師", true),
    field("instructorInitialProblem", "講師最初遇到的問題", false, "只寫本人親身經歷。", "示例：花很多時間整理素材仍無法按時發布", true),
    field("instructorTurningPoint", "講師的轉折點", false, "說明實際如何找到或整理方法。", "示例：專案回顧後改用固定檢查表", true),
    field("instructorAuthority", "可核對的專業依據", false, "證照、作品或公開發表。", "示例：作品集或證照", true),
    field("instructorAchievements", "講師真實成就／成果", false, "只填可提供證據的成果。", "示例：完成專案並取得客戶公開推薦", true),
  ]},
  { id: "difference", title: "背景補充", description: "補充現況、服務內容與適用情境。", fields: [
    field("oldMethod", "目前做法或替代選項", false, "描述目前安排即可。", "例如：以零散筆記整理內容", true),
    field("solution", "本方案提供的協助", false, "簡述實際提供內容。", "例如：固定的規劃與回顧安排", true),
    field("methodDiscovery", "內容來源或整理背景", false, "可填研究、實作或編排背景。", "例如：依過往專案整理出的主題", true),
    field("methodValue", "參加者可使用的資源", false, "填可交付的工具或流程。", "例如：每週使用的檢查表", true),
    field("benefitsScenarios", "適用工作情境", false, "說明何時可使用。", "例如：每週規劃與整理時", true),
  ]},
  { id: "offer", title: "產品與課程內容", description: "把功能翻成負責任的學習價值。", fields: [
    field("productName", "產品／課程顯示名稱", false, "若與正式方案名不同再填。", "示例：內容流程工作坊"),
    field("productImageDescription", "產品圖片／畫面描述", false, "輸出是文字稿，不需要圖片 URL。", "示例：課程模組列表截圖", true),
    field("tagline", "產品一句話標語", false, "說明定位，不做成效保證。", "示例：把想法整理成可持續執行的流程"),
    field("modules", "商品包含什麼", true, "列出單元、服務或交付內容。", "例如：規劃、執行、回顧", true),
    field("modulesUniqueHelp", "模組的獨特協助", false, "填實際支援。", "示例：每模組附檢核表與一次作業回饋", true),
    field("educationWhyBuy", "為什麼需要這個教育／方案", false, "解釋價值，不製造不實恐懼。", "示例：明確順序與回饋能減少重複試錯", true),
    field("commonObjections", "常見疑慮", false, "填觀眾真實問過的問題。", "示例：沒有固定時間還能跟上嗎？", true),
  ]},
  { id: "pricing", title: "價格與方案", description: "只有真實價格才會進入稿件。", fields: [
    field("pricing", "定價策略", true, "填原價、優惠價、分期與限制。", "示例：原價、目前方案、付款方式", true),
    field("originalPrice", "原價", false, "只填確實使用過的原價。", "示例：NT$ 實際原價"),
    field("offerPrice", "本次方案價", false, "填目前真實收費。", "示例：NT$ 實際方案價"),
    field("discountReason", "真實折扣理由", false, "沒有折扣可填無折扣。", "示例：首次開課早鳥"),
    field("installments", "分期方式", false, "只填實際提供的期數與費用。", "示例：三期"),
    field("genuineLimits", "真實名額／服務限制", false, "沒有請填無。", "示例：小班回饋限額 20 人"),
    field("deadline", "實際截止時間", false, "沒有確定期限就留白。", "示例：2026/01/31 23:59"),
  ]},
  { id: "proof-and-safety", title: "贈品、證據與保障", description: "必須建立在真實資料上。", fields: [
    field("bonuses", "贈品總覽", true, "可填無贈品；有就列真實內容。", "示例：無贈品", true),
    field("bonusesCourse", "贈品：加值課程", false, "沒有就填無。", "示例：無", true),
    field("bonusesCoaching", "贈品：教練／回饋", false, "填實際次數、期限與範圍。", "示例：一次作業回饋", true),
    field("bonusesTemplates", "贈品：範本／工具", false, "只列確定交付的工具。", "示例：內容規劃範本", true),
    field("bonusesPartnerResources", "贈品：合作夥伴資源", false, "只填授權且能交付資源。", "示例：合作資源名稱", true),
    field("testimonials", "學員見證", false, "貼實際原文與可核對證據；沒有填無。", "示例：無", true),
    field("guaranteeTerms", "保證／退費條款", false, "只填實際確認條件。", "示例：無保證", true),
  ]},
  { id: "faq-and-action", title: "疑慮與報名", description: "準備真實問答與清楚下一步。", fields: [
    field("faqTime", "FAQ：時間", false, "回答實際學習時間與安排。", "示例：每週約兩小時", true),
    field("faqAbility", "FAQ：能力／程度", false, "說明先備知識與適合程度。", "示例：不需程式背景", true),
    field("faqEffect", "FAQ：效果", false, "提供合理成果與限制。", "示例：成果取決於投入與情境", true),
    field("faqMoney", "FAQ：費用／退款", false, "說明付款與退款條件。", "示例：退款依實際條款", true),
    field("signupSteps", "報名步驟", false, "列完成報名的每一步。", "示例：點報名、填資料、付款", true),
  ]},
];

export const salesScriptQuestionnaireFields = SALES_SCRIPT_QUESTIONNAIRE_GROUPS.flatMap((group) => group.fields);
export function missingSalesScriptQuestionIds(answers: SalesScriptQuestionnaireAnswers) {
  return REQUIRED_SALES_SCRIPT_QUESTION_IDS.filter((id) => !String(answers[id] ?? "").trim());
}