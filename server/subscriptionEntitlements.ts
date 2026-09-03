import type { User } from "@shared/schema";
import { storage } from "./storage";
import { getUncachableStripeClient } from "./stripeClient";

export const SUBSCRIPTION_PLANS = {
  starter: { label: "Starter", baseWebinars: 1, monthlyRegistrants: 1_000, monthlyAiPoints: 100, lookupKey: "icta_webinar_starter_monthly" },
  growth: { label: "Growth", baseWebinars: 5, monthlyRegistrants: 3_000, monthlyAiPoints: 200, lookupKey: "icta_webinar_growth_monthly" },
  scale: { label: "Scale", baseWebinars: 15, monthlyRegistrants: 5_000, monthlyAiPoints: 300, lookupKey: "icta_webinar_scale_monthly" },
} as const;

export const ADDON_LOOKUP_KEY = "icta_webinar_room_addon_monthly";
export type SubscriptionPlanKey = keyof typeof SUBSCRIPTION_PLANS;

export function getMonthlyRegistrantLimit(plan: string): number | null {
  return plan in SUBSCRIPTION_PLANS
    ? SUBSCRIPTION_PLANS[plan as SubscriptionPlanKey].monthlyRegistrants
    : null;
}

export type SubscriptionEntitlement = {
  plan: "free" | SubscriptionPlanKey | "legacy" | "enterprise";
  status: string;
  active: boolean;
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
      price: { lookup_key?: string | null };
    }>;
  };
};

function freeEntitlement(status = "inactive"): SubscriptionEntitlement {
  return {
    plan: "free",
    status,
    active: false,
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
): SubscriptionEntitlement {
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
    ...Object.values(SUBSCRIPTION_PLANS).map((plan) => plan.lookupKey),
    ADDON_LOOKUP_KEY,
  ];
  const prices = await stripe.prices.list({ active: true, lookup_keys: lookupKeys, limit: 10 });
  const byLookupKey = new Map(prices.data.map((price) => [price.lookup_key, price.id]));
  return { stripe, byLookupKey };
}

export async function refreshSubscriptionEntitlement(user: User): Promise<SubscriptionEntitlement> {
  if (user.isSuperAdmin || user.subscriptionPlan === "enterprise") {
    return {
      plan: "enterprise",
      status: "active",
      active: true,
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
  let addonWebinars = 0;
  for (const item of subscription.items.data) {
    const lookupKey = item.price.lookup_key;
    const matchingPlan = (Object.entries(SUBSCRIPTION_PLANS) as [SubscriptionPlanKey, typeof SUBSCRIPTION_PLANS[SubscriptionPlanKey]][])
      .find(([, plan]) => plan.lookupKey === lookupKey);
    if (matchingPlan) planKey = matchingPlan[0];
    if (lookupKey === ADDON_LOOKUP_KEY) addonWebinars += item.quantity || 0;
  }

  if (!planKey) {
    for (const item of subscription.items.data) {
      const price = item.price;
      if (
        price.unit_amount !== 4900 ||
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