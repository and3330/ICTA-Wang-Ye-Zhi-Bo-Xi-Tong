import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useLocation } from "wouter";
import { ArrowRight, CalendarDays, Check, ChevronDown, CirclePlay, Clock3, Globe2, Languages, LayoutPanelTop, MessageSquareText, Radio, Sparkles, TimerReset, Video, Vote } from "lucide-react";
import { useLang, type LangFull } from "@/hooks/use-lang";
import workflowImage from "@assets/generated_images/icta-webinar-workflow.png";

type Lang = LangFull;
const languages: Record<Lang, string> = { "zh-TW": "繁體中文", "zh-CN": "简体中文", en: "English" };

const copy = {
  en: {
    nav: ["Why ICTA", "How it works", "Plans"], signIn: "Sign in", start: "Create a room",
    eyebrow: "AI-POWERED AUTOMATED WEBINARS", title: "Let AI welcome every viewer—", titleAccent: "even while you sleep.",
    desc: "Turn one proven presentation into an always-on customer journey. ICTA Webinar combines your Vimeo video with an AI assistant, automated sessions, timed interactions, and calls to action—so audiences can keep learning and moving toward a decision while you focus on higher-value work.",
    primary: "Build my AI webinar", secondary: "See how AI works", note: "Start with your Vimeo video",
    studioTag: "WEBINAR ROOM · PREVIEW", nowPlaying: "Now playing", videoTitle: "Teach with a clear next step", chat: "Conversation", interaction: "Timed interaction",
    chat1: "The walkthrough makes the setup much clearer.", chat2: "Saved the next session to my calendar.", poll: "Where should we go deeper?", poll1: "Video setup", poll2: "Audience interaction",
    trustedTitle: "Your presentation teaches. AI stays online to help it convert.", trustedDesc: "Even when you are offline, the system can accept registrations, deliver your message, answer common questions, guide interaction, and present the next step—creating more opportunities without repeating the same work.",
    examples: [
      ["An AI assistant that stays online", "Let AI respond to viewer questions in your voice while your recorded presentation does the teaching."],
      ["Automation that saves hours", "Schedule sessions, release messages and polls, and show calls to action without operating every webinar yourself."],
      ["A journey that keeps working", "Share one registration destination and let each new viewer move from interest to the right next step, around the clock."]
    ],
    systemKicker: "AI + AUTOMATION, ALWAYS ON", systemTitle: "Build the webinar once. Let AI and automation keep it working.", systemDesc: "ICTA Webinar connects registration, scheduled or on-demand viewing, AI-assisted Q&A, timed engagement, and calls to action into one automated journey that keeps serving prospects—even outside your working hours.",
    flow: [["01", "Add your best presentation", "Turn your Vimeo recording into a webinar room that can run repeatedly."], ["02", "Add AI and conversion moments", "Set AI assistance, timed messages, polls, content cards, and calls to action."], ["03", "Publish your always-on journey", "Offer recurring sessions or on-demand access, then let the system welcome each new viewer."]],
    featureKicker: "YOUR AI WEBINAR TEAM", featureTitle: "Automate the repetitive work without losing the human touch.",
    features: [["AI audience assistant", "Give viewers helpful answers while your presentation continues to teach."], ["Automated conversation", "Release prepared messages at the right moments without being online."], ["Interactive checkpoints", "Ask a poll or show a content card while the topic is fresh."], ["Conversion calls to action", "Present the next step when viewers have the right context."], ["Always-on scheduling", "Offer recurring sessions or on-demand viewing across different schedules."], ["Site-ready embeds", "Bring registration and viewing into your existing site."]],
    priceKicker: "STRAIGHTFORWARD PRICING", priceTitle: "Scale your webinar library as you grow.", priceDesc: "Every plan includes ICTA's automated scheduling, AI assistant, interactions, email notifications, analytics, and unlimited recurring sessions.", plan1: "Starter", plan2: "Growth", plan3: "Scale", plan1Desc: "For launching your first automated webinar.", plan2Desc: "For companies ready to expand.", plan3Desc: "For scaling a complete webinar library.", rooms: "active webinars", registrants: "registrants / month", included: "Most popular", perMonth: "/ month", select: "Choose this plan", addon: "Need more capacity? Add an active webinar for $20 USD per month.",
    workflowAlt: "A webinar producer plans video interactions and schedules a viewing room for an audience", flowLabels: ["Vimeo video", "Timed moments", "Scheduled room"], backTop: "Back to top",
    finalTitle: "Let AI keep your webinar working—even while you rest.", finalDesc: "Build once, save time, and give every new viewer an automated path from registration to the next step.", finalCta: "Build my AI webinar", seo: "ICTA Webinar — AI-powered automated webinar system"
  },
  "zh-TW": {
    nav: ["為何選擇 ICTA", "運作方式", "方案"], signIn: "登入", start: "建立直播間",
    eyebrow: "AI 驅動的自動化研討會", title: "AI 自動化研討會系統：", titleAccent: "讓你 24 小時銷售不間斷",
    desc: "把一場最有說服力的簡報，變成全天候運作的客戶旅程。ICTA Webinar 結合 Vimeo 影片、AI 助教、自動排程、定時互動與行動呼籲，讓觀眾持續了解、信任並採取下一步，您不必每一場都親自上線。",
    primary: "開始打造 AI 研討會", secondary: "了解 AI 如何運作", note: "使用您的 Vimeo 影片即可開始",
    studioTag: "研討會直播間 · 預覽", nowPlaying: "正在播放", videoTitle: "用清楚的下一步完成教學", chat: "觀眾對話", interaction: "定時互動",
    chat1: "這個示範讓設定方式清楚多了。", chat2: "我已將下一場加到行事曆。", poll: "您想深入了解哪個部分？", poll1: "影片設定", poll2: "觀眾互動",
    trustedTitle: "除了精彩的直播研討會，AI 持續在線協助成交", trustedDesc: "即使您正在休息，系統仍能接受報名、播放內容、回答常見問題、引導互動並帶出下一步，減少重複工作，也不錯過新的商業機會。",
    examples: [["全天在線的 AI 助教", "讓 AI 依照您的內容即時回答觀眾問題，預錄簡報則專心完成教學與說服。"], ["替您省下時間的自動化", "自動安排場次、發送訊息、推出投票與行動呼籲，不必每一場都親自操作。"], ["持續運作的轉換旅程", "只需分享一個報名入口，讓每位新觀眾全天候從興趣走向最適合的下一步。"]],
    systemKicker: "AI＋自動化，全天候運作", systemTitle: "打造一次，讓 AI 與自動化流程持續為您工作。", systemDesc: "ICTA Webinar 串接報名、排程或隨到隨看、AI 問答、定時互動與行動呼籲，形成一套即使在您休息時，也能持續服務潛在客戶的自動化旅程。",
    flow: [["01", "加入最有說服力的簡報", "把 Vimeo 預錄內容變成可重複運作的研討會直播間。"], ["02", "加入 AI 與成交節點", "設定 AI 助教、定時訊息、投票、內容卡與行動呼籲。"], ["03", "發布全天候客戶旅程", "提供循環場次或隨到隨看，讓系統自動接待每一位新觀眾。"]],
    featureKicker: "您的 AI 研討會團隊", featureTitle: "把重複工作交給自動化，同時保留有溫度的互動。",
    features: [["AI 觀眾助教", "簡報持續教學時，由 AI 即時協助回答觀眾問題。"], ["自動化觀眾對話", "即使不在線，也能在指定時間呈現預先安排的訊息。"], ["互動檢核點", "趁主題仍在觀眾心中時發起投票或顯示內容卡。"], ["轉換行動呼籲", "在觀眾最理解價值的時刻，自動帶出適合的下一步。"], ["全天候彈性排程", "提供循環場次或隨到隨看，配合不同觀眾的時間。"], ["網站嵌入", "把報名與觀看流程帶進您既有的網站。"]],
    priceKicker: "清楚計價", priceTitle: "依成長階段擴充您的 Webinar 內容庫。", priceDesc: "所有方案均包含自動排程、AI 助教、互動功能、Email 通知、成效分析與無限循環場次。", plan1: "入門版", plan2: "成長版", plan3: "規模版", plan1Desc: "適合開始經營第一個自動化 Webinar。", plan2Desc: "適合準備擴大 Webinar 計畫的公司。", plan3Desc: "適合建立完整 Webinar 內容庫的團隊。", rooms: "個啟用中的 Webinar", registrants: "位報名者／月", included: "最多人選擇", perMonth: "/月", select: "選擇此方案", addon: "需要更多額度？每增加一個啟用中的 Webinar 為 $20 USD／月。",
    workflowAlt: "研討會製作人正在安排影片互動、播放時程與觀眾觀看流程", flowLabels: ["Vimeo 影片", "定時互動", "排程直播間"], backTop: "回到頂部",
    finalTitle: "讓 AI 持續推動研討會，即使您正在休息。", finalDesc: "打造一次、節省時間，讓每位新觀眾都能自動從報名走向下一步。", finalCta: "開始打造 AI 研討會", seo: "ICTA Webinar — AI 驅動的自動化研討會系統"
  },
  "zh-CN": {
    nav: ["为何选择 ICTA", "运作方式", "方案"], signIn: "登录", start: "创建直播间",
    eyebrow: "AI 驱动的自动化研讨会", title: "让 AI 替您接待观众，", titleAccent: "即使休息，也持续推进成交。",
    desc: "把一场最有说服力的演示，变成全天候运行的客户旅程。ICTA Webinar 结合 Vimeo 视频、AI 助教、自动排期、定时互动与行动号召，让观众持续了解、信任并采取下一步，您不必每一场都亲自上线。",
    primary: "开始打造 AI 研讨会", secondary: "了解 AI 如何运作", note: "使用您的 Vimeo 视频即可开始",
    studioTag: "研讨会直播间 · 预览", nowPlaying: "正在播放", videoTitle: "用清晰的下一步完成教学", chat: "观众对话", interaction: "定时互动",
    chat1: "这个演示让设置方式清楚多了。", chat2: "我已将下一场加到日历。", poll: "您想深入了解哪个部分？", poll1: "视频设置", poll2: "观众互动",
    trustedTitle: "您的演示负责说服，AI 持续在线协助成交。", trustedDesc: "即使您正在休息，系统仍能接受报名、播放内容、回答常见问题、引导互动并带出下一步，减少重复工作，也不错过新的商业机会。",
    examples: [["全天在线的 AI 助教", "让 AI 根据您的内容即时回答观众问题，预录演示则专心完成教学与说服。"], ["替您节省时间的自动化", "自动安排场次、发送消息、推出投票与行动号召，不必每一场都亲自操作。"], ["持续运行的转化旅程", "只需分享一个报名入口，让每位新观众全天候从兴趣走向最适合的下一步。"]],
    systemKicker: "AI＋自动化，全天候运行", systemTitle: "打造一次，让 AI 与自动化流程持续为您工作。", systemDesc: "ICTA Webinar 串接报名、排期或随到随看、AI 问答、定时互动与行动号召，形成一套即使在您休息时，也能持续服务潜在客户的自动化旅程。",
    flow: [["01", "添加最有说服力的演示", "把 Vimeo 预录内容变成可重复运行的研讨会直播间。"], ["02", "加入 AI 与成交节点", "设置 AI 助教、定时消息、投票、内容卡与行动号召。"], ["03", "发布全天候客户旅程", "提供循环场次或随到随看，让系统自动接待每一位新观众。"]],
    featureKicker: "您的 AI 研讨会团队", featureTitle: "把重复工作交给自动化，同时保留有温度的互动。",
    features: [["AI 观众助教", "演示持续教学时，由 AI 即时协助回答观众问题。"], ["自动化观众对话", "即使不在线，也能在指定时间呈现预先安排的消息。"], ["互动检查点", "趁主题仍在观众心中时发起投票或显示信息卡。"], ["转化行动号召", "在观众最理解价值的时刻，自动带出适合的下一步。"], ["全天候灵活排期", "提供循环场次或随到随看，配合不同观众的时间。"], ["网站嵌入", "将报名与观看流程带进您现有的网站。"]],
    priceKicker: "清晰计价", priceTitle: "按成长阶段扩展您的 Webinar 内容库。", priceDesc: "所有方案均包含自动排期、AI 助教、互动功能、Email 通知、成效分析与无限循环场次。", plan1: "入门版", plan2: "成长版", plan3: "规模版", plan1Desc: "适合开始经营第一个自动化 Webinar。", plan2Desc: "适合准备扩大 Webinar 计划的公司。", plan3Desc: "适合建立完整 Webinar 内容库的团队。", rooms: "个启用中的 Webinar", registrants: "位报名者／月", included: "最多人选择", perMonth: "/月", select: "选择此方案", addon: "需要更多额度？每增加一个启用中的 Webinar 为 $20 USD／月。",
    workflowAlt: "研讨会制作人正在安排视频互动、播放排期与观众观看流程", flowLabels: ["Vimeo 视频", "定时互动", "排期直播间"], backTop: "返回顶部",
    finalTitle: "让 AI 持续推动研讨会，即使您正在休息。", finalDesc: "打造一次、节省时间，让每位新观众都能自动从报名走向下一步。", finalCta: "开始打造 AI 研讨会", seo: "ICTA Webinar — AI 驱动的自动化研讨会系统"
  }
} as const;

const icons = [Video, MessageSquareText, Vote, CirclePlay, CalendarDays, Globe2];

export default function Landing() {
  const [, setLocation] = useLocation();
  const { lang, setLang } = useLang();
  const [langOpen, setLangOpen] = useState(false);
  const languageTriggerRef = useRef<HTMLButtonElement>(null);
  const languageMenuRef = useRef<HTMLDivElement>(null);
  const s = copy[lang];
  const goAdmin = useCallback(() => setLocation("/admin"), [setLocation]);
  useEffect(() => { document.title = s.seo; document.documentElement.lang = lang; document.querySelector('meta[name="description"]')?.setAttribute("content", s.desc); }, [lang, s]);
  useEffect(() => {
    if (langOpen) requestAnimationFrame(() => languageMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus());
  }, [langOpen]);

  const handleLanguageMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(languageMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") {
      event.preventDefault();
      setLangOpen(false);
      languageTriggerRef.current?.focus();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const offset = event.key === "ArrowDown" ? 1 : -1;
      items[(current + offset + items.length) % items.length]?.focus();
    }
  };

  return <main className="icta-home">
    <nav className="ih-nav" aria-label="Main navigation">
      <a href="#top" className="ih-brand" aria-label="ICTA Webinar home"><span className="ih-mark"><i /><i /><i /></span><span>ICTA <b>WEBINAR</b></span></a>
      <div className="ih-links">{["why", "workflow", "pricing"].map((id, i) => <a href={`#${id}`} key={id}>{s.nav[i]}</a>)}</div>
      <div className="ih-nav-actions"><div className="ih-language"><button ref={languageTriggerRef} onClick={() => setLangOpen(v => !v)} aria-expanded={langOpen} aria-haspopup="menu" aria-controls="icta-language-menu" aria-label="Change language"><Languages size={16} />{lang === "en" ? "EN" : lang === "zh-TW" ? "繁" : "简"}<ChevronDown size={13} /></button>{langOpen && <div id="icta-language-menu" ref={languageMenuRef} role="menu" onKeyDown={handleLanguageMenuKeyDown}>{(Object.keys(languages) as Lang[]).map(l => <button role="menuitem" key={l} className={l === lang ? "selected" : ""} onClick={() => { setLang(l); setLangOpen(false); languageTriggerRef.current?.focus(); }}>{languages[l]} {l === lang && <Check size={14} />}</button>)}</div>}</div><button className="ih-signin" onClick={goAdmin}>{s.signIn}</button><button className="ih-button small" onClick={goAdmin}>{s.start}<ArrowRight size={15} /></button></div>
    </nav>

    <section id="top" className="ih-hero">
      <div className="ih-hero-copy"><p className="ih-kicker"><Radio size={14} />{s.eyebrow}</p><h1>{s.title}<span>{s.titleAccent}</span></h1><p className="ih-lead">{s.desc}</p><div className="ih-hero-actions"><button className="ih-button" onClick={goAdmin}>{s.primary}<ArrowRight size={18} /></button><a className="ih-quiet-button" href="#workflow"><LayoutPanelTop size={18} />{s.secondary}</a></div><p className="ih-note"><Check size={15} />{s.note}<i /><Check size={15} />{s.nav[1]}</p></div>
      <div className="ih-preview" aria-label="Webinar room example"><div className="ih-preview-top"><span><i />{s.studioTag}</span><span>ROOM / 01</span></div><div className="ih-screen"><div className="ih-screen-lines" /><div className="ih-playing"><small>{s.nowPlaying}</small><strong>{s.videoTitle}</strong><span>18:42 / 42:00</span></div><CirclePlay className="ih-play" /></div><div className="ih-progress"><b /></div><div className="ih-preview-bottom"><div className="ih-chat"><h3><MessageSquareText size={15} />{s.chat}<b>12</b></h3><p><i className="a" />{s.chat1}<small>18:44</small></p><p><i className="b" />{s.chat2}<small>18:47</small></p></div><div className="ih-poll"><small><TimerReset size={13} />{s.interaction}</small><strong>{s.poll}</strong><span>{s.poll1}<ArrowRight size={14} /></span><span>{s.poll2}<ArrowRight size={14} /></span></div></div></div>
    </section>

    <section id="why" className="ih-intro"><div><p className="ih-kicker">{s.eyebrow}</p><h2>{s.trustedTitle}</h2><p>{s.trustedDesc}</p></div><div className="ih-example-grid">{s.examples.map(([title, desc], i) => { const Icon = [Clock3, Sparkles, Globe2][i]; return <article key={title}><Icon size={21} /><h3>{title}</h3><p>{desc}</p></article>; })}</div></section>

    <section id="workflow" className="ih-workflow"><div className="ih-work-copy"><p className="ih-kicker">{s.systemKicker}</p><h2>{s.systemTitle}</h2><p>{s.systemDesc}</p><div className="ih-steps">{s.flow.map(([no, title, desc]) => <article key={no}><b>{no}</b><div><h3>{title}</h3><p>{desc}</p></div></article>)}</div></div><figure><img src={workflowImage} alt={s.workflowAlt} /><figcaption><span><Video size={15} />{s.flowLabels[0]}</span><ArrowRight size={15} /><span><TimerReset size={15} />{s.flowLabels[1]}</span><ArrowRight size={15} /><span><CalendarDays size={15} />{s.flowLabels[2]}</span></figcaption></figure></section>

    <section className="ih-features"><div className="ih-center-title"><p className="ih-kicker">{s.featureKicker}</p><h2>{s.featureTitle}</h2></div><div className="ih-feature-grid">{s.features.map(([title, desc], i) => { const Icon = icons[i]; return <article key={title}><span><Icon size={20} /></span><h3>{title}</h3><p>{desc}</p></article>; })}</div></section>

    <section id="pricing" className="ih-pricing"><div className="ih-center-title"><p className="ih-kicker">{s.priceKicker}</p><h2>{s.priceTitle}</h2><p>{s.priceDesc}</p></div><div className="ih-plans">{[["$49", "1", "1,000", "100", s.plan1, s.plan1Desc], ["$99", "5", "3,000", "200", s.plan2, s.plan2Desc], ["$199", "15", "5,000", "300", s.plan3, s.plan3Desc]].map(([price, rooms, registrants, aiPoints, title, desc], i) => <article className={i === 1 ? "featured" : ""} key={price}><small>{i === 1 ? s.included : "ICTA Webinar"}</small><h3>{title}</h3><p>{desc}</p><div className="ih-price"><b>{price}</b><span>USD {s.perMonth}</span></div><div className="ih-room"><strong>{rooms}</strong><span>{s.rooms}</span></div><div className="ih-room"><strong>{registrants}</strong><span>{s.registrants}</span></div><div className="ih-room"><strong>{aiPoints}</strong><span>{lang === "en" ? "AI points / month" : lang === "zh-TW" ? "AI 點數／月" : "AI 点数／月"}</span></div><button className="ih-plan-button" onClick={goAdmin}>{s.select}<ArrowRight size={16} /></button></article>)}</div><p className="ih-addon"><Sparkles size={17} />{s.addon}</p></section>

    <section className="ih-final"><div><p className="ih-kicker"><Radio size={14} />ICTA WEBINAR</p><h2>{s.finalTitle}</h2><p>{s.finalDesc}</p><button className="ih-button" onClick={goAdmin}>{s.finalCta}<ArrowRight size={18} /></button></div><div className="ih-final-orbit"><i /><i /><i /></div></section>
    <footer><span>ICTA <b>WEBINAR</b></span><span className="flex items-center gap-4"><a href="/legal/terms">服務條款</a><a href="/legal/privacy">隱私權</a><a href="/legal/refunds">退款政策</a></span><a href="#top">{s.backTop} <ArrowRight size={14} /></a></footer>
  </main>;
}