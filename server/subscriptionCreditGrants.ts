import type Stripe from "stripe";
import { storage } from "./storage";
import { getUncachableStripeClient } from "./stripeClient";
import { SUBSCRIPTION_PLANS, type SubscriptionPlanKey } from "./subscriptionEntitlements";

export function oneYearAfter(date: Date): Date {
  const expiresAt = new Date(date);
  const originalMonth = expiresAt.getUTCMonth();
  expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + 1);
  if (expiresAt.getUTCMonth() !== originalMonth) {
    expiresAt.setUTCDate(0);
  }
  return expiresAt;
}

export function monthlyGiftForLookupKeys(lookupKeys: Array<string | null | undefined>): { planKey: SubscriptionPlanKey; points: number } | null {
  for (const [planKey, plan] of Object.entries(SUBSCRIPTION_PLANS) as Array<[SubscriptionPlanKey, typeof SUBSCRIPTION_PLANS[SubscriptionPlanKey]]>) {
    if (lookupKeys.includes(plan.lookupKey)) return { planKey, points: plan.monthlyAiPoints };
  }
  return null;
}

export function isPaidBillableSubscriptionInvoice(invoice: Pick<Stripe.Invoice, "status" | "amount_paid" | "billing_reason">): boolean {
  return invoice.status === "paid"
    && invoice.amount_paid > 0
    && ["subscription_create", "subscription_cycle"].includes(invoice.billing_reason || "");
}

async function grantPaidSubscriptionInvoice(
  invoice: Stripe.Invoice & Record<string, any>,
  knownUserId?: string,
): Promise<void> {
  if (!isPaidBillableSubscriptionInvoice(invoice)) return;
  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
  const user = knownUserId
    ? await storage.getUser(knownUserId)
    : customerId ? await storage.getUserByStripeCustomerId(customerId) : undefined;
  if (!user) return;

  const stripe = await getUncachableStripeClient();
  const lineItems = await stripe.invoices.listLineItems(invoice.id, { limit: 100 });
  const priceIds = Array.from(new Set(lineItems.data.flatMap((line) => {
    const priceId = line.pricing?.price_details?.price;
    return priceId ? [priceId] : [];
  })));
  const prices = await Promise.all(priceIds.map((priceId) => stripe.prices.retrieve(priceId)));
  const gift = monthlyGiftForLookupKeys(prices.map((price) => price.lookup_key));
  if (!gift) return;

  const paidTimestamp = invoice.status_transitions?.paid_at || invoice.created;
  const grantedAt = new Date(paidTimestamp * 1000);
  await storage.grantAiCredits({
    userId: user.id,
    points: gift.points,
    source: "monthly_gift",
    grantedAt,
    expiresAt: oneYearAfter(grantedAt),
    idempotencyKey: `subscription-invoice:${invoice.id}`,
  });
}

export async function reconcileCurrentSubscriptionCredit(userId: string, subscriptionId: string): Promise<void> {
  const stripe = await getUncachableStripeClient();
  const oneYearAgo = Math.floor(Date.now() / 1000) - (366 * 24 * 60 * 60);
  const invoices = stripe.invoices.list({
    subscription: subscriptionId,
    status: "paid",
    created: { gte: oneYearAgo },
    limit: 100,
  });
  for await (const invoice of invoices) {
    if (isPaidBillableSubscriptionInvoice(invoice)) {
      await grantPaidSubscriptionInvoice(invoice as Stripe.Invoice & Record<string, any>, userId);
    }
  }
}

export async function processSubscriptionCreditEvent(event: Stripe.Event): Promise<void> {
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.payment_status !== "paid" || session.metadata?.kind !== "ai_points") return;
    const userId = session.metadata.userId;
    const points = Number(session.metadata.points);
    const amountTwd = Number(session.metadata.amountTwd);
    if (
      !userId ||
      !Number.isInteger(points) || points <= 0 ||
      !Number.isInteger(amountTwd) || amountTwd <= 0 ||
      session.currency !== "twd" ||
      session.amount_total !== amountTwd * 100 ||
      points !== amountTwd
    ) return;
    const user = await storage.getUser(userId);
    if (!user) return;
    await storage.creditPointPurchase({
      userId,
      points,
      amountTwd,
      stripeSessionId: session.id,
    });
    return;
  }
  if (event.type !== "invoice.paid") return;
  await grantPaidSubscriptionInvoice(event.data.object as Stripe.Invoice & Record<string, any>);
}