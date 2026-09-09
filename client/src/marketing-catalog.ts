import type { LangFull } from "@/hooks/use-lang";
import type { FeatureSlug, SolutionSlug } from "@/components/marketing";

type DetailCopy = {
  title: string;
  description: string;
  headline: string;
  points: readonly [string, string, string];
};

export const featureCopy: Record<LangFull, Record<FeatureSlug, DetailCopy>> = {
  "zh-TW": {
    "ai-assistant": {
      title: "AI 觀眾助教",
      description: "依據你的 Webinar 內容，即時協助回答觀眾問題。",
      headline: "有人提問時，內容不必停下來。",
      points: ["在觀看旅程中提供即時協助", "讓常見問題不必等待人工回覆", "讓觀眾在理解當下繼續探索"],
    },
    "automated-webinars": {
      title: "自動化 Webinar",
      description: "提供循環場次與隨到隨看，配合每位觀眾的時間。",
      headline: "把一場精彩銷講，安排成觀眾剛好趕得上的場次。",
      points: ["建立固定、循環或單次場次", "同時提供隨到隨看的觀看選擇", "依 Webinar 時區呈現正確時間"],
    },
    interactions: {
      title: "定時互動",
      description: "讓訊息、投票、小提示與 CTA 在內容的關鍵時刻出現。",
      headline: "在觀眾最有感的那一刻，說出下一句。",
      points: ["依影片時間推出互動內容", "用投票與問答維持參與感", "在理解最完整時呈現行動呼籲"],
    },
    "landing-pages": {
      title: "落地頁與報名",
      description: "用品牌化落地頁承接興趣，帶領訪客完成報名。",
      headline: "從第一個畫面，就說清楚值得報名的理由。",
      points: ["用區塊編輯器整理銷講主張", "嵌入 YouTube、Vimeo 與倒數 CTA", "發布獨立網址並保留草稿快照"],
    },
    "follow-up": {
      title: "Email 自動追蹤",
      description: "從報名提醒到觀看後追蹤，讓對話不在 Webinar 結束時中斷。",
      headline: "Webinar 結束後，成交旅程還可以繼續。",
      points: ["寄送報名確認與場次提醒", "依觀看進度安排後續訊息", "以可重送且不重複的方式排程寄送"],
    },
    analytics: {
      title: "成效與成交洞察",
      description: "查看報名、觀看、互動與可信付款事件形成的轉換脈絡。",
      headline: "知道觀眾從哪裡來，也看見他們往哪裡走。",
      points: ["檢視報名、出席與觀看表現", "理解互動與成交訊號", "以實際付款與退款資料計算淨營收"],
    },
    embeds: {
      title: "網站嵌入",
      description: "將報名與觀看流程帶進既有網站，延續你的品牌體驗。",
      headline: "你的網站，不必為了 Webinar 重新開始。",
      points: ["嵌入報名流程", "嵌入受權限保護的觀看體驗", "保留同一套發布與訂閱驗證"],
    },
    ecpay: {
      title: "會員自有 ECPay",
      description: "由會員自己的綠界商店直接收款，平台不代收商品款。",
      headline: "成交這一步，款項直接進入你的金流帳號。",
      points: ["使用會員自己的 ECPay 商店", "從銷講 CTA 帶往商品成交頁", "退款與付款結果回到可信事件紀錄"],
    },
  },
  "zh-CN": {
    "ai-assistant": {
      title: "AI 观众助教",
      description: "依据您的 Webinar 内容，即时协助回答观众问题。",
      headline: "有人提问时，内容不必停下来。",
      points: ["在观看旅程中提供即时协助", "让常见问题不必等待人工回复", "让观众在理解当下继续探索"],
    },
    "automated-webinars": {
      title: "自动化 Webinar",
      description: "提供循环场次与随到随看，配合每位观众的时间。",
      headline: "把一场精彩销讲，安排成观众刚好赶得上的场次。",
      points: ["建立固定、循环或单次场次", "同时提供随到随看的观看选择", "依 Webinar 时区显示正确时间"],
    },
    interactions: {
      title: "定时互动",
      description: "让消息、投票、提示与 CTA 在内容的关键时刻出现。",
      headline: "在观众最有感的那一刻，说出下一句。",
      points: ["依视频时间推出互动内容", "用投票与问答维持参与感", "在理解最完整时呈现行动号召"],
    },
    "landing-pages": {
      title: "落地页与报名",
      description: "用品牌化落地页承接兴趣，带领访客完成报名。",
      headline: "从第一个画面，就说清楚值得报名的理由。",
      points: ["用区块编辑器整理销讲主张", "嵌入 YouTube、Vimeo 与倒数 CTA", "发布独立网址并保留草稿快照"],
    },
    "follow-up": {
      title: "Email 自动跟进",
      description: "从报名提醒到观看后跟进，让对话不在 Webinar 结束时中断。",
      headline: "Webinar 结束后，成交旅程还可以继续。",
      points: ["发送报名确认与场次提醒", "依观看进度安排后续消息", "以可重试且不重复的方式排程发送"],
    },
    analytics: {
      title: "成效与成交洞察",
      description: "查看报名、观看、互动与可信付款事件形成的转化脉络。",
      headline: "知道观众从哪里来，也看见他们往哪里走。",
      points: ["检视报名、出席与观看表现", "理解互动与成交信号", "以实际付款与退款资料计算净营收"],
    },
    embeds: {
      title: "网站嵌入",
      description: "将报名与观看流程带进现有网站，延续您的品牌体验。",
      headline: "您的网站，不必为了 Webinar 重新开始。",
      points: ["嵌入报名流程", "嵌入受权限保护的观看体验", "保留同一套发布与订阅验证"],
    },
    ecpay: {
      title: "会员自有 ECPay",
      description: "由会员自己的 ECPay 商店直接收款，平台不代收商品款。",
      headline: "成交这一步，款项直接进入您的支付帐户。",
      points: ["使用会员自己的 ECPay 商店", "从销讲 CTA 前往商品成交页", "退款与付款结果回到可信事件记录"],
    },
  },
  en: {
    "ai-assistant": {
      title: "AI audience assistant",
      description: "Help answer viewer questions in real time using your webinar content.",
      headline: "Questions do not have to stop the presentation.",
      points: ["Support viewers while they watch", "Handle common questions without a waiting queue", "Help people keep exploring while context is fresh"],
    },
    "automated-webinars": {
      title: "Automated webinars",
      description: "Offer recurring sessions and on-demand viewing around each viewer's schedule.",
      headline: "Make a great presentation available at the right time.",
      points: ["Create fixed, recurring, or one-time sessions", "Offer on-demand access alongside scheduled sessions", "Show every session in the webinar's timezone"],
    },
    interactions: {
      title: "Timed interactions",
      description: "Reveal messages, polls, tips, and calls to action at key moments.",
      headline: "Say the next thing when the audience is ready for it.",
      points: ["Time interactions to the presentation", "Keep viewers involved with polls and questions", "Present a call to action with the right context"],
    },
    "landing-pages": {
      title: "Landing pages & registration",
      description: "Turn interest into registrations with a branded, focused destination.",
      headline: "Make the reason to register clear from the first screen.",
      points: ["Shape the story with a block editor", "Embed YouTube, Vimeo, and a countdown CTA", "Publish a stable URL without exposing draft changes"],
    },
    "follow-up": {
      title: "Automated email follow-up",
      description: "Continue the conversation from registration reminders through post-viewing follow-up.",
      headline: "The journey can continue after the webinar ends.",
      points: ["Send confirmations and session reminders", "Follow up using viewing context", "Schedule retry-safe messages without duplicates"],
    },
    analytics: {
      title: "Performance & sales insights",
      description: "Connect registration, viewing, interaction, and trusted payment events.",
      headline: "See where viewers came from and where they went next.",
      points: ["Review registration, attendance, and watch activity", "Understand interaction and buying signals", "Measure net revenue from authoritative payments and refunds"],
    },
    embeds: {
      title: "Website embeds",
      description: "Bring registration and viewing into your existing website and brand experience.",
      headline: "Your website does not need to start over for webinars.",
      points: ["Embed the registration experience", "Embed access-controlled viewing", "Keep the same publishing and subscription checks"],
    },
    ecpay: {
      title: "Member-owned ECPay",
      description: "Collect product payments through your own ECPay merchant account, not the platform.",
      headline: "When a viewer buys, the payment goes directly to your account.",
      points: ["Use your own ECPay merchant account", "Connect webinar CTAs to an offer page", "Record payment and refund results from trusted events"],
    },
  },
};

export const solutionCopy: Record<LangFull, Record<SolutionSlug, DetailCopy>> = {
  "zh-TW": {
    instructors: {
      title: "講師與課程創作者",
      description: "把一次講得很好的銷講，變成持續被看見、報名與成交的內容入口。",
      headline: "讓代表作持續開講，不必每次都重新上線。",
      points: ["用預錄內容承接新學員", "在關鍵段落回答問題並推出課程", "用追蹤 Email 延續觀看後的興趣"],
    },
    consultants: {
      title: "顧問與教練",
      description: "先用內容建立方法與信任，把真人時間留給真正需要深入討論的客戶。",
      headline: "讓方法論先說清楚，再把時間留給高價值對話。",
      points: ["自動完成重複的觀念說明", "用問答釐清常見疑慮", "把高意圖觀眾帶往諮詢下一步"],
    },
    "sales-teams": {
      title: "銷售團隊",
      description: "用一致的產品敘事服務更多潛客，讓每位業務都能接續同一段成交旅程。",
      headline: "讓每一位潛客，都先聽到最完整的產品故事。",
      points: ["建立可重複使用的產品簡報", "在影片節點回應常見銷售問題", "依觀看與互動訊號安排跟進"],
    },
    "marketing-teams": {
      title: "行銷團隊",
      description: "把活動內容、報名、觀看與後續訊息整理成可長期使用的轉換路徑。",
      headline: "一場活動結束後，內容價值不必跟著下線。",
      points: ["把活動內容轉為常態名單入口", "追蹤來源、報名與觀看表現", "用落地頁與 CTA 測試不同主張"],
    },
    "customer-education": {
      title: "客戶教育與成功",
      description: "用可重複觀看的內容協助客戶理解產品、完成導入並採取下一個行動。",
      headline: "讓每位客戶都能在需要時，找到一致的產品說明。",
      points: ["提供隨到隨看的教育內容", "用互動確認理解與需求", "減少團隊重複示範與說明的時間"],
    },
  },
  "zh-CN": {
    instructors: {
      title: "讲师与课程创作者",
      description: "把一次讲得很好的销讲，变成持续被看见、报名与成交的内容入口。",
      headline: "让代表作持续开讲，不必每次都重新上线。",
      points: ["用预录内容承接新学员", "在关键段落回答问题并推出课程", "用跟进 Email 延续观看后的兴趣"],
    },
    consultants: {
      title: "顾问与教练",
      description: "先用内容建立方法与信任，把真人时间留给真正需要深入讨论的客户。",
      headline: "让方法论先说清楚，再把时间留给高价值对话。",
      points: ["自动完成重复的观念说明", "用问答厘清常见疑虑", "把高意向观众带往咨询下一步"],
    },
    "sales-teams": {
      title: "销售团队",
      description: "用一致的产品叙事服务更多潜客，让每位销售都能接续同一段成交旅程。",
      headline: "让每一位潜客，都先听到最完整的产品故事。",
      points: ["建立可重复使用的产品演示", "在视频节点回应常见销售问题", "依观看与互动信号安排跟进"],
    },
    "marketing-teams": {
      title: "营销团队",
      description: "把活动内容、报名、观看与后续消息整理成可长期使用的转化路径。",
      headline: "一场活动结束后，内容价值不必跟着下线。",
      points: ["把活动内容转为常态名单入口", "跟踪来源、报名与观看表现", "用落地页与 CTA 测试不同主张"],
    },
    "customer-education": {
      title: "客户教育与成功",
      description: "用可重复观看的内容协助客户理解产品、完成导入并采取下一步。",
      headline: "让每位客户都能在需要时，找到一致的产品说明。",
      points: ["提供随到随看的教育内容", "用互动确认理解与需求", "减少团队重复演示与说明的时间"],
    },
  },
  en: {
    instructors: {
      title: "Instructors & course creators",
      description: "Turn one strong presentation into an ongoing destination for discovery, registration, and sales.",
      headline: "Keep your best presentation available without going live every time.",
      points: ["Welcome new learners with recorded content", "Answer questions and introduce an offer at key moments", "Continue interest with post-viewing email"],
    },
    consultants: {
      title: "Consultants & coaches",
      description: "Build trust with your method first, then save live time for clients who need a deeper conversation.",
      headline: "Explain your method once. Save your time for higher-value conversations.",
      points: ["Automate repeated foundational explanations", "Clarify common objections through Q&A", "Move high-intent viewers toward a consultation"],
    },
    "sales-teams": {
      title: "Sales teams",
      description: "Give more prospects a consistent product story and let every rep continue the same sales journey.",
      headline: "Give every prospect the complete product story first.",
      points: ["Create a repeatable product presentation", "Answer common sales questions at the right moment", "Follow up using viewing and interaction signals"],
    },
    "marketing-teams": {
      title: "Marketing teams",
      description: "Turn campaign content, registration, viewing, and follow-up into an evergreen conversion path.",
      headline: "An event can end without taking its content value offline.",
      points: ["Turn event content into an ongoing lead destination", "Connect source, registration, and viewing performance", "Test messages with landing pages and calls to action"],
    },
    "customer-education": {
      title: "Customer education & success",
      description: "Help customers understand the product, complete onboarding, and take the next step on their schedule.",
      headline: "Give every customer a consistent explanation exactly when they need it.",
      points: ["Offer on-demand education", "Use interactions to confirm understanding and needs", "Reduce repeated demonstrations for the success team"],
    },
  },
};

export const marketingPageCopy = {
  "zh-TW": {
    featureIndex: {
      eyebrow: "產品功能",
      title: "不是多一個工具。",
      accent: "是一套會接棒的銷講旅程。",
      description: "從落地頁、報名到觀看中的提問、互動與付款下一步，SellCase 將重複工作整理成可持續運作的系統。",
      action: "查看功能",
    },
    solutionIndex: {
      eyebrow: "適用對象",
      title: "專業不該只在",
      accent: "你有空的時候才被看見。",
      description: "不同的工作方式，都能把重複說明與觀看引導交給一套清楚、可延續的銷講旅程。",
      action: "查看使用方式",
    },
    build: "開始建立 Webinar",
    helps: "它能幫你完成",
    continue: "繼續探索 SellCase",
    allFeatures: "查看全部功能",
    allSolutions: "查看所有適用對象",
    missing: "找不到這個頁面",
    missingDescription: "這個網址可能已變更，請回到完整列表繼續探索。",
  },
  "zh-CN": {
    featureIndex: {
      eyebrow: "产品功能",
      title: "不是多一个工具。",
      accent: "是一套会接棒的销讲旅程。",
      description: "从落地页、报名到观看中的提问、互动与付款下一步，SellCase 将重复工作整理成可持续运行的系统。",
      action: "查看功能",
    },
    solutionIndex: {
      eyebrow: "适用对象",
      title: "专业不该只在",
      accent: "您有空的时候才被看见。",
      description: "不同的工作方式，都能把重复说明与观看引导交给一套清晰、可延续的销讲旅程。",
      action: "查看使用方式",
    },
    build: "开始建立 Webinar",
    helps: "它能帮您完成",
    continue: "继续探索 SellCase",
    allFeatures: "查看全部功能",
    allSolutions: "查看所有适用对象",
    missing: "找不到这个页面",
    missingDescription: "这个网址可能已变更，请回到完整列表继续探索。",
  },
  en: {
    featureIndex: {
      eyebrow: "Product capabilities",
      title: "Not another tool.",
      accent: "A selling journey that keeps taking the next step.",
      description: "From landing pages and registration to questions, interactions, and payment, SellCase organizes repeatable work into one continuous system.",
      action: "Explore capability",
    },
    solutionIndex: {
      eyebrow: "Who it is for",
      title: "Your expertise should not be limited",
      accent: "to the hours when you are available.",
      description: "Different teams can turn repeated explanations and viewing guidance into a clear journey that keeps working.",
      action: "Explore solution",
    },
    build: "Build a webinar",
    helps: "What it helps you do",
    continue: "Keep exploring SellCase",
    allFeatures: "View all capabilities",
    allSolutions: "View all solutions",
    missing: "We could not find that page",
    missingDescription: "The address may have changed. Return to the complete list to keep exploring.",
  },
} satisfies Record<LangFull, object>;