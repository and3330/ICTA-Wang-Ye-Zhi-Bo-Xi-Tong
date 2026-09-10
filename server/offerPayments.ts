import type Stripe from "stripe";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import {
  ctaButtons,
  registrations,
  stripeWebhookEvents,
  webinarFunnelEvents,
  webinarOffers,
  webinarPayments,
  webinarPendingRefunds,
  webinars,
} from "@shared/schema";
import { sha256 } from "./funnelAnalytics";

const metadataId = (value: string | undefined) =>
  value && /^[0-9a-f-]{36}$/i.test(value) ? value : null;

export function assertOfferAttribution(input: {
  webinarId: string;
  offer: { webinarId: string | null; stripePriceId: string | null };
  cta?: { webinarId: string; offerId: string | null };
  offerId: string;
  stripePriceId: string | undefined;
  registrationWebinarId?: string;
}) {
  if (
    input.offer.webinarId !== input.webinarId ||
    (input.cta !== undefined && (
      input.cta.webinarId !== input.webinarId
    )) ||
    input.offer.stripePriceId !== input.stripePriceId ||
    (input.registrationWebinarId !== undefined && input.registrationWebinarId !== input.webinarId)
  ) {
    throw new Error("Cross-webinar or mismatched offer attribution");
  }
}

export function calculateRefundDelta(amountMinor: number, previouslyRefundedMinor: number, cumulativeRefundMinor: number) {
  return Math.max(0, Math.min(amountMinor, Math.max(0, cumulativeRefundMinor)) - previouslyRefundedMinor);
}

export const providerEventDedupeKey = (eventId: string) => sha256(`stripe:${eventId}`);

export function reconcileRefundCumulatives(
  amountMinor: number,
  previouslyRefundedMinor: number,
  cumulativeRefunds: number[],
) {
  const cumulativeRefundMinor = Math.min(amountMinor, Math.max(previouslyRefundedMinor, ...cumulativeRefunds, 0));
  return {
    refundedMinor: cumulativeRefundMinor,
    refundDelta: cumulativeRefundMinor - previouslyRefundedMinor,
    status: cumulativeRefundMinor >= amountMinor ? "refunded" : cumulativeRefundMinor > 0 ? "partially_refunded" : "paid",
  } as const;
}

async function lockPayment(tx: any, paymentIntentId: string) {
  // The row lock serializes independent, verified refund event deliveries.
  await tx.execute(sql`SELECT 1 FROM webinar_payments WHERE stripe_payment_intent_id = ${paymentIntentId} FOR UPDATE`);
  const [payment] = await tx.select().from(webinarPayments)
    .where(eq(webinarPayments.stripePaymentIntentId, paymentIntentId));
  return payment;
}

async function lockPaymentIntent(tx: any, paymentIntentId: string) {
  // This also covers the tiny interval before a payment row exists: a refund
  // delivered first cannot commit its pending state between payment creation
  // and that payment's pending-refund scan.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${paymentIntentId}))`);
}

async function resolveOfferOwnerId(
  tx: any,
  offer: Pick<typeof webinarOffers.$inferSelect, "userId" | "webinarId">,
): Promise<string> {
  if (offer.userId) return offer.userId;
  if (offer.webinarId) {
    const [webinar] = await tx.select({ userId: webinars.userId }).from(webinars)
      .where(eq(webinars.id, offer.webinarId)).limit(1);
    if (webinar?.userId) return webinar.userId;
  }
  throw new Error("Offer owner could not be resolved");
}

async function resolvePaymentOwnerId(
  tx: any,
  payment: Pick<typeof webinarPayments.$inferSelect, "userId" | "webinarId" | "offerId">,
): Promise<string> {
  const [offer] = await tx.select({
    userId: webinarOffers.userId,
    webinarId: webinarOffers.webinarId,
  }).from(webinarOffers).where(eq(webinarOffers.id, payment.offerId)).limit(1);
  if (!offer) throw new Error("Payment offer not found");
  let offerOwnerId: string | null = null;
  try {
    offerOwnerId = await resolveOfferOwnerId(tx, offer);
  } catch {
    if (!payment.userId) throw new Error("Payment owner could not be resolved");
  }
  if (payment.userId && payment.userId !== offerOwnerId) {
    if (!offerOwnerId) return payment.userId;
    throw new Error("Payment owner does not match offer owner");
  }
  if (!payment.userId && !offerOwnerId) throw new Error("Payment owner could not be resolved");
  return payment.userId || offerOwnerId!;
}

async function reconcilePendingRefunds(tx: any, paymentIntentId: string, payment: typeof webinarPayments.$inferSelect) {
  const pending: Array<typeof webinarPendingRefunds.$inferSelect> = await tx.select().from(webinarPendingRefunds).where(and(
    eq(webinarPendingRefunds.stripePaymentIntentId, paymentIntentId),
    isNull(webinarPendingRefunds.reconciledAt),
  ));
  if (!pending.length) return;
  const transition = reconcileRefundCumulatives(
    payment.amountMinor,
    payment.refundedMinor,
    pending.map(item => item.cumulativeRefundMinor),
  );
  if (transition.refundDelta > 0) {
    const ownerId = await resolvePaymentOwnerId(tx, payment);
    await tx.update(webinarPayments).set({
      userId: ownerId,
      refundedMinor: transition.refundedMinor,
      status: transition.status,
      updatedAt: new Date(),
    }).where(eq(webinarPayments.id, payment.id));
    await tx.insert(webinarFunnelEvents).values({
      userId: ownerId,
      webinarId: payment.webinarId,
      eventType: "refund",
      registrationId: payment.registrationId,
      ctaId: payment.ctaId,
      offerId: payment.offerId,
      visitorTokenHash: payment.visitorTokenHash,
      amountMinor: transition.refundDelta,
      currency: payment.currency,
      // A combined pending reconciliation still has a stable, non-replayable
      // event key because all provider IDs are represented in this digest.
      dedupeKey: sha256(`stripe-refunds:${pending.map(item => item.stripeEventId).sort().join(":")}`),
      metadata: { serverRecorded: true },
    });
  }
  await tx.update(webinarPendingRefunds).set({ reconciledAt: new Date() })
    .where(and(eq(webinarPendingRefunds.stripePaymentIntentId, paymentIntentId), isNull(webinarPendingRefunds.reconciledAt)));
}

/**
 * Applies only domain payment effects. The caller must verify the Stripe
 * signature before invoking this function.
 */
export async function processVerifiedOfferPaymentEvent(event: Stripe.Event): Promise<{ duplicate: boolean }> {
  return db.transaction(async (tx) => {
    const claimed = await tx.insert(stripeWebhookEvents).values({
      id: event.id,
      eventType: event.type,
    }).onConflictDoNothing({ target: stripeWebhookEvents.id }).returning({ id: stripeWebhookEvents.id });
    if (!claimed[0]) return { duplicate: true };

    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.payment_status !== "paid" || session.metadata?.kind !== "webinar_offer") {
        return { duplicate: false };
      }
      const webinarId = metadataId(session.metadata.webinarId);
      const offerId = metadataId(session.metadata.offerId);
      const ctaId = metadataId(session.metadata.ctaId);
      const registrationId = metadataId(session.metadata.registrationId);
      const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
      const amountMinor = session.amount_total;
      const currency = session.currency?.toUpperCase();
      if (!webinarId || !offerId || !paymentIntentId || !Number.isInteger(amountMinor) || amountMinor! < 0 || !currency) {
        throw new Error("Invalid webinar offer checkout attribution");
      }
      await lockPaymentIntent(tx, paymentIntentId);

      const [offer] = await tx.select().from(webinarOffers)
        .where(and(eq(webinarOffers.id, offerId), eq(webinarOffers.webinarId, webinarId)));
      const [cta] = ctaId
        ? await tx.select().from(ctaButtons)
          .where(and(eq(ctaButtons.id, ctaId), eq(ctaButtons.webinarId, webinarId)))
        : [undefined];
      if (!offer || (ctaId && !cta)) throw new Error("Cross-webinar or mismatched offer attribution");
      const ownerId = await resolveOfferOwnerId(tx, offer);
      let registrationWebinarId: string | undefined;
      if (registrationId) {
        const [registration] = await tx.select({ id: registrations.id, webinarId: registrations.webinarId }).from(registrations)
          .where(and(eq(registrations.id, registrationId), eq(registrations.webinarId, webinarId)));
        if (!registration) throw new Error("Cross-webinar registration attribution");
        registrationWebinarId = registration.webinarId;
      }
      assertOfferAttribution({
        webinarId, offer, cta, offerId,
        stripePriceId: session.metadata.stripePriceId,
        registrationWebinarId,
      });

      const visitorTokenHash = session.metadata.visitorTokenHash || null;
      const pendingPaymentId = metadataId(session.metadata.paymentId);
      const [precreated] = pendingPaymentId ? await tx.select().from(webinarPayments)
        .where(eq(webinarPayments.id, pendingPaymentId)).limit(1) : [undefined];
      if (precreated && (
        precreated.webinarId !== webinarId || precreated.offerId !== offerId ||
        precreated.ctaId !== ctaId || precreated.registrationId !== registrationId ||
        precreated.amountMinor !== amountMinor || precreated.currency !== currency ||
        precreated.checkoutStatusTokenHash !== (session.metadata.checkoutStatusTokenHash || null) ||
        precreated.originSalesPageIdSnapshot !== (metadataId(session.metadata.originSalesPageIdSnapshot) || null) ||
        precreated.salesPageVersion !== (session.metadata.salesPageVersion ? Number(session.metadata.salesPageVersion) : null)
      )) throw new Error("Mismatched pre-created payment attribution");
      const precreatedChanged = precreated?.status === "pending"
        ? await tx.update(webinarPayments).set({
            stripeCheckoutSessionId: session.id,
             userId: ownerId,
            stripePaymentIntentId: paymentIntentId,
            status: "paid",
            purchasedAt: new Date(),
            updatedAt: new Date(),
          }).where(and(eq(webinarPayments.id, precreated.id), eq(webinarPayments.status, "pending")))
          .returning({ id: webinarPayments.id })
        : [];
      const inserted = precreated ? [] : await tx.insert(webinarPayments).values({
        userId: ownerId,
        webinarId,
        offerId,
        ctaId,
        registrationId,
        visitorTokenHash,
        stripeCheckoutSessionId: session.id,
        checkoutStatusTokenHash: session.metadata.checkoutStatusTokenHash || null,
        salesPageId: metadataId(session.metadata.salesPageId) || null,
        originSalesPageIdSnapshot: metadataId(session.metadata.originSalesPageIdSnapshot) || null,
        salesPageVersion: session.metadata.salesPageVersion ? Number(session.metadata.salesPageVersion) : null,
        stripePaymentIntentId: paymentIntentId,
        amountMinor: amountMinor!,
        currency,
        status: "paid",
         purchasedAt: new Date(),
      }).onConflictDoNothing({ target: webinarPayments.stripeCheckoutSessionId })
        .returning({ id: webinarPayments.id });
      // Checkout now creates a pending row before redirect. Upgrade that row
      // here as well as supporting the historical webhook-first path.
      let paidApplied = Boolean(inserted[0] || precreatedChanged[0]);
      if (!inserted[0] && !precreated) {
        const [pending] = await tx.select({ id: webinarPayments.id, status: webinarPayments.status })
          .from(webinarPayments)
          .where(eq(webinarPayments.stripeCheckoutSessionId, session.id))
          .limit(1);
        if (pending?.status === "pending") {
          const changed = await tx.update(webinarPayments).set({
            userId: ownerId,
            stripePaymentIntentId: paymentIntentId,
            amountMinor: amountMinor!,
            currency,
            status: "paid",
            purchasedAt: new Date(),
            updatedAt: new Date(),
          }).where(and(eq(webinarPayments.id, pending.id), eq(webinarPayments.status, "pending")))
            .returning({ id: webinarPayments.id });
          paidApplied = Boolean(changed[0]);
        }
      }
      if (paidApplied) {
        await tx.insert(webinarFunnelEvents).values({
          userId: ownerId,
          webinarId,
          eventType: "purchase",
          registrationId,
          ctaId,
          ctaKey: cta?.ctaKey,
          offerId,
          visitorTokenHash,
          amountMinor: amountMinor!,
          currency,
          dedupeKey: providerEventDedupeKey(event.id),
          metadata: { serverRecorded: true },
        }).onConflictDoNothing({
          target: [webinarFunnelEvents.webinarId, webinarFunnelEvents.dedupeKey],
        });
      }
      const payment = await lockPayment(tx, paymentIntentId);
      if (!payment) throw new Error("Unable to lock webinar payment");
      await reconcilePendingRefunds(tx, paymentIntentId, payment);
      return { duplicate: false };
    }

    if (event.type === "charge.refunded") {
      const charge = event.data.object as Stripe.Charge;
      const paymentIntentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
      if (!paymentIntentId) return { duplicate: false };
      await lockPaymentIntent(tx, paymentIntentId);
      await tx.insert(webinarPendingRefunds).values({
        stripeEventId: event.id,
        stripePaymentIntentId: paymentIntentId,
        cumulativeRefundMinor: Math.max(0, charge.amount_refunded || 0),
        currency: charge.currency?.toUpperCase() || null,
      }).onConflictDoNothing({
        target: webinarPendingRefunds.stripeEventId,
      });
      const payment = await lockPayment(tx, paymentIntentId);
      if (payment) await reconcilePendingRefunds(tx, paymentIntentId, payment);
    }
    return { duplicate: false };
  });
}

/** Applies a previously authenticated ECPay server callback idempotently. */
export async function processVerifiedEcpayPayment(providerOrderId: string): Promise<{ duplicate: boolean }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT 1 FROM webinar_payments WHERE provider_order_id = ${providerOrderId} FOR UPDATE`);
    const [payment] = await tx.select().from(webinarPayments)
      .where(and(eq(webinarPayments.providerOrderId, providerOrderId), eq(webinarPayments.paymentProvider, "ecpay")));
    if (!payment) throw new Error("ECPay order not found");
    if (payment.status === "paid") return { duplicate: true };
    if (payment.status !== "pending") throw new Error("ECPay order is not payable");
    const [cta] = payment.ctaId
      ? await tx.select().from(ctaButtons).where(eq(ctaButtons.id, payment.ctaId))
      : [undefined];
    const [offer] = await tx.select({
      id: webinarOffers.id,
      userId: webinarOffers.userId,
      webinarId: webinarOffers.webinarId,
    }).from(webinarOffers).where(eq(webinarOffers.id, payment.offerId));
    const ownerId = offer ? await resolvePaymentOwnerId(tx, payment) : null;
    const ctaMatches = !payment.ctaId || (
      cta &&
      cta.webinarId === payment.webinarId
    );
    if (!offer || !ownerId || (payment.userId && payment.userId !== ownerId) || !ctaMatches) {
      throw new Error("Invalid persisted ECPay attribution");
    }
    const changed = await tx.update(webinarPayments).set({
      status: "paid",
      userId: ownerId,
      purchasedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(eq(webinarPayments.id, payment.id), eq(webinarPayments.status, "pending")))
      .returning({ id: webinarPayments.id });
    if (!changed[0]) return { duplicate: true };
    await tx.insert(webinarFunnelEvents).values({
      userId: ownerId,
      webinarId: payment.webinarId,
      eventType: "purchase",
      registrationId: payment.registrationId,
      ctaId: payment.ctaId,
      ctaKey: cta?.ctaKey,
      offerId: payment.offerId,
      salesPageId: payment.salesPageId,
      visitorTokenHash: payment.visitorTokenHash,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      dedupeKey: sha256(`ecpay:${providerOrderId}`),
      metadata: { serverRecorded: true },
    }).onConflictDoNothing();
    return { duplicate: false };
  });
}