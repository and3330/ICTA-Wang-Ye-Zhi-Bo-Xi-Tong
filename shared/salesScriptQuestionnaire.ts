/**
 * Stable questionnaire ids shared by the browser and the sales-script worker.
 * Labels and examples can change without invalidating a saved draft.
 */
export type SalesScriptQuestionId =
  | "planName"
  | "instructor"
  | "audience"
  | "painPoints"
  | "modules"
  | "pricing"
  | "bonuses"
  | "subtitle"
  | "outcome"
  | "timeframe"
  | "oldMethod"
  | "solution"
  | "instructorInitialProblem"
  | "instructorTurningPoint"
  | "instructorAuthority"
  | "instructorAchievements"
  | "methodDiscovery"
  | "methodValue"
  | "benefitsScenarios"
  | "productName"
  | "productImageDescription"
  | "tagline"
  | "modulesUniqueHelp"
  | "educationWhyBuy"
  | "commonObjections"
  | "bonusesCourse"
  | "bonusesCoaching"
  | "bonusesTemplates"
  | "bonusesPartnerResources"
  | "originalPrice"
  | "offerPrice"
  | "discountReason"
  | "installments"
  | "genuineLimits"
  | "deadline"
  | "testimonials"
  | "guaranteeTerms"
  | "faqTime"
  | "faqAbility"
  | "faqEffect"
  | "faqMoney"
  | "signupSteps";

export type SalesScriptQuestionnaireAnswers = Partial<
  Record<SalesScriptQuestionId, string>
>;

export type SalesScriptQuestionnaireField = {
  id: SalesScriptQuestionId;
  label: string;
  required: boolean;
  /** Help text shown above the control; examples are never default values. */
  help: string;
  example: string;
  /** Kept for older clients and simple form renderers. */
  placeholder: string;
  multiline?: boolean;
};

export type SalesScriptQuestionGroup = {
  id: string;
  title: string;
  description: string;
  fields: readonly SalesScriptQuestionnaireField[];
};

export const REQUIRED_SALES_SCRIPT_QUESTION_IDS = [
  "planName",
  "instructor",
  "audience",
  "painPoints",
  "modules",
  "pricing",
  "bonuses",
] as const satisfies readonly SalesScriptQuestionId[];

const field = (
  id: SalesScriptQuestionId,
  label: string,
  required: boolean,
  help: string,
  example: string,
  multiline = false,
): SalesScriptQuestionnaireField => ({
  id,
  label,
  required,
  help,
  example,
  placeholder: example,
  multiline,
});

/**
 * Seven required ids are exact. Everything else is optional context. A
 * required bonuses answer may be "無贈品"; the generator must not invent one.
 */
export const SALES_SCRIPT_QUESTIONNAIRE_GROUPS: readonly SalesScriptQuestionGroup[] = [
  {
    id: "foundation",
    title: "課程與觀眾",
    description: "說清楚課程承諾、受眾與真實痛點。",
    fields: [
      field("planName", "課程／方案正式名稱", true, "請填正式名稱；副標可另填。", "示例：內容行銷實作班（僅示意，不會自動填入）"),
      field("subtitle", "副標題", false, "一句話說明對象與方向。", "示例：給想穩定產出內容的工作者（僅示意）"),
      field("outcome", "學完後的具體成果", false, "描述可觀察成果，不保證收入。", "示例：完成一份可執行的 30 天計畫（僅示意）", true),
      field("timeframe", "成果預計時間／學習期間", false, "填課程時長或實際學習節奏。", "示例：四週、每週兩次（僅示意）"),
      field("audience", "目標受眾", true, "誰最適合參加，以及目前處於哪個階段。", "示例：已有服務但沒有穩定流程的個人工作者（僅示意）", true),
      field("painPoints", "核心痛點", true, "填觀眾真實困難與代價，不要替觀眾捏造經歷。", "示例：不知道如何把想法整理成每週可執行的主題（僅示意）", true),
    ],
  },
  {
    id: "story",
    title: "故事與可信度",
    description: "只使用講師真實且可核對的背景。",
    fields: [
      field("instructor", "講師姓名與背景", true, "可公開的經歷、專業與目前角色。", "示例：王小明，產品設計師與課程講師（僅示意）", true),
      field("instructorInitialProblem", "講師最初遇到的問題", false, "只寫本人親身經歷。", "示例：我曾花很多時間整理素材仍無法按時發布（僅示意）", true),
      field("instructorTurningPoint", "講師的轉折點", false, "說明實際如何找到或整理方法。", "示例：在一次專案回顧後改用固定檢查表（僅示意）", true),
      field("instructorAuthority", "可核對的專業依據", false, "證照、作品、公開發表或其他來源；沒有就留白。", "示例：作品集、公開課程連結或證照（僅示意）", true),
      field("instructorAchievements", "講師真實成就／成果", false, "只填真實且可提供證據的成果。", "示例：完成某專案並取得客戶公開推薦（僅示意）", true),
    ],
  },
  {
    id: "difference",
    title: "方法與差異",
    description: "交代舊方法、你的解法與實際價值。",
    fields: [
      field("oldMethod", "舊方法／替代方案的限制", false, "描述方法限制，不捏造競爭者資料。", "示例：只在有靈感時發文，導致節奏中斷（僅示意）", true),
      field("solution", "你的解決方法", false, "你實際教什麼、解決哪個阻礙。", "示例：用可重複的主題到成品流程降低開始門檻（僅示意）", true),
      field("methodDiscovery", "方法如何被發現／整理", false, "寫真實的研究、實作或迭代過程。", "示例：整理多次專案回顧後歸納三個步驟（僅示意）", true),
      field("methodValue", "方法帶來的價值", false, "描述省時、降低風險或變容易的事。", "示例：讓每次規劃都從同一張表開始（僅示意）", true),
      field("benefitsScenarios", "利益與使用情境", false, "何時使用、能得到什麼實際幫助。", "示例：每週規劃與檢查成效時使用（僅示意）", true),
    ],
  },
  {
    id: "offer",
    title: "產品與課程內容",
    description: "把功能翻成負責任的學習價值。",
    fields: [
      field("productName", "產品／課程顯示名稱", false, "若與正式方案名不同再填寫。", "示例：內容流程工作坊（僅示意）"),
      field("productImageDescription", "產品圖片／畫面描述", false, "輸出是文字稿，不需要圖片 URL。", "示例：展示課程平台的模組列表截圖（僅示意）", true),
      field("tagline", "產品一句話標語", false, "說明產品定位，不做成效保證。", "示例：把想法整理成可持續執行的流程（僅示意）"),
      field("modules", "課程模組與教學內容", true, "逐一列模組、教什麼與學會後能做什麼。", "示例：模組一｜主題規劃：建立一週內容清單（僅示意）", true),
      field("modulesUniqueHelp", "模組的獨特協助", false, "填範本、回饋、社群等實際支援。", "示例：每模組附檢核表與一次作業回饋（僅示意）", true),
      field("educationWhyBuy", "為什麼需要這個教育／方案", false, "解釋價值，不製造不實恐懼。", "示例：明確順序與回饋能減少重複試錯（僅示意）", true),
      field("commonObjections", "常見疑慮", false, "填觀眾真實問過的問題。", "示例：我沒有固定時間，還能跟上嗎？（僅示意）", true),
    ],
  },
  {
    id: "pricing",
    title: "價格與方案",
    description: "只有真實的價格、折扣、付款與限制才會進入稿件。",
    fields: [
      field("pricing", "定價策略（原價／優惠價／分期／限制）", true, "可先填摘要；細節可填下方欄位。", "示例：原價、目前方案、付款方式（僅示意）", true),
      field("originalPrice", "原價", false, "只填確實使用過的原價；沒有就留白。", "示例：NT$【實際原價】（僅示意，請填真實金額）"),
      field("offerPrice", "本次方案價", false, "填目前真實收費，不讓生成器猜。", "示例：NT$【實際方案價】（僅示意，請填真實金額）"),
      field("discountReason", "真實折扣理由", false, "說明真實原因；沒有折扣可填「無折扣」。", "示例：本期首次開課，早鳥至實際日期（僅示意）"),
      field("installments", "分期方式", false, "只填實際提供的期數與費用。", "示例：可分三期，每期 NT$【實際金額】（僅示意）"),
      field("genuineLimits", "真實名額／服務限制", false, "沒有真實限制請填「無」，不要製造稀缺。", "示例：小班回饋限額 20 人（僅示意，請確認是真的）"),
      field("deadline", "實際截止時間", false, "沒有確定期限就留白。", "示例：2026/01/31 23:59（僅示意，請填實際期限）"),
    ],
  },
  {
    id: "proof-and-safety",
    title: "贈品、證據與保障",
    description: "價值堆疊與風險逆轉必須建立在真實資料上。",
    fields: [
      field("bonuses", "贈品總覽", true, "可以填「無贈品」；有就列名稱、內容與真實價值。", "示例：無贈品；或贈品名稱｜內容｜實際價值（僅示意）", true),
      field("bonusesCourse", "贈品：加值課程", false, "沒有就填「無」，不要自動補贈品。", "示例：無；或課程名稱、內容與實際價值（僅示意）", true),
      field("bonusesCoaching", "贈品：教練／回饋", false, "只填實際提供的次數、期限與範圍。", "示例：無；或一次作業回饋至【日期】（僅示意）", true),
      field("bonusesTemplates", "贈品：範本／工具", false, "只列確定交付的檔案或工具。", "示例：無；或內容規劃範本（僅示意）", true),
      field("bonusesPartnerResources", "贈品：合作夥伴資源", false, "只填有授權且確定能交付的資源。", "示例：無；或合作資源名稱與實際價值（僅示意）", true),
      field("testimonials", "學員見證（原文與證據）", false, "貼實際原文與可核對證據；沒有就填「無」。不虛構見證或數字。", "示例：無；或實際學員原話＋可核對證據說明（僅示意）", true),
      field("guaranteeTerms", "保證／退費條款", false, "只填實際提供且已確認的條件；7／30 天僅在確實適用時填。", "示例：無保證；或實際 7 天退費條件（僅示意）", true),
    ],
  },
  {
    id: "faq-and-action",
    title: "疑慮與報名",
    description: "準備真實問答與清楚、不誤導的下一步。",
    fields: [
      field("faqTime", "FAQ：時間", false, "回答實際學習時間、觀看期限或安排。", "示例：每週約兩小時，影片可觀看至實際期限（僅示意）", true),
      field("faqAbility", "FAQ：能力／程度", false, "說明先備知識與適合程度，不保證所有人相同結果。", "示例：不需程式背景，但需能操作瀏覽器（僅示意）", true),
      field("faqEffect", "FAQ：效果", false, "提供合理成果與限制，避免收入或成效保證。", "示例：會完成一份作品，成果取決於投入與情境（僅示意）", true),
      field("faqMoney", "FAQ：費用／退款", false, "清楚說明付款、分期與退款條件。", "示例：支援信用卡，退款依實際條款辦理（僅示意）", true),
      field("signupSteps", "報名步驟", false, "列出完成報名需要做的每一步與聯絡方式。", "示例：點報名 → 填資料 → 付款 → 收到登入信（僅示意）", true),
    ],
  },
] as const;

export const salesScriptQuestionnaireFields: readonly SalesScriptQuestionnaireField[] =
  SALES_SCRIPT_QUESTIONNAIRE_GROUPS.flatMap((group) => group.fields);

export const salesScriptQuestionnaireGroups =
  SALES_SCRIPT_QUESTIONNAIRE_GROUPS;

export const requiredSalesScriptAnswerIds =
  REQUIRED_SALES_SCRIPT_QUESTION_IDS;

export const requiredSalesScriptQuestionIds =
  REQUIRED_SALES_SCRIPT_QUESTION_IDS;

export function createEmptySalesScriptQuestionnaire(): SalesScriptQuestionnaireAnswers {
  return Object.fromEntries(
    salesScriptQuestionnaireFields.map(({ id }) => [id, ""]),
  ) as SalesScriptQuestionnaireAnswers;
}

export function missingSalesScriptQuestionIds(
  answers: SalesScriptQuestionnaireAnswers,
): (typeof REQUIRED_SALES_SCRIPT_QUESTION_IDS)[number][] {
  return REQUIRED_SALES_SCRIPT_QUESTION_IDS.filter(
    (id) => !String(answers[id] ?? "").trim(),
  );
}
