import fs from "node:fs";
import { jsPDF } from "jspdf";

const OUT = "reports/ICTA-Webinar-Competitive-Analysis-2026-09.pdf";
const FONT = "reports/assets/NotoSansTC.ttf";
const CHART = "reports/assets/positioning-map.png";
const chartData = `data:image/png;base64,${fs.readFileSync(CHART).toString("base64")}`;

const doc = new jsPDF({ unit: "pt", format: "letter" });
const PAGE_W = 612;
const PAGE_H = 792;
const M = 36;
const NAVY = [15, 35, 64];
const TEAL = [14, 165, 168];
const ORANGE = [249, 115, 22];
const SLATE = [71, 85, 105];
const LIGHT = [241, 245, 249];
const GREEN = [22, 163, 74];
const RED = [220, 38, 38];

const fontBase64 = fs.readFileSync(FONT).toString("base64");
doc.addFileToVFS("NotoSansTC.ttf", fontBase64);
doc.addFont("NotoSansTC.ttf", "NotoSansTC", "normal");
doc.setFont("NotoSansTC");

function header(title, page) {
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, PAGE_W, 54, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  doc.text("ICTA WEBINAR｜競品與產品差距評估", M, 23);
  doc.setFontSize(13);
  doc.text(title, M, 42);
  doc.setDrawColor(...TEAL);
  doc.setLineWidth(3);
  doc.line(M, 54, PAGE_W - M, 54);
  footer(page);
}

function footer(page) {
  doc.setDrawColor(220, 226, 232);
  doc.setLineWidth(0.7);
  doc.line(M, PAGE_H - 30, PAGE_W - M, PAGE_H - 30);
  doc.setTextColor(...SLATE);
  doc.setFontSize(7.5);
  doc.text("資料快照：2026-09-03｜Bombmy 公開官網、公開 GitHub 與 ICTA 程式碼稽核", M, PAGE_H - 16);
  doc.text(`${page} / 8`, PAGE_W - M, PAGE_H - 16, { align: "right" });
}

function title(text, y, size = 24, color = NAVY) {
  doc.setTextColor(...color);
  doc.setFontSize(size);
  doc.text(text, M, y);
}

function paragraph(text, x, y, width, size = 10, color = SLATE, lineHeight = 1.45) {
  doc.setTextColor(...color);
  doc.setFontSize(size);
  const lines = doc.splitTextToSize(text, width);
  doc.text(lines, x, y, { lineHeightFactor: lineHeight });
  return y + lines.length * size * lineHeight;
}

function card(x, y, w, h, label, body, accent = TEAL) {
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(222, 229, 237);
  doc.roundedRect(x, y, w, h, 8, 8, "FD");
  doc.setFillColor(...accent);
  doc.roundedRect(x, y, 5, h, 3, 3, "F");
  doc.setTextColor(...NAVY);
  doc.setFontSize(11);
  doc.text(label, x + 15, y + 21);
  paragraph(body, x + 15, y + 39, w - 28, 8.5);
}

function scoreBar(label, score, y, color) {
  doc.setTextColor(...NAVY);
  doc.setFontSize(9);
  doc.text(label, M, y);
  doc.setFillColor(226, 232, 240);
  doc.roundedRect(155, y - 9, 330, 10, 5, 5, "F");
  doc.setFillColor(...color);
  doc.roundedRect(155, y - 9, 330 * score / 100, 10, 5, 5, "F");
  doc.setTextColor(...color);
  doc.text(`${score}%`, 510, y);
}

function statusCell(x, y, w, status) {
  const map = {
    "強": [GREEN, "● 強"],
    "有": [GREEN, "● 有"],
    "部分": [[217, 119, 6], "◐ 部分"],
    "弱": [RED, "○ 弱"],
    "無": [RED, "○ 無"],
    "模擬": [[100, 116, 139], "△ 模擬"],
  };
  const [color, text] = map[status];
  doc.setTextColor(...color);
  doc.setFontSize(7.5);
  doc.text(text, x + w / 2, y, { align: "center" });
}

// Page 1
header("執行摘要", 1);
title("ICTA 距離 Bombmy 有多遠？", 92, 26);
paragraph("一句話答案：核心自動化 Webinar 體驗約完成六成，但若以可商用的「全自動成交平台」衡量，目前約在 40–45%。差距集中在成交、渠道與數據閉環，不是播放器。", M, 120, 540, 12, NAVY, 1.55);
doc.setFillColor(...LIGHT);
doc.roundedRect(M, 184, 540, 88, 10, 10, "F");
doc.setTextColor(...NAVY);
doc.setFontSize(10);
doc.text("建議定位", 52, 207);
paragraph("為華語知識型創作者與顧問，ICTA Webinar 是一套「AI 輔助成交的自動化研討會平台」。相較 Bombmy 的完整台灣成交營運鏈，ICTA 應以 AI 即時問答、AI 互動腳本與更細緻的行為追蹤形成差異，而不是逐功能複製。", 52, 227, 508, 10);
scoreBar("自動化 Webinar 核心流程", 62, 310, TEAL);
scoreBar("商業成交與在地整合", 38, 342, ORANGE);
scoreBar("AI 與內容自動化", 75, 374, TEAL);
scoreBar("正式 SaaS 營運底座", 72, 406, TEAL);
card(M, 442, 168, 132, "優先 1｜補成交閉環", "建立 Webinar 商品、外部付款／台灣金流連結、CTA 點擊與購買 Webhook 歸因。這會直接改善可銷售性。", ORANGE);
card(222, 442, 168, 132, "優先 2｜補量測閉環", "真正收集 page_view、播放進度、離場、CTA、checkout、purchase 事件，讓漏斗報表不再只是資料模型。", TEAL);
card(408, 442, 168, 132, "優先 3｜補台灣渠道", "先做 LINE OA Webhook／通知，再補 SMS。ManyChat 可透過通用 Webhook，不必一開始做完整原生整合。", TEAL);
doc.setTextColor(...NAVY);
doc.setFontSize(12);
doc.text("時間估算（範圍，不是承諾）", M, 620);
paragraph("2 位全職工程師＋產品決策快速：12–18 週可補到「核心功能可正面競爭」；要達到 Bombmy 類產品的營運成熟度、金流覆蓋、可觀測性與客服穩定度，合理範圍是 6–9 個月。單人開發通常需 6–12 個月。", M, 642, 540, 9.5);

// Page 2
doc.addPage();
header("競爭格局", 2);
title("三者不是同一類產品成熟度", 90, 22);
const cols = [36, 130, 245, 355, 465, 576];
const rowY = [132, 179, 250, 321, 392];
doc.setFillColor(...NAVY);
doc.rect(M, 110, 540, 32, "F");
["項目", "定位／階段", "價格", "主要強項", "主要弱項"].forEach((t, i) => {
  doc.setTextColor(255,255,255); doc.setFontSize(8); doc.text(t, cols[i] + 6, 130);
});
const rows = [
  ["Bombmy", "台灣商用產品", "未公開；導向免費體驗", "台灣金流、SMS、CRM、聯盟行銷、完整成交鏈", "公開技術／定價透明度低；獨立評論薄弱"],
  ["ICTA Webinar", "可運作 SaaS MVP", "US$49／99 月；加購房 US$20", "AI 問答、腳本生成、On-demand＋排程、嵌入、權益安全", "無台灣金流／LINE／SMS；購買歸因與量測不完整"],
  ["GitHub 範例", "單一活動 Demo", "免費原始碼；無正式授權檔", "n8n、Google Sheets、優惠券、Lead Table、WhatsApp", "模擬付款；非多租戶；安全與營運成熟度不足"],
];
let y = 151;
rows.forEach((r, ri) => {
  const h = 118;
  doc.setFillColor(ri % 2 ? 248 : 255, ri % 2 ? 250 : 255, ri % 2 ? 252 : 255);
  doc.rect(M, y, 540, h, "F");
  const widths = [88, 108, 104, 108, 112];
  let x = M;
  r.forEach((cell, ci) => {
    doc.setTextColor(...(ci === 0 ? NAVY : SLATE));
    doc.setFontSize(ci === 0 ? 9 : 7.3);
    const lines = doc.splitTextToSize(cell, widths[ci] - 8);
    doc.text(lines, x + 4, y + 19, { lineHeightFactor: 1.45 });
    x += widths[ci];
  });
  y += h;
});
card(M, 540, 260, 118, "Bombmy 證據品質", "功能依 Bombmy 官網公開文案核實；成效案例屬品牌自述。未找到足量 G2／Capterra 獨立評論，因此不能把客戶見證當成經第三方驗證的成效。", ORANGE);
card(316, 540, 260, 118, "GitHub 健康度", "2025-09 建立、最後推送 2025-11、2 stars、0 forks、無 LICENSE 檔。package.json 雖寫 MIT，但缺正式授權檔，不建議直接複製程式碼進商用產品。", TEAL);

// Page 3
doc.addPage();
header("功能矩陣", 3);
title("核心差距矩陣", 90, 22);
paragraph("權重 5 代表最直接影響客戶購買決策。ICTA 的優勢在 AI 與 SaaS 安全底座；Bombmy 的優勢在完整成交營運鏈。", M, 112, 540, 9);
const matrix = [
  ["排程＋隨到即播",5,"強","強","弱"],
  ["預錄影片與擬真直播",5,"強","強","弱"],
  ["預設聊天／虛擬人數",4,"強","強","弱"],
  ["定時 CTA／限時倒數",5,"部分","強","弱"],
  ["報名頁＋多場次",5,"強","強","弱"],
  ["Lead 欄位／標籤",4,"有","強","有"],
  ["Email 提醒／分眾追銷",5,"部分","強","部分"],
  ["LINE／SMS／ManyChat",5,"無","部分","部分"],
  ["商品／付款／購買歸因",5,"無","強","模擬"],
  ["留存／離場／轉換分析",5,"部分","部分","部分"],
  ["Pixel／GTM／廣告事件",4,"無","有","無"],
  ["AI 即時問答／內容生成",4,"強","弱","部分"],
  ["嵌入／Widget",3,"強","部分","無"],
  ["多租戶 SaaS／訂閱權益",4,"強","強","無"],
  ["Email 驗證／限流／告警",4,"強","部分","弱"],
];
doc.setFillColor(...NAVY);
doc.rect(M, 150, 540, 28, "F");
["能力","權重","ICTA","Bombmy","GitHub"].forEach((t,i)=>{
  const xs=[42,315,365,437,510]; doc.setTextColor(255,255,255); doc.setFontSize(8); doc.text(t,xs[i],168);
});
y = 196;
matrix.forEach((r, idx) => {
  if (idx % 2 === 0) { doc.setFillColor(248,250,252); doc.rect(M,y-14,540,28,"F"); }
  doc.setTextColor(...NAVY); doc.setFontSize(7.7); doc.text(r[0], 42, y);
  doc.setTextColor(...SLATE); doc.text(String(r[1]), 326, y, {align:"center"});
  statusCell(346,y,58,r[2]); statusCell(418,y,58,r[3]); statusCell(492,y,58,r[4]);
  y += 30;
});
paragraph("註：Bombmy 的「分析」與「廣告設定」可由官網功能清單證實，但公開頁不足以確認事件粒度，因此保守評為部分／有。ICTA 的分析資料表與圖表存在，但部分事件尚未證實完整寫入。", M, 665, 540, 8, SLATE);

// Page 4
doc.addPage();
header("定位地圖", 4);
title("不應追成 Bombmy 的較小版本", 90, 22);
paragraph("最有機會的白地不是單純「更多功能」，而是把 AI 即時協助、細緻觀看行為與自動追銷串成一個閉環。", M, 114, 540, 10);
doc.addImage(chartData, "PNG", 52, 164, 508, 305);
card(M, 500, 255, 118, "Bombmy 的護城河", "在地營運：台灣金流、SMS、CRM、聯盟行銷、附屬帳號，以及從商品到收款的一條龍流程。", ORANGE);
card(321, 500, 255, 118, "ICTA 可建立的護城河", "AI 不只生成文案，而是理解 Webinar 文件、回答疑問、辨識觀看階段，並把行為轉成精準追銷動作。", TEAL);
paragraph("策略判斷：若只補齊 Bombmy 現有功能，ICTA 會進入同質化價格競爭；若先補量測與成交，再把 AI 放在每個漏斗節點，才有清楚可賣的差異。", M, 660, 540, 10, NAVY);

// Page 5
doc.addPage();
header("白地與 Kano 判讀", 5);
title("哪些是基本盤，哪些能形成差異？", 90, 22);
card(M, 130, 170, 184, "Basics｜沒有就不能賣", "• 穩定排程／On-demand\n• 報名、提醒、觀看\n• 定時 CTA 與倒數\n• Email 合規與退訂\n• 購買歸因\n• Pixel／GTM\n• 可相信的漏斗報表", RED);
card(221, 130, 170, 184, "Performance｜越強越好", "• 報名頁轉換速度\n• 多場次與時區\n• LINE／SMS 到達率\n• CRM 標籤與分群\n• 台灣金流覆蓋\n• 留存／離場分析粒度\n• 自動化分支彈性", ORANGE);
card(406, 130, 170, 184, "Delighters｜可形成溢價", "• AI 即時成交助理\n• 依觀看秒數自動追銷\n• AI 生成互動劇本\n• AI 分析離場原因\n• 自動生成下一版 CTA\n• 逐客個人化優惠\n• AI 對話到成交歸因", TEAL);
title("市場白地", 356, 18);
const gaps = [
  ["1", "AI × 行為事件", "看到第 28 分鐘離開 → AI 判斷疑慮 → 自動選擇 LINE／Email 訊息。Bombmy 公開頁未證實這種粒度。"],
  ["2", "華語創作者的輕量方案", "Bombmy 偏一條龍營運；ICTA 可用較低月費＋自助上線，服務尚未需要完整 CRM 的中小型團隊。"],
  ["3", "可攜式 Webinar Widget", "ICTA 已有嵌入能力，可把報名與播放嵌入既有 WordPress／課程站，降低換站成本。"],
];
y=400;
gaps.forEach(([n,l,b])=>{
  doc.setFillColor(...TEAL); doc.circle(53,y-4,13,"F"); doc.setTextColor(255,255,255); doc.setFontSize(10); doc.text(n,53,y,{align:"center"});
  doc.setTextColor(...NAVY); doc.setFontSize(10); doc.text(l,76,y);
  paragraph(b,76,y+18,480,8.5); y+=88;
});

// Page 6
doc.addPage();
header("行動方案", 6);
title("180 天追趕路線", 90, 22);
card(M, 126, 540, 126, "0–30 天｜先讓每一個成交事件可被看見", "建立統一事件模型：landing_view、registration、video_progress、dropoff、cta_view、cta_click、checkout_start、purchase。完成 Meta Pixel／GTM，自訂外部購買 Webhook，報表改用真實事件。驗收：能回答「第幾分鐘流失、誰點 CTA、誰付款」。", RED);
card(M, 274, 540, 126, "31–90 天｜補上可直接賣的成交閉環", "新增 Webinar 商品／Offer、定時優惠、庫存／名額提示、付款連結與購買歸因。優先串綠界或藍新其中一家，再補 LINE OA 通知。驗收：使用者不需人工匯入即可從報名追到付款。", ORANGE);
card(M, 422, 540, 126, "91–180 天｜把 AI 變成真正差異化", "讓 AI 使用觀看進度、聊天問題、CTA 行為與商品資料，決定追銷分群與訊息；提供建議但保留人工審核。驗收：同一場 Webinar 可依行為自動產出至少 5 種追銷路徑，且能比較轉換率。", TEAL);
title("銷售 Battlecard：用問題改變比較標準", 594, 15);
paragraph("• 你現在能知道客戶是在 CTA 前、CTA 後，還是價格出現時離開嗎？\n• 客戶在直播中問過的問題，會自動影響他收到的追銷內容嗎？\n• 你要的是一套完整 CRM，還是能嵌入既有網站、快速上線的 AI Webinar？\n• 每月多成交一單，是否足以覆蓋系統月費？", M, 620, 540, 9.2, NAVY);

// Page 7
doc.addPage();
header("GitHub 專案判讀", 7);
title("可以參考，但不能當底座", 90, 22);
paragraph("UmeshChandra05/Webinar-Sales-Funnel 是針對單一「Python Full Stack in 5 Days」活動的漏斗 Demo。README 很完整，但核心付款是模擬，資料依賴 Google Sheets＋n8n，並非通用的 Webinar 播放與多租戶 SaaS。", M, 116, 540, 10);
card(M, 186, 255, 196, "值得借鑑", "1. n8n webhook 作為外部自動化出口\n2. Lead Table：來源、培育層級、付款狀態、優惠券、金額\n3. 優惠券與 Need Time／Failure 狀態\n4. WhatsApp 社群導流\n5. Payment success／failed／thank-you 頁\n6. CSV 匯出與日期篩選", TEAL);
card(321, 186, 255, 196, "不要直接移植", "1. 模擬付款，不是真實 gateway\n2. Google Sheets 不適合核心交易資料\n3. n8n webhook 可用性會卡住登入／註冊\n4. 不是多租戶、沒有房間權益\n5. 無完整 Webinar 播放／進度事件\n6. 回應中回傳 JWT；日誌過度詳細\n7. 無 LICENSE 檔，商用複製有風險", RED);
title("建議採用方式", 430, 18);
paragraph("把它當成「功能清單與流程草圖」，不要 merge 程式碼。最值得轉化成 ICTA 原生功能的是：通用 Webhook／n8n 觸發器、Lead Funnel Table、優惠券與付款狀態，以及 WhatsApp／LINE 社群導流。核心資料仍應留在 PostgreSQL，Webhook 必須非同步、可重試並具 idempotency。", M, 460, 540, 10, NAVY);
doc.setFillColor(...LIGHT);
doc.roundedRect(M, 560, 540, 92, 8, 8, "F");
doc.setTextColor(...NAVY); doc.setFontSize(11); doc.text("最終判定", 52, 585);
paragraph("參考價值：6/10。可借鑑產品流程：高；可直接重用程式碼：低；可取代目前 ICTA 架構：不建議。", 52, 608, 508, 10);

// Page 8
doc.addPage();
header("來源與限制", 8);
title("資料來源", 90, 22);
const sources = [
  ["[1] Bombmy 官方網站", "https://www.bombmy.live/"],
  ["[2] Bombmy 免費體驗入口", "https://bo-get.com/bombmygw"],
  ["[3] Webinar-Sales-Funnel 原始碼", "https://github.com/UmeshChandra05/Webinar-Sales-Funnel"],
  ["[4] GitHub repository metadata API", "https://api.github.com/repos/UmeshChandra05/Webinar-Sales-Funnel"],
  ["[5] ICTA Webinar 內部程式碼稽核", "本工作區：routes、schema、播放器、analytics、email scheduler、Stripe entitlement 與營運文件"],
];
y=132;
sources.forEach(([l,u])=>{
  doc.setTextColor(...NAVY); doc.setFontSize(10); doc.text(l,M,y);
  paragraph(u,M,y+18,540,8,SLATE); y+=74;
});
title("重要限制", 520, 17);
paragraph("• Bombmy profile 主要根據官方首頁文案；缺乏足量獨立評論與公開價格，因此不可把行銷成效聲明視為第三方驗證。\n• Bombmy 登入後功能、實際事件粒度、寄信到達率與金流商清單未經帳號實測。\n• GitHub 專案 metadata 截至 2026-09-03：2 stars、0 forks、最後推送 2025-11-19、未偵測到正式 LICENSE 檔。\n• ICTA 完成度依程式碼與路由稽核；標記「部分」通常代表資料模型／UI 已存在，但事件收集或端到端商業流程未完全閉環。\n• 時程估算高度依賴團隊人數、金流審核、LINE／SMS 供應商與實際產品決策速度。", M, 548, 540, 9.2, SLATE);

doc.save(OUT);
console.log(OUT);