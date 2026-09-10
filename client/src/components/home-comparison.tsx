import type { LangFull } from "@/hooks/use-lang";
import "./home-comparison.css";

type ComparisonCopy = {
  eyebrow: string;
  title: string;
  lead: string;
  note: string;
  scrollHint: string;
  rowHeading: string;
  columns: [string, string, string];
  tags: [string, string, string];
  rows: { label: string; values: [string, string, string] }[];
  footer: string;
};

const copy: Record<LangFull, ComparisonCopy> = {
  "zh-TW": {
    eyebrow: "選擇適合這一場的形式",
    title: "不是取代直播，\n是讓好內容有更多上場時間。",
    lead: "每一種形式都有它最擅長的時刻。若你希望一套成熟的銷講能在不同時區、不同節奏裡繼續接住新觀眾，SellCase 可以補上直播後的那一段。",
    note: "以下比較常見使用方式，實際體驗依流程與串接工具而異。AI 助教需使用 AI 點數，試用期間不含贈送點數。",
    scrollHint: "左右滑動表格，查看三種形式的差異",
    rowHeading: "比較項目",
    columns: ["現場直播", "一般影片", "SellCase 自動銷講"],
    tags: ["即時共創", "自由觀看", "可設計的重複旅程"],
    rows: [
      { label: "觀看時段", values: ["依主持人排定時段", "通常可隨時播放", "可排定、循環或隨選報名觀看"] },
      { label: "當下互動", values: ["主持人可即時回應", "通常沒有即時引導", "依設定送出定時聊天、互動與 CTA；AI 助教可協助回覆"] },
      { label: "重複使用", values: ["多半需每次重新開播", "影片可重複播放", "同一場內容可依排程反覆開場"] },
      { label: "報名與後續", values: ["通常需另外整理名單與跟進", "常仰賴外部表單或行銷工具", "提供 Webinar 報名選項，並可由會員設定後續 Email"] },
      { label: "商品下一步", values: ["主持人可口頭或手動引導", "常在說明欄或外部頁面放連結", "可在合適時點顯示 CTA，連至會員自有 ECPay 商品結帳"] },
      { label: "適合用在", values: ["即時問答、社群交流、現場發表", "作品集、說明素材、單純內容觀看", "重複銷講、課程說明、需要持續接待新名單的內容"] },
    ],
    footer: "需要真人交流時，就安排現場直播。重複的銷講與後續流程，交給 SellCase 在你不開播時持續執行。",
  },
  "zh-CN": {
    eyebrow: "选择适合这一场的形式",
    title: "不是取代直播，\n是让好内容有更多登场时间。",
    lead: "每一种形式都有它最擅长的时刻。若您希望一套成熟的销讲能在不同时区、不同节奏里继续接住新观众，SellCase 可以补上直播后的那一段。",
    note: "以下比较常见使用方式，实际体验依流程与串接工具而异。AI 助教需使用 AI 点数，试用期间不含赠送点数。",
    scrollHint: "左右滑动表格，查看三种形式的差异",
    rowHeading: "比较项目",
    columns: ["现场直播", "一般视频", "SellCase 自动销讲"],
    tags: ["即时共创", "自由观看", "可设计的重复旅程"],
    rows: [
      { label: "观看时段", values: ["依主持人排定时段", "通常可随时播放", "可排定、循环或随选报名观看"] },
      { label: "当下互动", values: ["主持人可即时回应", "通常没有即时引导", "依设置送出定时聊天、互动与 CTA；AI 助教可协助回复"] },
      { label: "重复使用", values: ["多半需每次重新开播", "视频可重复播放", "同一场内容可依排程反复开场"] },
      { label: "报名与后续", values: ["通常需另外整理名单与跟进", "常仰赖外部表单或营销工具", "提供 Webinar 报名选项，并可由会员设置后续 Email"] },
      { label: "商品下一步", values: ["主持人可口头或手动引导", "常在说明栏或外部页面放链接", "可在合适时点显示 CTA，连至会员自有 ECPay 商品结账"] },
      { label: "适合用在", values: ["即时问答、社群交流、现场发布", "作品集、说明素材、单纯内容观看", "重复销讲、课程说明、需要持续接待新名单的内容"] },
    ],
    footer: "需要真人交流时，就安排现场直播。重复的销讲与后续流程，交给 SellCase 在您不开播时持续执行。",
  },
  en: {
    eyebrow: "Choose the format for this moment",
    title: "Not a replacement for live.\nA longer life for great content.",
    lead: "Every format has a job it does beautifully. When a proven presentation needs to welcome new people across time zones and schedules, SellCase can carry the part after the live moment.",
    note: "Common workflows are compared; capabilities depend on your setup and connected tools. The AI assistant uses AI points; trials do not include gifted points.",
    scrollHint: "Scroll sideways to compare all three formats",
    rowHeading: "Compare",
    columns: ["Live session", "Standard video", "SellCase automated webinar"],
    tags: ["Shared in the moment", "Watch at will", "A repeatable journey"],
    rows: [
      { label: "Attendance timing", values: ["Set around a host’s schedule", "Usually available to play any time", "Scheduled, recurring, or on-demand registration options"] },
      { label: "In-the-moment interaction", values: ["A host can respond live", "Usually has no live guidance", "Timed chat, interaction, and CTAs can be configured; an AI assistant can help answer"] },
      { label: "Repeat availability", values: ["Often needs a new live session each time", "The video can be replayed", "One presentation can reopen on a chosen schedule"] },
      { label: "Registration & follow-up", values: ["Lists and follow-up are often handled separately", "Often relies on external forms or marketing tools", "Webinar registration options plus member-configured follow-up emails"] },
      { label: "Product next step", values: ["The host can introduce it live or manually", "Links often sit in the description or elsewhere", "A CTA can appear at the right moment and link to member-owned ECPay product checkout"] },
      { label: "A good fit for", values: ["Questions, community, high-touch launches", "Portfolios, explainers, straightforward viewing", "Repeat presentations, course explainers, and welcoming new leads over time"] },
    ],
    footer: "Choose a live session when personal conversation matters. Let SellCase handle repeat presentations and configured follow-up when you are not broadcasting.",
  },
};

export function HomeComparison({ lang }: { lang: LangFull }) {
  const c = copy[lang];
  return (
    <section className="sc-compare" id="compare" aria-labelledby="compare-title">
      <div className="sc-compare-intro">
        <p className="sc-kicker">{c.eyebrow}</p>
        <h2 id="compare-title">{c.title.split("\n").map((line, index) => <span key={line}>{line}{index === 0 && <br />}</span>)}</h2>
        <p>{c.lead}</p>
      </div>
      <p className="sc-compare-scroll-hint" id="compare-scroll-hint">{c.scrollHint}</p>
      <div className="sc-compare-frame">
        <div className="sc-compare-scroll" role="region" aria-labelledby="compare-title" aria-describedby="compare-scroll-hint" tabIndex={0}>
          <table>
            <caption>{c.note}</caption>
            <thead>
              <tr>
                <th scope="col"><span>{c.rowHeading}</span></th>
                {c.columns.map((column, index) => <th scope="col" key={column} className={index === 2 ? "is-sellcase" : ""}><b>{column}</b><small>{c.tags[index]}</small></th>)}
              </tr>
            </thead>
            <tbody>
              {c.rows.map((row) => <tr key={row.label}>
                <th scope="row">{row.label}</th>
                {row.values.map((value, index) => <td key={value} className={index === 2 ? "is-sellcase" : ""}>{value}</td>)}
              </tr>)}
            </tbody>
          </table>
        </div>
      </div>
      <p className="sc-compare-outro">{c.footer}</p>
    </section>
  );
}