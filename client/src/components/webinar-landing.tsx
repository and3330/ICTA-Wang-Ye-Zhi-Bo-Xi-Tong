import { useEffect, useState } from "react";
import { SafeRichText } from "@/components/safe-rich-text";
import { ProviderPlayer } from "@/components/provider-player";
import { apiRequest } from "@/lib/queryClient";
import type { PlaybackSource } from "@/lib/media";
import { landingVideoEmbedUrl, parseLandingVideo } from "@shared/landingVideo";
import "../landing-page.css";

export type LandingBlock = { id?: string; type: string; enabled?: boolean; [key: string]: any };
type Brand = { primaryColor?: string; secondaryColor?: string; backgroundColor?: string } | null;

const safeImage = (value?: string) => Boolean(value && (value.startsWith("https://") || value.startsWith("/uploads/")));

export function LandingCountdown({ target, compact = false }: { target: number; compact?: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const ms = target - now;
  if (ms <= 0) return null;
  const values = [
    { v: Math.floor(ms / 86400000), l: "天" },
    { v: Math.floor((ms % 86400000) / 3600000), l: "時" },
    { v: Math.floor((ms % 3600000) / 60000), l: "分" },
    { v: Math.floor((ms % 60000) / 1000), l: "秒" },
  ];
  if (compact) return <span className="sticky-countdown"><span>距離開始</span><strong>{values[0].v > 0 ? `${values[0].v}天 ` : ""}{String(values[1].v).padStart(2, "0")}:{String(values[2].v).padStart(2, "0")}:{String(values[3].v).padStart(2, "0")}</strong></span>;
  return <div className="landing-countdown" data-testid="card-countdown"><div>{values.map((unit) => <b key={unit.l}><strong data-testid={`text-countdown-${unit.l}`}>{String(unit.v).padStart(2, "0")}</strong><small>{unit.l}</small></b>)}</div></div>;
}

export function WebinarLanding({ blocks, brand, title, description, onRegister, countdownTarget, mediaPlayback = {}, webinarId, mobile = false, preview = false, startTime, timezone = "Asia/Taipei" }: { blocks: LandingBlock[]; brand: Brand; title: string; description?: string; onRegister: () => void; countdownTarget?: number; mediaPlayback?: Record<string, PlaybackSource>; webinarId?: string; mobile?: boolean; preview?: boolean; startTime?: string | Date; timezone?: string }) {
  const list = blocks.filter((block) => block.enabled !== false);
  const sticky = list.find((block) => block.type === "stickyCta");
  const scroll = () => {
    onRegister();
    if (!preview) window.setTimeout(() => (document.getElementById("input-name") || document.querySelector<HTMLInputElement>('input[data-testid="input-name"]'))?.focus({ preventScroll: true }), 460);
  };
  const stickyTarget = sticky?.countdownMode === "fixed" && sticky.targetAt ? new Date(sticky.targetAt).getTime() : countdownTarget;
  const rootClass = `webinar-landing ${preview ? "landing-preview" : ""} ${mobile ? "mobile" : ""} ${sticky ? "has-sticky-cta" : ""}`;
  const eyebrow = (type: string) => ({ intro: "THE DECISION", audience: "WHO THIS IS FOR", agenda: "THE FRAMEWORK", instructor: "YOUR GUIDE", faq: "CLEAR THE DOUBTS", video: "A CLOSER LOOK" }[type] || "ONLINE MASTERCLASS");
  const heroTitle = (value: string) => {
    const split = value.split(/[，。！？\n]/).filter(Boolean);
    return split.length > 1 ? <>{split[0]}<br /><em>{split.slice(1).join("，")}</em></> : value;
  };
  const eventMeta = startTime ? `線上說明會・${new Intl.DateTimeFormat("zh-TW", { month: "long", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: timezone }).format(new Date(startTime))}` : "線上說明會";
  return <div className={rootClass} style={{ "--landing-primary": brand?.primaryColor || "#123d5a", "--landing-secondary": brand?.secondaryColor || "#d9a441", "--landing-background": brand?.backgroundColor || "#f5f4ef" } as React.CSSProperties}>
    {list.filter((block) => block.type !== "stickyCta").map((block, index) => {
      const key = block.id || `${block.type}-${index}`;
      if (block.type === "hero") return <section className="webinar-landing-hero" key={key}><div className="landing-hero-copy"><span className="webinar-kicker">{eventMeta}</span><h1>{heroTitle(block.headline || title)}</h1><p>{block.subheadline || description}</p><button onClick={scroll}>{block.ctaLabel || "立即報名"}</button><small>報名後將寄送參加方式</small></div><div className="landing-hero-visual">{safeImage(block.imageUrl) ? <img src={block.imageUrl} alt={title} /> : <div className="landing-hero-placeholder"><i /><span>LIVE SESSION</span><b>{title}</b></div>}<em>LIVE / 01</em></div></section>;
      if (block.type === "intro") return <section className="webinar-landing-section landing-intro" key={key}><div className="landing-section-heading"><span className="webinar-kicker">{eyebrow(block.type)}</span><h2>{block.headline || "關於這場說明會"}</h2></div><p>{block.content || description}</p></section>;
      if (block.type === "richText") return <section className="webinar-landing-section rich-text-preview" key={key}><SafeRichText value={block.body} /></section>;
      if (block.type === "video") {
        const parsed = parseLandingVideo(block.videoId || "", block.provider);
        const bunny = block.provider === "bunny" ? mediaPlayback[block.videoId] : undefined;
        return <section className="webinar-landing-section webinar-landing-video" key={key}><div className="landing-section-heading"><span className="webinar-kicker">{eyebrow(block.type)}</span>{block.headline && <h2>{block.headline}</h2>}</div><div className="video-frame">{bunny ? <ProviderPlayer source={{ ...bunny, assetId: block.videoId }} renewSource={async () => { const response = await apiRequest("GET", preview ? `/api/media/${block.videoId}/playback` : `/api/webinars/${webinarId}/landing-media/${block.videoId}/playback`); return { ...(await response.json()), assetId: block.videoId }; }} /> : parsed ? <iframe src={landingVideoEmbedUrl(parsed.provider, parsed.videoId)} title={block.headline || `${title} 活動介紹影片`} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen /> : <div className="video-frame-empty">{block.provider === "bunny" ? (preview ? "此自有影片目前無法安全預覽" : "影片目前無法播放") : "貼上有效的 YouTube 或 Vimeo 網址後顯示預覽"}</div>}</div></section>;
      }
      if (block.type === "audience" || block.type === "agenda") return <section className={`webinar-landing-section landing-${block.type}`} key={key}><div className="landing-section-heading"><span className="webinar-kicker">{eyebrow(block.type)}</span><h2>{block.headline}</h2></div><div className="webinar-landing-list">{(block.items || []).map((item: string, i: number) => <div key={`${item}-${i}`}><b>{String(i + 1).padStart(2, "0")}</b><span>{item}</span></div>)}</div></section>;
      if (block.type === "instructor") return <section className="webinar-landing-section webinar-instructor" key={key}><div className="landing-instructor-photo">{safeImage(block.imageUrl) ? <img src={block.imageUrl} alt={block.name || "講師"} /> : <span>{(block.name || "講").slice(0, 1)}</span>}</div><div><span className="webinar-kicker">{eyebrow(block.type)}</span><h2>{block.headline || "由走過現場的人，陪你看懂問題"}</h2><h3>{block.name}</h3><p>{block.bio}</p></div></section>;
      if (block.type === "faq") return <section className="webinar-landing-section webinar-faq" key={key}><div className="landing-section-heading"><span className="webinar-kicker">{eyebrow(block.type)}</span><h2>{block.headline || "常見問題"}</h2></div>{(block.items || []).map((item: any, i: number) => <details key={`${item.question}-${i}`}><summary>{item.question}</summary><p>{item.answer}</p></details>)}</section>;
      if (block.type === "countdown") return <section className="webinar-landing-cta" key={key}><span className="webinar-kicker">THE MOMENT IS SET</span><h2>{block.headline || "活動即將開始"}</h2>{countdownTarget ? <LandingCountdown target={countdownTarget} /> : null}<button onClick={scroll}>{block.ctaLabel || "立即報名"}</button></section>;
      if (block.type === "cta") return <section className="webinar-landing-cta" key={key}><span className="webinar-kicker">YOUR NEXT MOVE</span><h2>{block.headline || "現在就報名"}</h2><button onClick={scroll}>{block.ctaLabel || "立即報名"}</button><small>活動資訊將在報名後寄至你的信箱</small></section>;
      return null;
    })}
    {sticky && <aside className={preview ? "landing-sticky-cta" : "webinar-sticky-cta"} aria-label="立即報名"><div><b>{sticky.headline || "直播即將開始"}</b>{stickyTarget && stickyTarget > Date.now() ? <LandingCountdown target={stickyTarget} compact /> : null}</div><button onClick={scroll}>{sticky.ctaLabel || "立即報名"}</button></aside>}
  </div>;
}