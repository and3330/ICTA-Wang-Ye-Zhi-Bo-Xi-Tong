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
    eyebrow: "THE AUTOMATED WEBINAR STUDIO", title: "Set the room once.", titleAccent: "Keep the lesson in motion.",
    desc: "ICTA Webinar turns your Vimeo recording into a scheduled, guided viewing experience. Prepare the moments that matter, then welcome every audience without being in the room.",
    primary: "Create a webinar room", secondary: "See the studio flow", note: "Built for Vimeo video",
    studioTag: "WEBINAR ROOM · PREVIEW", nowPlaying: "Now playing", videoTitle: "Teach with a clear next step", chat: "Conversation", interaction: "Timed interaction",
    chat1: "The walkthrough makes the setup much clearer.", chat2: "Saved the next session to my calendar.", poll: "Where should we go deeper?", poll1: "Video setup", poll2: "Audience interaction",
    trustedTitle: "A clear broadcast system for the work you already do.", trustedDesc: "For educators running a course launch, creators teaching their process, and teams presenting a repeatable story.",
    examples: [
      ["Teach on your schedule", "Record your lesson once, then offer sessions that fit different time zones and calendars."],
      ["Guide attention with timing", "Place conversation, polls, information cards, and calls to action exactly where they support the lesson."],
      ["Give viewers one destination", "Share a registration link or embed the experience on the site your audience already knows."]
    ],
    systemKicker: "A RUN OF SHOW, MADE VISIBLE", systemTitle: "Everything that happens around the video is planned here.", systemDesc: "Use your recording as the backbone. ICTA Webinar carries the audience through a considered sequence—from registration to the final next step.",
    flow: [["01", "Add your Vimeo video", "Start with the recording you want viewers to see."], ["02", "Build the viewing path", "Arrange timed messages, polls, content cards, and calls to action."], ["03", "Schedule and share", "Set recurring sessions or on-demand access, then publish your registration link."]],
    featureKicker: "THE STUDIO SHELF", featureTitle: "The tools behind a composed viewing experience.",
    features: [["Video-led rooms", "Keep your Vimeo recording at the center of every webinar room."], ["Timed conversation", "Release chat messages at the moments you choose."], ["Interactive checkpoints", "Ask a poll or show a content card while the topic is fresh."], ["Calls to action", "Present a next step when the context is right."], ["Flexible scheduling", "Offer recurring sessions or make a webinar available on demand."], ["Site-ready embeds", "Bring registration and viewing into your existing site."]],
    priceKicker: "STRAIGHTFORWARD PRICING", priceTitle: "Choose the number of rooms your program needs.", priceDesc: "Each room gives you a dedicated place to organise a webinar experience.", plan1: "Studio", plan2: "Program", plan1Desc: "For a focused series or core offer.", plan2Desc: "For a growing calendar of webinars.", rooms: "webinar rooms", included: "Included", perMonth: "/ month", select: "Choose this plan", addon: "Additional webinar rooms are $20 USD per room, per month.",
    workflowAlt: "A webinar producer plans video interactions and schedules a viewing room for an audience", flowLabels: ["Vimeo video", "Timed moments", "Scheduled room"], backTop: "Back to top",
    finalTitle: "Your best session can keep showing up.", finalDesc: "Build a webinar room that gives every viewer the same clear path.", finalCta: "Open the studio", seo: "ICTA Webinar — Automated webinar studio"
  },
  "zh-TW": {
    nav: ["為何選擇 ICTA", "運作方式", "方案"], signIn: "登入", start: "建立直播間",
    eyebrow: "自動化研討會工作室", title: "一次設計好直播間。", titleAccent: "讓內容持續精準播出。",
    desc: "ICTA Webinar 將您的 Vimeo 預錄影片轉為可排程、可引導的觀看體驗。安排重要的互動時刻，無論您是否在線，每位觀眾都能順著同一條清楚路徑前進。",
    primary: "建立研討會直播間", secondary: "查看工作流程", note: "支援 Vimeo 影片",
    studioTag: "研討會直播間 · 預覽", nowPlaying: "正在播放", videoTitle: "用清楚的下一步完成教學", chat: "觀眾對話", interaction: "定時互動",
    chat1: "這個示範讓設定方式清楚多了。", chat2: "我已將下一場加到行事曆。", poll: "您想深入了解哪個部分？", poll1: "影片設定", poll2: "觀眾互動",
    trustedTitle: "讓既有內容成為條理分明的播出系統。", trustedDesc: "適合開設課程的教育者、分享專業的創作者，以及需要重複傳達核心內容的團隊。",
    examples: [["依您的時程授課", "錄製一次課程，再依不同時區與行事曆安排播放場次。"], ["用時間引導注意力", "在最適合的時間點安排對話、投票、資訊卡與行動呼籲。"], ["給觀眾一個明確入口", "分享報名連結，或將體驗嵌入觀眾熟悉的網站。"]],
    systemKicker: "清楚呈現播出流程", systemTitle: "影片以外的每個環節，都能在此預先安排。", systemDesc: "以錄製影片為主軸，ICTA Webinar 串起從報名、觀看到最後下一步的完整體驗。",
    flow: [["01", "加入 Vimeo 影片", "從您希望觀眾觀看的錄製內容開始。"], ["02", "安排觀看路徑", "設定定時訊息、投票、內容卡與行動呼籲。"], ["03", "排程並分享", "設定循環場次或隨選觀看，接著發布報名連結。"]],
    featureKicker: "工作室工具", featureTitle: "打造從容觀看體驗的每一項工具。",
    features: [["影片核心直播間", "讓 Vimeo 預錄影片成為每一場研討會的中心。"], ["定時觀眾對話", "在您指定的時間點呈現聊天訊息。"], ["互動檢核點", "趁主題仍在觀眾心中時發起投票或顯示內容卡。"], ["行動呼籲", "在脈絡最恰當的時刻帶出下一步。"], ["彈性排程", "提供循環場次，也可開放隨選觀看。"], ["網站嵌入", "把報名與觀看流程帶進您既有的網站。"]],
    priceKicker: "清楚計價", priceTitle: "依您需要的直播間數量選擇方案。", priceDesc: "每個直播間都是一個完整規劃研討會體驗的專屬空間。", plan1: "工作室", plan2: "節目方案", plan1Desc: "適合專注經營的系列內容或核心課程。", plan2Desc: "適合持續增加場次的研討會計畫。", rooms: "個研討會直播間", included: "包含", perMonth: "/月", select: "選擇此方案", addon: "每增加一個研討會直播間，費用為 $20 USD／月。",
    workflowAlt: "研討會製作人正在安排影片互動、播放時程與觀眾觀看流程", flowLabels: ["Vimeo 影片", "定時互動", "排程直播間"], backTop: "回到頂部",
    finalTitle: "讓您最好的那一堂課，持續準時出席。", finalDesc: "建立一個研討會直播間，讓每位觀眾都走過同樣清楚的路徑。", finalCta: "開啟工作室", seo: "ICTA Webinar — 自動化研討會工作室"
  },
  "zh-CN": {
    nav: ["为何选择 ICTA", "运作方式", "方案"], signIn: "登录", start: "创建直播间",
    eyebrow: "自动化研讨会工作室", title: "一次设计好直播间。", titleAccent: "让内容持续精准播出。",
    desc: "ICTA Webinar 将您的 Vimeo 预录视频转为可排期、可引导的观看体验。安排重要互动时刻，无论您是否在线，每位观众都能沿着同一条清晰路径前进。",
    primary: "创建研讨会直播间", secondary: "查看工作流程", note: "支持 Vimeo 视频",
    studioTag: "研讨会直播间 · 预览", nowPlaying: "正在播放", videoTitle: "用清晰的下一步完成教学", chat: "观众对话", interaction: "定时互动",
    chat1: "这个演示让设置方式清楚多了。", chat2: "我已将下一场加到日历。", poll: "您想深入了解哪个部分？", poll1: "视频设置", poll2: "观众互动",
    trustedTitle: "让既有内容成为条理分明的播出系统。", trustedDesc: "适合开设课程的教育者、分享专业的创作者，以及需要重复传达核心内容的团队。",
    examples: [["按您的日程授课", "录制一次课程，再根据不同时区与日历安排播放场次。"], ["用时间引导注意力", "在最适合的时间点安排对话、投票、信息卡与行动号召。"], ["给观众一个明确入口", "分享报名链接，或将体验嵌入观众熟悉的网站。"]],
    systemKicker: "清晰呈现播出流程", systemTitle: "视频以外的每个环节，都能在这里预先安排。", systemDesc: "以录制视频为主轴，ICTA Webinar 串起从报名、观看到最后下一步的完整体验。",
    flow: [["01", "添加 Vimeo 视频", "从您希望观众观看的录制内容开始。"], ["02", "安排观看路径", "设置定时消息、投票、内容卡与行动号召。"], ["03", "排期并分享", "设置循环场次或随选观看，然后发布报名链接。"]],
    featureKicker: "工作室工具", featureTitle: "打造从容观看体验的每一项工具。",
    features: [["视频核心直播间", "让 Vimeo 预录视频成为每一场研讨会的中心。"], ["定时观众对话", "在您指定的时间点呈现聊天消息。"], ["互动检查点", "趁主题仍在观众心中时发起投票或显示内容卡。"], ["行动号召", "在脉络最恰当的时刻带出下一步。"], ["灵活排期", "提供循环场次，也可开放随选观看。"], ["网站嵌入", "将报名与观看流程带进您现有的网站。"]],
    priceKicker: "清晰计价", priceTitle: "按需要的直播间数量选择方案。", priceDesc: "每个直播间都是一个完整规划研讨会体验的专属空间。", plan1: "工作室", plan2: "节目方案", plan1Desc: "适合专注经营的系列内容或核心课程。", plan2Desc: "适合持续增加场次的研讨会计划。", rooms: "个研讨会直播间", included: "包含", perMonth: "/月", select: "选择此方案", addon: "每增加一个研讨会直播间，费用为 $20 USD／月。",
    workflowAlt: "研讨会制作人正在安排视频互动、播放排期与观众观看流程", flowLabels: ["Vimeo 视频", "定时互动", "排期直播间"], backTop: "返回顶部",
    finalTitle: "让您最好的那堂课，持续准时出席。", finalDesc: "建立一个研讨会直播间，让每位观众都走过同样清晰的路径。", finalCta: "开启工作室", seo: "ICTA Webinar — 自动化研讨会工作室"
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

    <section id="pricing" className="ih-pricing"><div className="ih-center-title"><p className="ih-kicker">{s.priceKicker}</p><h2>{s.priceTitle}</h2><p>{s.priceDesc}</p></div><div className="ih-plans">{[["$49", "2", s.plan1, s.plan1Desc], ["$99", "5", s.plan2, s.plan2Desc]].map(([price, rooms, title, desc], i) => <article className={i === 1 ? "featured" : ""} key={price}><small>{i === 1 ? s.included : "ICTA Webinar"}</small><h3>{title}</h3><p>{desc}</p><div className="ih-price"><b>{price}</b><span>USD {s.perMonth}</span></div><div className="ih-room"><strong>{rooms}</strong><span>{s.rooms}</span></div><button className="ih-plan-button" onClick={goAdmin}>{s.select}<ArrowRight size={16} /></button></article>)}</div><p className="ih-addon"><Sparkles size={17} />{s.addon}</p></section>

    <section className="ih-final"><div><p className="ih-kicker"><Radio size={14} />ICTA WEBINAR</p><h2>{s.finalTitle}</h2><p>{s.finalDesc}</p><button className="ih-button" onClick={goAdmin}>{s.finalCta}<ArrowRight size={18} /></button></div><div className="ih-final-orbit"><i /><i /><i /></div></section>
    <footer><span>ICTA <b>WEBINAR</b></span><span>© {new Date().getFullYear()} ICTA Webinar</span><a href="#top">{s.backTop} <ArrowRight size={14} /></a></footer>
  </main>;
}