import { getStripeSync } from './stripeClient';
import type Stripe from "stripe";
import { processVerifiedOfferPaymentEvent } from "./offerPayments";
import { processSubscriptionCreditEvent } from "./subscriptionCreditGrants";

export class WebhookHandlers {
  static async processWebhook(
    payload: Buffer,
    signature: string,
    dependencies: {
      verifyAndSync?: (payload: Buffer, signature: string) => Promise<void>;
      applyVerifiedEvent?: typeof processVerifiedOfferPaymentEvent;
      applySubscriptionCreditEvent?: typeof processSubscriptionCreditEvent;
    } = {},
  ): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        'STRIPE WEBHOOK ERROR: Payload must be a Buffer. ' +
        'Received type: ' + typeof payload + '. ' +
        'This usually means express.json() parsed the body before reaching this handler. ' +
        'FIX: Ensure webhook route is registered BEFORE app.use(express.json()).'
      );
    }

    if (dependencies.verifyAndSync) {
      await dependencies.verifyAndSync(payload, signature);
    } else {
      const sync = await getStripeSync();
      await sync.processWebhook(payload, signature);
    }
    // StripeSync accepted the signature above. Only verified payloads reach
    // application payment attribution.
    const event = JSON.parse(payload.toString("utf8")) as Stripe.Event;
    await (dependencies.applyVerifiedEvent || processVerifiedOfferPaymentEvent)(event);
    await (dependencies.applySubscriptionCreditEvent || processSubscriptionCreditEvent)(event);
  }
}
