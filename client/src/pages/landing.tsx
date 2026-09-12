import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, Bot, CalendarDays, Check, CirclePlay, Mail, MessageCircle, MousePointer2, Play, Sparkles } from "lucide-react";
import { MarketingShell, features, solutions } from "@/components/marketing";
import { HomeComparison } from "@/components/home-comparison";
import { useLang } from "@/hooks/use-lang";
import { copyFor, homeExtras } from "@/marketing-data";
import { featureCopy, solutionCopy } from "@/marketing-catalog";
import { NO_CARD_TRIAL_AI_CALL_LIMIT, NO_CARD_TRIAL_DAYS } from "@shared/noCardTrial";
import {
  PLAN_NAMES,
  PUBLIC_PLAN_KEYS,
  PricingAmount,
  RegionalPricingNote,
} from "@/components/regional-pricing";
import { DEFAULT_PRICING_REGION, usePricingRegion } from "@/hooks/use-pricing-region";
import "@/landing-redesign.css";

export default function Landing() {
  const [,setLocation]=useLocation(); const {lang}=useLang(); const c=copyFor(lang).home; const x=homeExtras[lang]; const featureContent=featureCopy[lang]; const solutionContent=solutionCopy[lang];
  const { data: pricingRegion } = usePricingRegion();
  const region = pricingRegion ?? DEFAULT_PRICING_REGION;
  useEffect(()=>{document.title=lang==="en"?"SellCase — AI automated webinar sales system":lang==="zh-CN"?"开卖啦 SellCase｜AI 自动销讲成交系统":"開賣啦 SellCase｜AI 自動銷講成交系統";document.documentElement.lang=lang;document.querySelector('meta[name="description"]')?.setAttribute("content",c.lead)},[lang,c.lead]);
  return <MarketingShell><a className="sc-skip-link" href="#main-content">{lang==="en"?"Skip to content":lang==="zh-CN"?"跳到内容":"跳至內容"}</a><main className="sc-home sc-home--redesigned" id="main-content">
    <section className="sc-hero"><div className="sc-hero-copy"><p className="sc-kicker"><span/>{c.kicker}</p><h1>{c.title}<em>{c.accent}</em></h1><p>{c.lead}</p><div className="sc-hero-actions"><button className="sc-cta" onClick={()=>setLocation("/admin")}>{c.primary}<ArrowRight size={18}/></button><a href="#how"><CirclePlay size={18}/>{c.how}</a></div><small><Check size={14}/>{lang==="en"?"Start with one presentation":lang==="zh-CN"?"上传一场演示即可开始":"上傳一場簡報，就能開始"} <i/> <Check size={14}/>{lang==="en"?"For creators and teams":lang==="zh-CN"?"适合内容创作者与团队":"適合內容創作者與團隊"}</small></div>
      <div className="sc-room" aria-label="SellCase webinar room preview"><header><span><i/>{x.room[0]}</span><b>SELLCASE / 01</b></header><div className="sc-video"><div className="sc-video-lines"/><span className="sc-play-affordance" aria-hidden="true"><Play fill="currentColor"/></span><span>{x.room[1]}</span><h2>{x.room[2]}</h2><small>18:42 / 42:00</small></div><div className="sc-progress"><i/></div><div className="sc-room-bottom"><article><p><MessageCircle size={15}/>{x.room[3]} <b>12</b></p><span><i/>{x.room[4]}<small>18:44</small></span><span><i/>{x.room[5]}<small>18:47</small></span></article><aside><small><Sparkles size={13}/>{x.room[6]}</small><b>{x.room[7]}</b><span>{x.room[8]} <ArrowRight size={13}/></span><span>{x.room[9]} <ArrowRight size={13}/></span></aside></div></div></section>
    <section className="sc-proof"><div><p className="sc-kicker">SELLCASE DOES THE REPEATABLE WORK</p><h2>{c.proof}</h2><p>{c.proofLead}</p></div><div className="sc-proof-notes">{x.proof.map(([title,desc],i)=>{const I=[Bot,CalendarDays,MousePointer2][i];return <article key={title}><I/><h3>{title}</h3><p>{desc}</p></article>})}</div></section>
    <HomeComparison lang={lang}/>
    <section className="sc-how" id="how"><div><p className="sc-kicker">{c.howKicker}</p><h2>{c.howTitle}</h2></div><ol>{x.steps.map(([title,desc],i)=><li key={title}><b>0{i+1}</b><h3>{title}</h3><p>{desc}</p></li>)}</ol></section>
    <section className="sc-capabilities"><header><p className="sc-kicker">YOUR AI WEBINAR TEAM</p><h2>{c.capTitle}</h2><Link href="/features">{c.viewAll}<ArrowRight size={16}/></Link></header><div>{features.slice(0,6).map((f,i)=>{const I=f.icon;const content=featureContent[f.slug];return <Link href={`/features/${f.slug}`} key={f.slug}><small>0{i+1}</small><I/><span><b>{content.title}</b><p>{content.description}</p></span><ArrowRight size={16}/></Link>})}</div></section>
    <section className="sc-audience"><header><p className="sc-kicker">{x.audience[0]}</p><h2>{x.audience[1]}</h2><p>{x.audience[2]}</p></header><div>{solutions.map((s,i)=>{const content=solutionContent[s.slug];return <Link href={`/solutions/${s.slug}`} key={s.slug}><small>0{i+1}</small><span><b>{content.title}</b><p>{content.description}</p></span><ArrowRight size={16}/></Link>})}</div><Link className="sc-audience-all" href="/solutions">{x.audience[3]} <ArrowRight size={16}/></Link></section>
     <section className="sc-pricing" id="pricing"><header><p className="sc-kicker">{c.priceKicker}</p><h2>{c.priceTitle}</h2><p>{c.priceLead}</p><strong>{c.annual}</strong></header><RegionalPricingNote region={region}/><div className="sc-plan-grid">{PUBLIC_PLAN_KEYS.map((planKey,i)=><article className={i===1?"featured":""} key={planKey}>{i===1&&<label>{lang==="en"?"Most popular":lang==="zh-CN"?"最多人选择":"最多人選擇"}</label>}<h3>{PLAN_NAMES[planKey]}</h3><p>{x.plans[i][1]}</p><div className="sc-price"><PricingAmount planKey={planKey} interval="month" region={region}/></div><p><strong><PricingAmount planKey={planKey} interval="year" region={region}/></strong></p><ul><li><strong>{["1","5","15"][i]}</strong> {x.units[0]}</li><li><strong>{["1,000","3,000","5,000"][i]}</strong> {x.units[1]}</li><li><strong>{["100","200","300"][i]}</strong> {x.units[2]}</li><li>{lang==="en"?"Activated immediately after payment":lang==="zh-CN"?"付款完成后立即启用":"付款完成後立即啟用"}</li></ul><button onClick={()=>setLocation("/admin")}>{x.units[3]} <ArrowRight size={16}/></button></article>)}</div><p className="sc-fine" data-testid="no-card-trial-marketing"><Mail size={16}/>{lang==="en"?`${NO_CARD_TRIAL_DAYS}-day no-card trial, ${NO_CARD_TRIAL_AI_CALL_LIMIT} AI calls, one published product page, lead capture and basic statistics. It ends without a charge.`:lang==="zh-CN"?`免信用卡试用 ${NO_CARD_TRIAL_DAYS} 天，含 ${NO_CARD_TRIAL_AI_CALL_LIMIT} 次 AI、1 个已发布商品页、名单收集与基本数据；到期不扣款。`:`免信用卡試用 ${NO_CARD_TRIAL_DAYS} 天，含 ${NO_CARD_TRIAL_AI_CALL_LIMIT} 次 AI、1 個已發布商品頁、名單蒐集與基本數據；到期不扣款。`}</p><p className="sc-fine"><Sparkles size={16}/>{c.addon}</p></section>
    <section className="sc-close"><div><p className="sc-kicker">開賣啦 SELLCASE</p><h2>{c.close}</h2><p>{c.closeLead}</p><button className="sc-cta" onClick={()=>setLocation("/admin")}>{copyFor(lang).nav.start} <ArrowRight size={18}/></button></div><div className="sc-rings"><i/><i/><i/></div></section>
  </main></MarketingShell>;
}