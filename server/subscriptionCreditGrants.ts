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

export function annualMonthlyGrantDates(periodStart: Date, now: Date): Date[] {
  if (now < periodStart) return [];
  const dates: Date[] = [];
  for (let month = 0; month < 12; month += 1) {
    const date = new Date(periodStart);
    const targetMonth = periodStart.getUTCMonth() + month;
    date.setUTCDate(1);
    date.setUTCMonth(targetMonth);
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(periodStart.getUTCDate(), lastDay));
    if (date <= now) dates.push(date);
  }
  return dates;
}

export function hasRemainingPaidAmount(payments: Array<{ amount: number; amountRefunded: number }>): boolean {
  return payments.reduce((sum, payment) => sum + Math.max(0, payment.amount - payment.amountRefunded), 0) > 0;
}

async function annualInvoiceHasRemainingPayment(stripe: Stripe, invoiceId: string): Promise<boolean> {
  const invoicePayments = await stripe.invoicePayments.list({
    invoice: invoiceId,
    status: "paid",
    expand: ["data.payment.payment_intent"],
    limit: 100,
  });
  const payments: Array<{ amount: number; amountRefunded: number }> = [];
  for (const invoicePayment of invoicePayments.data) {
    if (invoicePayment.payment.type === "payment_intent" && invoicePayment.payment.payment_intent) {
      const paymentIntent = typeof invoicePayment.payment.payment_intent === "string"
        ? await stripe.paymentIntents.retrieve(invoicePayment.payment.payment_intent, { expand: ["latest_charge"] })
        : invoicePayment.payment.payment_intent;
      const charge = typeof paymentIntent.latest_charge === "string"
        ? await stripe.charges.retrieve(paymentIntent.latest_charge)
        : paymentIntent.latest_charge;
      if (charge) payments.push({ amount: charge.amount, amountRefunded: charge.amount_refunded });
    } else if (invoicePayment.payment.type === "charge" && invoicePayment.payment.charge) {
      const charge = typeof invoicePayment.payment.charge === "string"
        ? await stripe.charges.retrieve(invoicePayment.payment.charge)
        : invoicePayment.payment.charge;
      payments.push({ amount: charge.amount, amountRefunded: charge.amount_refunded });
    }
  }
  return hasRemainingPaidAmount(payments);
}

export function monthlyGiftForLookupKeys(lookupKeys: Array<string | null | undefined>): { planKey: SubscriptionPlanKey; points: number } | null {
  for (const [planKey, plan] of Object.entries(SUBSCRIPTION_PLANS) as Array<[SubscriptionPlanKey, typeof SUBSCRIPTION_PLANS[SubscriptionPlanKey]]>) {
    if (lookupKeys.includes(plan.lookupKey) || lookupKeys.includes(plan.annualLookupKey)) {
      return { planKey, points: plan.monthlyAiPoints };
    }
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
  const prices = await Promise.all(priceIds.map((priceId) => stripe.prices.retrieve(priceId, { expand: ["product"] })));
  const gift = monthlyGiftForLookupKeys(prices.flatMap((price) => {
    const keys: Array<string | null | undefined> = [price.lookup_key];
    if (typeof price.product !== "string" && !("deleted" in price.product)) {
      const catalogKey = price.product.metadata?.ictaCatalogKey;
      if (catalogKey && catalogKey in SUBSCRIPTION_PLANS) {
        keys.push(SUBSCRIPTION_PLANS[catalogKey as SubscriptionPlanKey].lookupKey);
      }
    }
    return keys;
  }));
  if (!gift) return;

  const paidTimestamp = invoice.status_transitions?.paid_at || invoice.created;
  const grantedAt = new Date(paidTimestamp * 1000);
  const annualPrice = prices.find((price) => price.recurring?.interval === "year");
  const subscriptionId = typeof invoice.parent?.subscription_details?.subscription === "string"
    ? invoice.parent.subscription_details.subscription
    : (invoice.parent?.subscription_details?.subscription as Stripe.Subscription | undefined)?.id;
  const annualPeriodStart = lineItems.data.find((line) => {
    const priceId = line.pricing?.price_details?.price;
    return priceId === annualPrice?.id;
  })?.period?.start;
  if (annualPrice && subscriptionId && annualPeriodStart) {
    if (user.stripeSubscriptionId !== subscriptionId) {
      await storage.updateUser(user.id, { stripeSubscriptionId: subscriptionId });
    }
    const idempotencyKeyPrefix = `annual-subscription-month:${subscriptionId}:${annualPeriodStart}:`;
    await storage.reconcileAnnualAiCredits({
      userId: user.id,
      idempotencyKeyPrefix,
      grants: [{
        points: gift.points,
        grantedAt,
        expiresAt: oneYearAfter(grantedAt),
        idempotencyKey: `${idempotencyKeyPrefix}0`,
      }],
      verifyPayment: () => annualInvoiceHasRemainingPayment(stripe, invoice.id),
    });
    return;
  }
  await storage.grantAiCredits({
    userId: user.id,
    points: gift.points,
    source: "monthly_gift",
    grantedAt,
    expiresAt: oneYearAfter(grantedAt),
    idempotencyKey: `subscription-invoice:${invoice.id}`,
  });
}

export async function grantDueAnnualSubscriptionCredits(now = new Date()): Promise<void> {
  const stripe = await getUncachableStripeClient();
  const users = await storage.listAllUsers();
  for (const user of users) {
    if (!user.stripeSubscriptionId) continue;
    try {
      const subscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId, {
        expand: ["items.data.price.product"],
      });
      if (!["active", "trialing"].includes(subscription.status)) continue;
      const annualItem = subscription.items.data.find((item) => {
        const price = item.price;
        const product = typeof price.product === "string" || "deleted" in price.product ? null : price.product;
        return price.recurring?.interval === "year"
          && Boolean(product?.metadata?.ictaCatalogKey && product.metadata.ictaCatalogKey in SUBSCRIPTION_PLANS);
      });
      if (!annualItem) continue;
      const periodStartSeconds = annualItem.current_period_start;
      const periodEndSeconds = annualItem.current_period_end;
      if (!periodStartSeconds || !periodEndSeconds || now.getTime() >= periodEndSeconds * 1000) continue;

      const invoices = await stripe.invoices.list({
        subscription: subscription.id,
        status: "paid",
        created: { gte: periodStartSeconds - 24 * 60 * 60 },
        limit: 10,
      });
      const annualInvoices: Stripe.Invoice[] = [];
      for (const invoice of invoices.data) {
        if (!isPaidBillableSubscriptionInvoice(invoice)) continue;
        const lines = await stripe.invoices.listLineItems(invoice.id, { limit: 100 });
        if (lines.data.some((line) => line.pricing?.price_details?.price === annualItem.price.id)) {
          annualInvoices.push(invoice);
        }
      }
      if (annualInvoices.length === 0) continue;

      const product = annualItem.price.product as Stripe.Product;
      const planKey = product.metadata.ictaCatalogKey as SubscriptionPlanKey;
      const periodStart = new Date(periodStartSeconds * 1000);
      const grantPrefix = `annual-subscription-month:${subscription.id}:${periodStartSeconds}:`;
      const dates = annualMonthlyGrantDates(periodStart, now);
      await storage.reconcileAnnualAiCredits({
        userId: user.id,
        idempotencyKeyPrefix: grantPrefix,
        grants: dates.map((grantedAt, month) => ({
          points: SUBSCRIPTION_PLANS[planKey].monthlyAiPoints,
          grantedAt,
          expiresAt: oneYearAfter(grantedAt),
          idempotencyKey: `${grantPrefix}${month}`,
        })),
        verifyPayment: async () => (await Promise.all(
          annualInvoices.map((invoice) => annualInvoiceHasRemainingPayment(stripe, invoice.id)),
        )).some(Boolean),
      });
    } catch (error) {
      console.error(`Annual subscription credit grant failed for user ${user.id}:`, error);
    }
  }
}

export function startAnnualSubscriptionCreditScheduler(): void {
  void grantDueAnnualSubscriptionCredits();
  setInterval(() => void grantDueAnnualSubscriptionCredits(), 6 * 60 * 60 * 1000);
}

async function reconcileRefundedAnnualCharge(charge: Stripe.Charge): Promise<void> {
  const paymentIntentId = typeof charge.payment_intent === "string"
    ? charge.payment_intent
    : charge.payment_intent?.id;
  if (!paymentIntentId) return;
  const stripe = await getUncachableStripeClient();
  const invoicePayments = await stripe.invoicePayments.list({
    payment: { type: "payment_intent", payment_intent: paymentIntentId },
    status: "paid",
    expand: ["data.invoice"],
    limit: 100,
  });
  for (const invoicePayment of invoicePayments.data) {
    const invoice = typeof invoicePayment.invoice === "string"
      ? await stripe.invoices.retrieve(invoicePayment.invoice)
      : invoicePayment.invoice;
    if ("deleted" in invoice) continue;
    const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
    const user = customerId ? await storage.getUserByStripeCustomerId(customerId) : undefined;
    if (!user) continue;
    const subscriptionId = typeof invoice.parent?.subscription_details?.subscription === "string"
      ? invoice.parent.subscription_details.subscription
      : invoice.parent?.subscription_details?.subscription?.id;
    if (!subscriptionId) continue;

    const lineItems = await stripe.invoices.listLineItems(invoice.id, { limit: 100 });
    const priceIds = Array.from(new Set(lineItems.data.flatMap((line) => {
      const priceId = line.pricing?.price_details?.price;
      return priceId ? [priceId] : [];
    })));
    const prices = await Promise.all(
      priceIds.map((priceId) => stripe.prices.retrieve(priceId, { expand: ["product"] })),
    );
    const annualPriceIds = new Set(prices.filter((price) => {
      const product = typeof price.product === "string" || "deleted" in price.product ? null : price.product;
      return price.recurring?.interval === "year"
        && Boolean(product?.metadata?.ictaCatalogKey && product.metadata.ictaCatalogKey in SUBSCRIPTION_PLANS);
    }).map((price) => price.id));
    const annualLine = lineItems.data.find((line) => {
      const priceId = line.pricing?.price_details?.price;
      return Boolean(priceId && annualPriceIds.has(priceId));
    });
    if (!annualLine?.period?.start) continue;

    const prefix = `annual-subscription-month:${subscriptionId}:${annualLine.period.start}:`;
    await storage.reconcileAnnualAiCredits({
      userId: user.id,
      idempotencyKeyPrefix: prefix,
      grants: [],
      verifyPayment: () => annualInvoiceHasRemainingPayment(stripe, invoice.id),
    });
  }
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
  if (event.type === "charge.refunded") {
    await reconcileRefundedAnnualCharge(event.data.object as Stripe.Charge);
    return;
  }
  if (event.type !== "invoice.paid") return;
  await grantPaidSubscriptionInvoice(event.data.object as Stripe.Invoice & Record<string, any>);
}