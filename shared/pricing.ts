/**
 * Public regional pricing references.
 *
 * The TWD values are fixed display references, not an exchange-rate
 * conversion.  Subscription checkout remains USD-only; a regional pricing
 * UI may use these values for comparison without ever sending them to
 * Stripe.
 */
export const ANNUAL_BILLING_FACTOR = 0.85;

export type PricingPlanKey = "starter" | "growth" | "scale";

export type RegionalPlanPricing = {
  monthlyUSD: number;
  annualUSD: number;
  monthlyTWDReference: number;
  annualTWD: number;
  equivalentMonthlyTWD: number;
};

function annualTWD(monthlyTWDReference: number): number {
  return monthlyTWDReference * 12 * ANNUAL_BILLING_FACTOR;
}

function equivalentMonthlyTWD(monthlyTWDReference: number): number {
  return monthlyTWDReference * ANNUAL_BILLING_FACTOR;
}

export const PLAN_PRICING: Record<PricingPlanKey, RegionalPlanPricing> = {
  starter: {
    monthlyUSD: 29,
    annualUSD: 295.8,
    monthlyTWDReference: 890,
    annualTWD: annualTWD(890),
    equivalentMonthlyTWD: equivalentMonthlyTWD(890),
  },
  growth: {
    monthlyUSD: 99,
    annualUSD: 1009.8,
    monthlyTWDReference: 3000,
    annualTWD: annualTWD(3000),
    equivalentMonthlyTWD: equivalentMonthlyTWD(3000),
  },
  scale: {
    monthlyUSD: 199,
    annualUSD: 2029.8,
    monthlyTWDReference: 6000,
    annualTWD: annualTWD(6000),
    equivalentMonthlyTWD: equivalentMonthlyTWD(6000),
  },
} as const;

/** Alias used by consumers that describe this object as the catalog. */
export const PRICING_PLANS = PLAN_PRICING;

export function annualTwdFor(monthlyTwdReference: number): number {
  return annualTWD(monthlyTwdReference);
}

export function equivalentMonthlyTwdFor(monthlyTwdReference: number): number {
  return equivalentMonthlyTWD(monthlyTwdReference);
}