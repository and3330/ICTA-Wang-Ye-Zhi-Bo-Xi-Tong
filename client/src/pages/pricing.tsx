import { ArrowRight } from "lucide-react";
import { useLocation } from "wouter";
import { MarketingShell } from "@/components/marketing";
import {
  PLAN_NAMES,
  PUBLIC_PLAN_KEYS,
  PricingAmount,
  RegionalPricingNote,
} from "@/components/regional-pricing";
import { usePricingRegion, DEFAULT_PRICING_REGION } from "@/hooks/use-pricing-region";
import { useLang } from "@/hooks/use-lang";
import { copyFor, homeExtras } from "@/marketing-data";
import "@/pricing.css";

export default function PricingPage() {
  const [, setLocation] = useLocation();
  const { lang } = useLang();
  const { data: pricingRegion } = usePricingRegion();
  const region = pricingRegion ?? DEFAULT_PRICING_REGION;
  const copy = copyFor(lang).home;
  const plans = homeExtras[lang].plans;

  return (
    <MarketingShell>
      <main className="sc-listing sc-pricing-page">
        <header>
          <p>{copy.priceKicker}</p>
          <h1>{copy.priceTitle}</h1>
          <span>{copy.priceLead}</span>
          <strong>{copy.annual}</strong>
        </header>
        <RegionalPricingNote region={region} />
        <section className="sc-plan-grid" aria-label={lang === "en" ? "Subscription plans" : "訂閱方案"}>
          {PUBLIC_PLAN_KEYS.map((planKey, index) => (
            <article className={index === 1 ? "featured" : ""} key={planKey}>
              {index === 1 && <label>{lang === "en" ? "Most popular" : lang === "zh-CN" ? "最多人选择" : "最多人選擇"}</label>}
              <h2>{PLAN_NAMES[planKey]}</h2>
              <p>{plans[index][1]}</p>
              <div className="sc-price"><PricingAmount planKey={planKey} interval="month" region={region} /></div>
              <p><strong><PricingAmount planKey={planKey} interval="year" region={region} /></strong></p>
              <ul>
                <li>{lang === "en" ? "Subscription plan access" : "訂閱方案功能與發布額度"}</li>
                <li>{lang === "en" ? "AI assistant and automated webinars" : "AI 助教與自動化 Webinar"}</li>
                <li>{lang === "en" ? "Analytics and follow-up" : "成效分析與 Email 追蹤"}</li>
              </ul>
              <button onClick={() => setLocation("/admin")}>
                {lang === "en" ? "Choose this plan" : "選擇此方案"} <ArrowRight size={16} />
              </button>
            </article>
          ))}
        </section>
      </main>
    </MarketingShell>
  );
}