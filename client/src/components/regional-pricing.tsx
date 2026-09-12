import type { ReactNode } from "react";
import { PLAN_PRICING, type PricingPlanKey } from "@shared/pricing";
import { DEFAULT_PRICING_REGION, type PricingRegion } from "@/hooks/use-pricing-region";

export type BillingInterval = "month" | "year";

export const PUBLIC_PLAN_KEYS: PricingPlanKey[] = ["starter", "growth", "scale"];

export const PLAN_NAMES: Record<PricingPlanKey, string> = {
  starter: "Starter",
  growth: "Growth",
  scale: "Scale",
};

function numberWithGrouping(value: number, maximumFractionDigits = 0) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
    minimumFractionDigits: maximumFractionDigits && value % 1 !== 0 ? 1 : 0,
  }).format(value);
}

export function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatTwd(value: number) {
  return numberWithGrouping(value, value % 1 === 0 ? 0 : 1);
}

export function pricingFor(planKey: PricingPlanKey, interval: BillingInterval) {
  const plan = PLAN_PRICING[planKey];
  return interval === "year"
    ? { usd: plan.annualUSD, twd: plan.annualTWD, equivalentMonthlyTwd: plan.equivalentMonthlyTWD }
    : { usd: plan.monthlyUSD, twd: plan.monthlyTWDReference, equivalentMonthlyTwd: null };
}

type PricingAmountProps = {
  planKey: PricingPlanKey;
  interval: BillingInterval;
  region?: PricingRegion;
  className?: string;
  showTestIds?: boolean;
};

/**
 * A public price always has a USD checkout amount. TWD values are fixed,
 * approximate references supplied by shared/pricing.ts—not an FX conversion.
 */
export function PricingAmount({
  planKey,
  interval,
  region = DEFAULT_PRICING_REGION,
  className,
  showTestIds = true,
}: PricingAmountProps) {
  const amount = pricingFor(planKey, interval);
  const period = interval === "year" ? "年" : "月";
  const actualUsd = `US$${formatUsd(amount.usd)}`;

  if (region.displayCurrency === "TWD") {
    return (
      <span className={className}>
        <strong {...(showTestIds ? { "data-testid": `price-${planKey}-${interval}-primary` } : {})}>
          {"約 NT$"}{formatTwd(amount.twd)}／{period}
        </strong>
        <small {...(showTestIds ? { "data-testid": `price-${planKey}-${interval}-usd` } : {})}>
          實際結帳 {actualUsd}／{period}{interval === "year" ? "（年繳預付）" : ""}
        </small>
        {interval === "year" && amount.equivalentMonthlyTwd !== null && (
          <small {...(showTestIds ? { "data-testid": `price-${planKey}-${interval}-equivalent` } : {})}>
            {"折合每月約 NT$"}{formatTwd(amount.equivalentMonthlyTwd)}
          </small>
        )}
      </span>
    );
  }

  return (
    <span className={className}>
        <strong {...(showTestIds ? { "data-testid": `price-${planKey}-${interval}-primary` } : {})}>
        {actualUsd}／{period}
      </strong>
      <small>USD</small>
    </span>
  );
}

export function RegionalPricingNote({
  region = DEFAULT_PRICING_REGION,
  children,
}: {
  region?: PricingRegion;
  children?: ReactNode;
}) {
  if (region.displayCurrency !== "TWD") return null;
  return (
    <p className="regional-pricing-note" data-testid="pricing-currency-note">
      台幣金額為固定的約略參考值，並非即時匯率；實際結帳與扣款一律使用美元
      （USD），匯率及發卡銀行／信用卡海外手續費可能另計。{children}
    </p>
  );
}