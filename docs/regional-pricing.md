# Regional pricing contract

`shared/pricing.ts` is the single public pricing-reference shape shared by
the server and client.  It intentionally contains both the USD checkout
prices and fixed TWD display references:

```ts
type RegionalPlanPricing = {
  monthlyUSD: number;
  annualUSD: number;
  monthlyTWDReference: number;
  annualTWD: number;             // monthlyTWDReference * 12 * 0.85
  equivalentMonthlyTWD: number;  // monthlyTWDReference * 0.85
};

const PLAN_PRICING = {
  starter: { monthlyUSD: 29, annualUSD: 295.8, monthlyTWDReference: 890 },
  growth:  { monthlyUSD: 99, annualUSD: 1009.8, monthlyTWDReference: 3000 },
  scale:   { monthlyUSD: 199, annualUSD: 2029.8, monthlyTWDReference: 6000 },
};
```

The concrete object also materializes `annualTWD` and
`equivalentMonthlyTWD` using the formulas above.  TWD values are fixed
references, not live FX conversions.  `countryCode` is a presentation input
only; the server's pricing-region endpoint owns geo selection.  Stripe
checkout accepts USD catalog Prices only and must not receive the TWD
references.

The public Starter USD 29 prices use dedicated lookup keys
`icta_webinar_starter_monthly_usd29` and
`icta_webinar_starter_annual_usd29580`.  The existing
`icta_webinar_starter_monthly` and `icta_webinar_starter_annual` keys remain
active on USD 39 / USD 397.80 Prices for already-deployed checkout and
grandfathered subscriptions.  Price changes never mutate an existing Stripe
Price; the server resolves old subscription items from their trusted product
metadata and reports the actual subscribed amount.  The new Starter product
uses `ictaCatalogKey: "starter"`, `priceVersion: "usd29"`,
`webinarCapacity: "1"`, and `monthlyRegistrants: "1000"`; only a product with
that complete identity may be reused.  Growth, Scale, and add-on keys are
unchanged.