import type Stripe from "stripe";

export const PLATFORM_PIXEL_ID = "1096741902746313";

export type PlatformConversion = {
  eventName: "CompleteRegistration" | "Purchase";
  eventId: string;
  value?: number;
  currency?: string;
  accountMarker: string;
};

export type PlatformCheckoutStatus = "paid" | "pending" | "failed";

export type PlatformCheckoutValidation = {
  status: PlatformCheckoutStatus;
  conversion?: PlatformConversion;
};

type CheckoutSessionLike = Pick<
  Stripe.Checkout.Session,
  "id" | "mode" | "status" | "payment_status" | "amount_total" | "currency" | "customer" | "metadata"
>;

type LineItemLike = {
  price?: string | { id?: string | null } | null;
  quantity?: number | null;
};

function customerId(session: CheckoutSessionLike): string | null {
  return typeof session.customer === "string"
    ? session.customer
    : session.customer?.id || null;
}

function priceId(line: LineItemLike): string | null {
  return typeof line.price === "string" ? line.price : line.price?.id || null;
}

function assertOwnedSession(
  session: CheckoutSessionLike,
  input: { userId: string; stripeCustomerId: string | null; kind: string },
) {
  if (
    !session.id
    || session.metadata?.kind !== input.kind
    || session.metadata?.userId !== input.userId
    || !input.stripeCustomerId
    || customerId(session) !== input.stripeCustomerId
  ) {
    throw new Error("INVALID_PLATFORM_CHECKOUT");
  }
}

function assertSubscriptionLineItems(
  lines: LineItemLike[],
  expected: { basePriceId: string; addonPriceId?: string; addonQuantity: number },
) {
  const quantities = new Map<string, number>();
  for (const line of lines) {
    const id = priceId(line);
    const quantity = line.quantity;
    if (!id || !Number.isInteger(quantity) || quantity! <= 0) {
      throw new Error("INVALID_PLATFORM_CHECKOUT");
    }
    quantities.set(id, (quantities.get(id) || 0) + quantity!);
  }

  const expectedQuantities = new Map<string, number>([[expected.basePriceId, 1]]);
  if (expected.addonQuantity > 0) {
    if (!expected.addonPriceId) throw new Error("INVALID_PLATFORM_CHECKOUT");
    expectedQuantities.set(expected.addonPriceId, expected.addonQuantity);
  }
  if (
    quantities.size !== expectedQuantities.size
    || Array.from(expectedQuantities).some(([id, quantity]) => quantities.get(id) !== quantity)
  ) {
    throw new Error("INVALID_PLATFORM_CHECKOUT");
  }
}

function checkoutResult(
  session: CheckoutSessionLike,
  eventPrefix: string,
  accountMarker: string,
): PlatformCheckoutValidation {
  if (session.status === "expired") return { status: "failed" };
  if (session.payment_status !== "paid") return { status: "pending" };
  if (
    !Number.isInteger(session.amount_total)
    || session.amount_total! <= 0
    || typeof session.currency !== "string"
    || !/^[a-z]{3}$/i.test(session.currency)
  ) {
    throw new Error("INVALID_PLATFORM_CHECKOUT");
  }
  return {
    status: "paid",
    conversion: {
      eventName: "Purchase",
      eventId: `${eventPrefix}:${session.id}`,
      value: session.amount_total! / 100,
      currency: session.currency.toUpperCase(),
      accountMarker,
    },
  };
}

/**
 * Validates a subscription checkout using the account and the currently
 * approved catalog. The checkout session and its line items are the only
 * source of value/currency for the browser conversion event.
 */
export function validatePlatformSubscriptionCheckout(input: {
  session: CheckoutSessionLike;
  lineItems: LineItemLike[];
  userId: string;
  stripeCustomerId: string | null;
  planKey: string;
  billingInterval: string;
  addonWebinars: number;
  basePriceId: string;
  addonPriceId?: string;
}): PlatformCheckoutValidation {
  assertOwnedSession(input.session, {
    userId: input.userId,
    stripeCustomerId: input.stripeCustomerId,
    kind: "subscription",
  });
  if (
    input.session.mode !== "subscription"
    || input.session.metadata?.planKey !== input.planKey
    || input.session.metadata?.billingInterval !== input.billingInterval
    || input.session.metadata?.addonWebinars !== String(input.addonWebinars)
    || !Number.isInteger(input.addonWebinars)
    || input.addonWebinars < 0
    || input.addonWebinars > 50
  ) {
    throw new Error("INVALID_PLATFORM_CHECKOUT");
  }
  assertSubscriptionLineItems(input.lineItems, {
    basePriceId: input.basePriceId,
    addonPriceId: input.addonPriceId,
    addonQuantity: input.addonWebinars,
  });
  return checkoutResult(input.session, "platform_subscription", input.userId);
}

/**
 * Validates a paid AI-points checkout created by the existing recharge flow.
 * This deliberately does not credit points; fulfillment remains in the
 * existing confirm-recharge path.
 */
export function validatePlatformAiPointsCheckout(input: {
  session: CheckoutSessionLike;
  userId: string;
  stripeCustomerId: string | null;
  points: number;
  amountTwd: number;
}): PlatformCheckoutValidation {
  assertOwnedSession(input.session, {
    userId: input.userId,
    stripeCustomerId: input.stripeCustomerId,
    kind: "ai_points",
  });
  if (
    input.session.mode !== "payment"
    || input.session.currency?.toLowerCase() !== "twd"
    || input.session.metadata?.points !== String(input.points)
    || input.session.metadata?.amountTwd !== String(input.amountTwd)
    || !Number.isInteger(input.points)
    || input.points <= 0
    || !Number.isInteger(input.amountTwd)
    || input.amountTwd <= 0
    || input.points !== input.amountTwd
    || input.session.amount_total !== input.amountTwd * 100
  ) {
    throw new Error("INVALID_PLATFORM_CHECKOUT");
  }
  return checkoutResult(input.session, "platform_ai_points", input.userId);
}

export function signupConversion(eventId: string, accountMarker: string): PlatformConversion {
  return {
    eventName: "CompleteRegistration",
    eventId,
    accountMarker,
  };
}