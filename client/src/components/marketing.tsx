import { openMarketingConsentSettings } from "@/components/marketing-consent";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, BarChart3, Bot, CalendarDays, ChevronDown, ChevronRight, CirclePlay, ClipboardCheck, Globe2, Languages, LayoutTemplate, Menu, MessageCircle, X, Zap } from "lucide-react";
import { useLang, type LangFull } from "@/hooks/use-lang";
import "@/marketing.css";
import "@/audience.css";
import "@/mobile-marketing.css";
import { copyFor } from "@/marketing-data";
import { featureCopy, solutionCopy } from "@/marketing-catalog";
import { SellCaseLogo } from "@/components/sellcase-logo";

export type FeatureSlug = "ai-assistant" | "automated-webinars" | "interactions" | "landing-pages" | "follow-up" | "analytics" | "embeds" | "ecpay";
export type SolutionSlug = "instructors" | "consultants" | "sales-teams" | "marketing-teams" | "customer-education";
const languageNames: Record<LangFull, string> = { "zh-TW": "繁體中文", "zh-CN": "简体中文", en: "English" };
const features: { slug: FeatureSlug; icon: typeof Bot }[] = [
  { slug:"ai-assistant", icon:Bot },
  { slug:"automated-webinars", icon:CalendarDays },
  { slug:"interactions", icon:MessageCircle },
  { slug:"landing-pages", icon:LayoutTemplate },
  { slug:"follow-up", icon:Zap },
  { slug:"analytics", icon:BarChart3 },
  { slug:"embeds", icon:Globe2 },
  { slug:"ecpay", icon:ClipboardCheck },
];
const solutions: { slug: SolutionSlug }[] = [
  { slug:"instructors" },
  { slug:"consultants" },
  { slug:"sales-teams" },
  { slug:"marketing-teams" },
  { slug:"customer-education" },
];
const getLabel = (lang: LangFull, zhTw: string, en: string, zhCn = zhTw) =>
  lang === "en" ? en : lang === "zh-CN" ? zhCn : zhTw;

export function Brand() { return <Link href="/" className="sc-brand" aria-label="開賣啦 SellCase"><SellCaseLogo /></Link>; }
export function MarketingShell({ children }: { children: React.ReactNode }) {
  const { lang, setLang } = useLang(); const [, setLocation] = useLocation();
  const [menu, setMenu] = useState<"features"|"solutions"|null>(null), [mobile, setMobile] = useState(false), [langOpen, setLangOpen] = useState(false);
  const close = () => { setMenu(null); setMobile(false); setLangOpen(false); };
  useEffect(()=>{
    const previousOverflow = document.body.style.overflow;
    if (mobile) document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  },[mobile]);
  const firstMenuRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => { const onKey=(e: KeyboardEvent)=>{if(e.key==="Escape") close();}; window.addEventListener("keydown",onKey); return()=>window.removeEventListener("keydown",onKey); },[]);
  useEffect(()=> { if(menu) setTimeout(()=>firstMenuRef.current?.focus(),0); },[menu]);
  const labels=copyFor(lang).nav;
  const featureLabel=labels.features, solutionLabel=labels.solutions;
  const featureMenuCopy = featureCopy[lang];
  const solutionMenuCopy = solutionCopy[lang];
  return <div className="sc-site">
    <header className="sc-header"><nav className="sc-nav" aria-label={getLabel(lang, "主要導覽", "Main navigation", "主要导航")}><Brand/>
      <div className="sc-navlinks">
        <button onClick={()=>setMenu(menu==="features"?null:"features")} aria-expanded={menu==="features"}>{featureLabel}<ChevronDown size={15}/></button>
        <button onClick={()=>setMenu(menu==="solutions"?null:"solutions")} aria-expanded={menu==="solutions"}>{solutionLabel}<ChevronDown size={15}/></button>
         <Link href="/courses">{getLabel(lang, "課程廣場", "Course marketplace", "课程广场")}</Link><a href="/#pricing">{labels.pricing}</a>
      </div>
      <div className="sc-actions"><div className="sc-language"><button onClick={()=>setLangOpen(!langOpen)} aria-label="Change language" aria-expanded={langOpen}><Languages size={16}/>{lang==="zh-TW"?"繁":lang==="zh-CN"?"简":"EN"}</button>{langOpen&&<div className="sc-lang-menu" role="menu">{(Object.keys(languageNames) as LangFull[]).map(l=><button key={l} role="menuitem" onClick={()=>{setLang(l);setLangOpen(false)}}>{languageNames[l]}</button>)}</div>}</div><button className="sc-login" onClick={()=>setLocation("/admin")}>{labels.login}</button><button className="sc-cta sc-small" onClick={()=>setLocation("/admin")}>{labels.start}<ArrowRight size={15}/></button></div>
      <button className="sc-menu-toggle" aria-label={getLabel(lang, "開啟導覽選單", "Open navigation", "打开导航菜单")} aria-expanded={mobile} onClick={()=>setMobile(true)}><Menu/></button>
    </nav>
    {menu&&<div className="sc-mega" onMouseLeave={()=>setMenu(null)}><div><p>{menu==="features"?getLabel(lang,"開賣工具箱","THE SELLING SYSTEM","开卖工具箱"):getLabel(lang,"為不同工作方式而生","WHO SELLCASE SERVES","为不同工作方式而生")}</p><h2>{menu==="features"?getLabel(lang,"每個觀看時刻，都有下一步。","Everything around the webinar.","每个观看时刻，都有下一步。"):getLabel(lang,"讓專業內容持續運作。","Make expertise work longer.","让专业内容持续运行。")}</h2></div><div className="sc-mega-list">{(menu==="features"?features:solutions).map((item,i)=>{const isFeature = "icon" in item; const Icon = isFeature ? item.icon : null; const content = isFeature ? featureMenuCopy[item.slug as FeatureSlug] : solutionMenuCopy[item.slug as SolutionSlug]; return <Link className={isFeature ? "sc-mega-item" : "sc-mega-item sc-mega-item-plain"} ref={i===0?firstMenuRef:undefined} href={`/${menu}/${item.slug}`} onClick={close} key={item.slug}>{Icon&&<Icon size={19}/>}<span><b>{content.title}</b><small>{content.description}</small></span><ChevronRight size={15}/></Link>})}</div></div>}
    {mobile&&<div className="sc-drawer" role="dialog" aria-modal="true" aria-label={getLabel(lang, "導覽選單", "Navigation menu", "导航菜单")}><div className="sc-drawer-head"><Brand/><div className="sc-drawer-tools"><div className="sc-language"><button onClick={()=>setLangOpen(!langOpen)} aria-label="Change language" aria-expanded={langOpen}><Languages size={16}/>{lang==="zh-TW"?"繁":lang==="zh-CN"?"简":"EN"}</button>{langOpen&&<div className="sc-lang-menu" role="menu">{(Object.keys(languageNames) as LangFull[]).map(l=><button key={l} role="menuitem" onClick={()=>{setLang(l);setLangOpen(false)}}>{languageNames[l]}</button>)}</div>}</div><button onClick={close} aria-label={getLabel(lang, "關閉導覽選單", "Close navigation", "关闭导航菜单")}><X/></button></div></div><MobileGroup title={featureLabel} items={features.map(item=>({slug:item.slug,...featureMenuCopy[item.slug]}))} base="features" close={close}/><MobileGroup title={solutionLabel} items={solutions.map(item=>({slug:item.slug,...solutionMenuCopy[item.slug]}))} base="solutions" close={close}/><Link href="/courses" onClick={close}>{getLabel(lang, "課程廣場", "Course marketplace", "课程广场")}</Link><a href="/#pricing" onClick={close}>{labels.pricing}</a><div className="sc-drawer-bottom"><button onClick={()=>setLocation("/admin")}>{labels.login}</button><button className="sc-cta" onClick={()=>setLocation("/admin")}>{labels.start}<ArrowRight size={16}/></button></div></div>}
    </header>{children}<Footer/>
  </div>;
}
function MobileGroup({title,items,base,close}:{title:string;items:({slug:string;title:string;description:string})[];base:string;close:()=>void}) { const [open,setOpen]=useState(false); return <section className="sc-mobile-group"><button onClick={()=>setOpen(!open)} aria-expanded={open}>{title}<ChevronDown size={17}/></button>{open&&<div>{items.map(x=><Link href={`/${base}/${x.slug}`} onClick={close} key={x.slug}><span><b>{x.title}</b><small>{x.description}</small></span><ChevronRight size={15}/></Link>)}</div>}</section>; }
export function Footer(){const {lang}=useLang();const labels=lang==="en"?["Terms","Privacy","Refunds","Privacy settings"]:lang==="zh-CN"?["服务条款","隐私权","退款政策","隐私设置"]:["服務條款","隱私權","退款政策","隱私設定"];return <footer className="sc-footer"><Brand/><p>© {new Date().getFullYear()} SellCase</p><div><a href="/legal/terms">{labels[0]}</a><a href="/legal/privacy">{labels[1]}</a><a href="/legal/refunds">{labels[2]}</a><a href="#" aria-label="開啟 Cookie 與行銷追蹤設定" onClick={e=>{e.preventDefault();openMarketingConsentSettings();}}>{labels[3]}</a></div></footer>}
export { features, solutions, getLabel };