import type { User } from "@shared/schema";
import { PLAN_PRICING } from "@shared/pricing";
import { storage } from "./storage";
import { getUncachableStripeClient } from "./stripeClient";

export const SUBSCRIPTION_PLANS = {
  starter: { label: "Starter", amountUsd: PLAN_PRICING.starter.monthlyUSD, annualAmountUsd: PLAN_PRICING.starter.annualUSD, baseWebinars: 1, monthlyRegistrants: 1_000, monthlyAiPoints: 100, lookupKey: "icta_webinar_starter_monthly_usd29", annualLookupKey: "icta_webinar_starter_annual_usd29580" },
  growth: { label: "Growth", amountUsd: PLAN_PRICING.growth.monthlyUSD, annualAmountUsd: PLAN_PRICING.growth.annualUSD, baseWebinars: 5, monthlyRegistrants: 3_000, monthlyAiPoints: 200, lookupKey: "icta_webinar_growth_monthly", annualLookupKey: "icta_webinar_growth_annual" },
  scale: { label: "Scale", amountUsd: PLAN_PRICING.scale.monthlyUSD, annualAmountUsd: PLAN_PRICING.scale.annualUSD, baseWebinars: 15, monthlyRegistrants: 5_000, monthlyAiPoints: 300, lookupKey: "icta_webinar_scale_monthly", annualLookupKey: "icta_webinar_scale_annual" },
} as const;

/** Prices charged before the public Starter price changed to USD 29. */
export const STARTER_GRANDFATHERED_MONTHLY_AMOUNT_USD = 39;
export const STARTER_GRANDFATHERED_ANNUAL_AMOUNT_USD = 397.8;
/** The original three-room subscription is not part of the public catalog. */
export const LEGACY_MONTHLY_AMOUNT_USD = 49;

export const ADDON_LOOKUP_KEY = "icta_webinar_room_addon_monthly";
export const ANNUAL_ADDON_LOOKUP_KEY = "icta_webinar_room_addon_annual";
export type BillingInterval = "month" | "year";
export type SubscriptionPlanKey = keyof typeof SUBSCRIPTION_PLANS;

/**
 * Starter's old keys must remain active for the currently deployed checkout.
 * New checkout deliberately uses price-versioned keys, so publishing this
 * code cannot transfer or archive the old USD 39 prices.
 */
export const STARTER_LEGACY_LOOKUP_KEYS = {
  month: "icta_webinar_starter_monthly",
  year: "icta_webinar_starter_annual",
} as const;

export const STARTER_NEW_LOOKUP_KEYS = {
  month: "icta_webinar_starter_monthly_usd29",
  year: "icta_webinar_starter_annual_usd29580",
} as const;

export const STARTER_NEW_FALLBACK_LOOKUP_KEYS = {
  month: "icta_webinar_starter_monthly_usd29_v2",
  year: "icta_webinar_starter_annual_usd29580_v2",
} as const;

export function planLookupKey(planKey: SubscriptionPlanKey, interval: BillingInterval): string {
  const plan = SUBSCRIPTION_PLANS[planKey];
  return interval === "year" ? plan.annualLookupKey : plan.lookupKey;
}

export function approvedLookupKeys(planKey: SubscriptionPlanKey, interval: BillingInterval): string[] {
  const canonical = planLookupKey(planKey, interval);
  if (planKey !== "starter") return [canonical];
  const fallback = interval === "year"
    ? STARTER_NEW_FALLBACK_LOOKUP_KEYS.year
    : STARTER_NEW_FALLBACK_LOOKUP_KEYS.month;
  return [canonical, fallback];
}

export function planKeyForLookupKey(lookupKey: string | null | undefined): SubscriptionPlanKey | null {
  if (!lookupKey) return null;
  for (const [planKey] of Object.entries(SUBSCRIPTION_PLANS) as [SubscriptionPlanKey, typeof SUBSCRIPTION_PLANS[SubscriptionPlanKey]][]) {
    if (
      approvedLookupKeys(planKey, "month").includes(lookupKey)
      || approvedLookupKeys(planKey, "year").includes(lookupKey)
      || (planKey === "starter" && (
        lookupKey === STARTER_LEGACY_LOOKUP_KEYS.month
        || lookupKey === STARTER_LEGACY_LOOKUP_KEYS.year
        || lookupKey === STARTER_NEW_FALLBACK_LOOKUP_KEYS.month
        || lookupKey === STARTER_NEW_FALLBACK_LOOKUP_KEYS.year
      ))
    ) {
      return planKey;
    }
  }
  return null;
}

export function isAddonLookupKey(lookupKey: string | null | undefined): boolean {
  return lookupKey === ADDON_LOOKUP_KEY || lookupKey === ANNUAL_ADDON_LOOKUP_KEY;
}

export function getMonthlyRegistrantLimit(plan: string): number | null {
  return plan in SUBSCRIPTION_PLANS
    ? SUBSCRIPTION_PLANS[plan as SubscriptionPlanKey].monthlyRegistrants
    : null;
}

export type SubscriptionEntitlement = {
  plan: "free" | SubscriptionPlanKey | "legacy" | "enterprise";
  status: string;
  active: boolean;
  amountUsd: number | null;
  maxWebinars: number;
  addonWebinars: number;
  startedAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  stripeSubscriptionId: string | null;
};

export type EntitlementSubscription = {
  id: string;
  status: string;
  created: number;
  cancel_at_period_end: boolean;
  current_period_start?: number | null;
  current_period_end?: number | null;
  items: {
    data: Array<{
      quantity?: number | null;
      current_period_start?: number | null;
      current_period_end?: number | null;
      price: {
        lookup_key?: string | null;
        unit_amount?: number | null;
        currency?: string;
        recurring?: { interval?: BillingInterval | null } | null;
      };
    }>;
  };
};

function freeEntitlement(status = "inactive"): SubscriptionEntitlement {
  return {
    plan: "free",
    status,
    active: false,
    amountUsd: null,
    maxWebinars: 0,
    addonWebinars: 0,
    startedAt: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    stripeSubscriptionId: null,
  };
}

export function computeSubscriptionEntitlement(
  subscription: EntitlementSubscription,
  planKey: SubscriptionPlanKey | "legacy",
  addonWebinars: number,
  now = new Date(),
  amountUsd?: number,
): SubscriptionEntitlement {
  const subscribedAmountUsd = amountUsd ?? (
    planKey === "legacy"
      ? LEGACY_MONTHLY_AMOUNT_USD
      : subscription.items.data.some((item) => item.price.recurring?.interval === "year")
        ? SUBSCRIPTION_PLANS[planKey].annualAmountUsd
        : SUBSCRIPTION_PLANS[planKey].amountUsd
  );
  const periodStart = subscription.current_period_start
    || subscription.items.data[0]?.current_period_start;
  const periodEnd = subscription.current_period_end
    || subscription.items.data[0]?.current_period_end;
  const currentPeriodEnd = periodEnd ? new Date(periodEnd * 1000) : null;
  const statusAllowsAccess = ["active", "trialing"].includes(subscription.status);
  const periodAllowsAccess = !currentPeriodEnd || currentPeriodEnd.getTime() > now.getTime();
  const active = statusAllowsAccess && periodAllowsAccess;

  return {
    plan: planKey,
    status: subscription.status,
    active,
    amountUsd: subscribedAmountUsd,
    maxWebinars: active
      ? (planKey === "legacy" ? 3 : SUBSCRIPTION_PLANS[planKey].baseWebinars) + addonWebinars
      : 0,
    addonWebinars,
    startedAt: periodStart
      ? new Date(periodStart * 1000)
      : new Date(subscription.created * 1000),
    currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    stripeSubscriptionId: subscription.id,
  };
}

export async function getApprovedPriceIds() {
  const stripe = await getUncachableStripeClient();
  const lookupKeys = [
    ...Object.entries(SUBSCRIPTION_PLANS).flatMap(([planKey]) => [
      ...approvedLookupKeys(planKey as SubscriptionPlanKey, "month"),
      ...approvedLookupKeys(planKey as SubscriptionPlanKey, "year"),
    ]),
    ADDON_LOOKUP_KEY,
    ANNUAL_ADDON_LOOKUP_KEY,
  ];
  const prices = await stripe.prices.list({ active: true, lookup_keys: lookupKeys, limit: 100 });
  const expectedAmounts = new Map<string, { amount: number; interval: BillingInterval; canonical: string }>();
  for (const [planKey, plan] of Object.entries(SUBSCRIPTION_PLANS) as [SubscriptionPlanKey, typeof SUBSCRIPTION_PLANS[SubscriptionPlanKey]][]) {
    for (const lookupKey of approvedLookupKeys(planKey, "month")) {
      expectedAmounts.set(lookupKey, { amount: plan.amountUsd * 100, interval: "month", canonical: plan.lookupKey });
    }
    for (const lookupKey of approvedLookupKeys(planKey, "year")) {
      expectedAmounts.set(lookupKey, { amount: plan.annualAmountUsd * 100, interval: "year", canonical: plan.annualLookupKey });
    }
  }
  expectedAmounts.set(ADDON_LOOKUP_KEY, { amount: 2_000, interval: "month", canonical: ADDON_LOOKUP_KEY });
  expectedAmounts.set(ANNUAL_ADDON_LOOKUP_KEY, { amount: 20_400, interval: "year", canonical: ANNUAL_ADDON_LOOKUP_KEY });
  const validPrices = prices.data.flatMap((price) => {
    const expectation = price.lookup_key ? expectedAmounts.get(price.lookup_key) : undefined;
    const valid = expectation !== undefined
      && price.unit_amount === expectation.amount
      && price.currency === "usd"
      && price.recurring?.interval === expectation.interval;
    return valid && price.lookup_key ? [{ price, expectation }] : [];
  });
  const byLookupKey = new Map<string, string>();
  for (const price of prices.data) {
    const valid = validPrices.find((candidate) => candidate.price.id === price.id);
    if (!valid || !price.lookup_key) continue;
    // Keep both the Stripe key and the canonical key.  This also makes the
    // catalog map safe for future price-versioned keys.
    byLookupKey.set(price.lookup_key, price.id);
    if (!byLookupKey.has(valid.expectation.canonical) || price.lookup_key === valid.expectation.canonical) {
      byLookupKey.set(valid.expectation.canonical, price.id);
    }
  }
  return { stripe, byLookupKey };
}

export async function refreshSubscriptionEntitlement(user: User): Promise<SubscriptionEntitlement> {
  if (user.isSuperAdmin || user.subscriptionPlan === "enterprise") {
    return {
      plan: "enterprise",
      status: "active",
      active: true,
      amountUsd: null,
      maxWebinars: 999,
      addonWebinars: 0,
      startedAt: user.createdAt || null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      stripeSubscriptionId: user.stripeSubscriptionId,
    };
  }

  if (!user.stripeCustomerId) return freeEntitlement();

  const stripe = await getUncachableStripeClient();
  const subscriptions = await stripe.subscriptions.list({
    customer: user.stripeCustomerId,
    status: "all",
    limit: 20,
    expand: ["data.items.data.price"],
  });
  const sortedSubscriptions = [...subscriptions.data].sort((a, b) => b.created - a.created);
  const subscription =
    sortedSubscriptions.find((item) => ["active", "trialing", "past_due"].includes(item.status)) ||
    sortedSubscriptions[0];

  if (!subscription) {
    const result = freeEntitlement(subscriptions.data[0]?.status || "inactive");
    await storage.updateUser(user.id, {
      subscriptionPlan: "free",
      subscriptionStatus: result.status,
      maxWebinars: 0,
      addonWebinars: 0,
      stripeSubscriptionId: null,
      planExpiresAt: null,
      subscriptionStartedAt: null,
      cancelAtPeriodEnd: false,
    });
    return result;
  }

  let planKey: SubscriptionPlanKey | "legacy" | null = null;
  let baseAmountUsd: number | null = null;
  let addonWebinars = 0;
  for (const item of subscription.items.data) {
    const lookupKey = item.price.lookup_key;
    const matchingPlanKey = planKeyForLookupKey(lookupKey);
    const matchingPlan = matchingPlanKey
      ? [matchingPlanKey, SUBSCRIPTION_PLANS[matchingPlanKey]] as const
      : undefined;
    if (matchingPlan) {
      planKey = matchingPlan[0];
      baseAmountUsd = item.price.currency === "usd" && item.price.unit_amount !== null
        ? item.price.unit_amount / 100
        : matchingPlan[1].amountUsd;
    }
    if (!matchingPlan) {
      const product = typeof item.price.product === "string"
        ? await stripe.products.retrieve(item.price.product)
        : item.price.product;
      const catalogKey = !("deleted" in product)
        ? product.metadata?.ictaCatalogKey || product.metadata?.planKey
        : undefined;
      if (catalogKey && catalogKey in SUBSCRIPTION_PLANS) {
        planKey = catalogKey as SubscriptionPlanKey;
        baseAmountUsd = item.price.currency === "usd" && item.price.unit_amount !== null
          ? item.price.unit_amount / 100
          : SUBSCRIPTION_PLANS[planKey].amountUsd;
      }
    }
    if (lookupKey === ADDON_LOOKUP_KEY || lookupKey === ANNUAL_ADDON_LOOKUP_KEY) addonWebinars += item.quantity || 0;
  }

  if (!planKey) {
    for (const item of subscription.items.data) {
      const price = item.price;
      if (
        price.unit_amount !== LEGACY_MONTHLY_AMOUNT_USD * 100 ||
        price.currency !== "usd" ||
        price.recurring?.interval !== "month"
      ) continue;
      const product = typeof price.product === "string"
        ? await stripe.products.retrieve(price.product)
        : price.product;
      if (
        !("deleted" in product) &&
        product.name === "ICTA Webinar Monthly" &&
        product.metadata?.plan === "monthly" &&
        product.metadata?.maxWebinars === "3"
      ) {
        planKey = "legacy";
        baseAmountUsd = LEGACY_MONTHLY_AMOUNT_USD;
        break;
      }
    }
  }

  if (!planKey) {
    const result = freeEntitlement("unrecognized_price");
    await storage.updateUser(user.id, {
      subscriptionPlan: "free",
      subscriptionStatus: result.status,
      maxWebinars: 0,
      addonWebinars: 0,
      stripeSubscriptionId: subscription.id,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    });
    return result;
  }

  const entitlement = computeSubscriptionEntitlement(
    subscription as EntitlementSubscription,
    planKey,
    addonWebinars,
    new Date(),
    baseAmountUsd ?? (planKey === "legacy" ? LEGACY_MONTHLY_AMOUNT_USD : SUBSCRIPTION_PLANS[planKey].amountUsd),
  );

  await storage.updateUser(user.id, {
    subscriptionPlan: entitlement.plan,
    subscriptionStatus: entitlement.status,
    maxWebinars: entitlement.maxWebinars,
    addonWebinars: entitlement.addonWebinars,
    stripeSubscriptionId: entitlement.stripeSubscriptionId,
    planExpiresAt: entitlement.currentPeriodEnd,
    subscriptionStartedAt: entitlement.startedAt,
    cancelAtPeriodEnd: entitlement.cancelAtPeriodEnd,
  });
  return entitlement;
}