# No-card trial commerce API

An active no-card trial may use the **existing** product and sales-page editor
APIs:

1. `POST /api/products` creates the normal product.
2. `POST /api/product-sales-pages` creates the normal sales page.
3. `POST /api/product-sales-pages/:pageId/publish` publishes the normal
   snapshot.

The server atomically records the first sales page made during an active trial
and rejects a second page with `409` and
`code: "TRIAL_PRODUCT_PAGE_LIMIT"`. Do not implement this limit in the UI.
Edits continue to use the existing `PATCH /api/product-sales-pages/:pageId`
route. Publishing does not require ECPay credentials for a no-card trial; its
public CTA is lead capture, not checkout.

## Platform URL

The only public URL is the platform route:

```text
/sales/:slug
```

The public DTO includes `platformUrl` with that same relative route. Resolve it
against the current SellCase platform origin. Do not offer custom domains,
unbranding, team access, external redirect, embeds, or a DNS/wildcard-host
fallback for this trial.

## Public page DTO

`GET /api/sales-pages/:slug` returns the existing public sales-page DTO for
paid pages. For an active no-card trial it returns this stricter DTO instead:

```ts
type TrialCommercePublicPage = {
  id: string;
  webinarId: string | null;
  offerId: string;
  slug: string;
  title: string;
  platformUrl: `/sales/${string}`;
  blocks: unknown[];                  // immutable published snapshot
  checkoutSettings: {
    transitionTitle: string;
    transitionMessage: string;
    cancelTitle: string;
    cancelMessage: string;
  };
  publishedAt: string | null;
  offer: {
    paymentProvider: "lead_capture";
    checkoutMode: "lead_capture";
    name: string;
    amountMinor: number | null;       // display only; never submit for payment
    currency: "TWD";
  };
  // True only while the no-card entitlement is active. A paid/manual owner
  // without verified ECPay remains lead capture but is no longer trial-branded.
  trialBrandingRequired: boolean;
  brand: {
    name: "SellCase";
    localizedName: "開賣啦";
    poweredBy: "Powered by SellCase 開賣啦";
  };
  leadCapture: {
    enabled: true;
    requiredFields: readonly ["name", "email", "consent"];
    consentRequired: true;
    endpoint: string;
  };
};
```

Always render `brand.poweredBy` while `trialBrandingRequired` is true. It is
server-supplied and there is no request field or client setting that can remove
it. Render the lead form whenever `leadCapture.enabled` is true; do **not**
call the ECPay checkout endpoint for this DTO.

After expiration the public GET returns `410` with
`{ code: "TRIAL_EXPIRED", status: "paused", slug, platformUrl }`; it contains
no contacts or page content. Public events, leads, and checkout stop
immediately (lead/events return the same `410` DTO). Data is retained.

Once a paid or manual entitlement is active, the original published
sales-page snapshot remains at the same `/sales/:slug` URL. It stays on this
lead-capture DTO until the owner explicitly has an enabled, verified ECPay
merchant configuration. Only then does the ordinary paid public DTO and
genuine checkout resume.

While this DTO is lead capture, the generic payment/event paths return `409`
with `code: "TRIAL_LEAD_CAPTURE_ONLY"` and must never be used to start
payment:

* `POST /api/products/:offerId/checkout`
* `POST /api/products/:offerId/events`
* `POST /api/sales-pages/:slug/checkout`
* `POST /api/sales-pages/:slug/events`

## Public lead form

`POST /api/trial-commerce/sales-pages/:slug/leads`

```ts
type TrialLeadRequest = {
  name: string;       // trimmed, 1..200
  email: string;      // valid email, normalized lowercase by server
  consent: true;      // required
};

type TrialLeadResponse = {
  accepted: true;
  deduplicated: boolean;
};
```

The response is `201` for a newly stored lead and `200` for a normalized-email
duplicate. A malformed request is `400`; an expired page is `410` with the
paused trial DTO; an unpublished or unknown page is `404`; rate limiting is
`429`.

## Public view event

`POST /api/trial-commerce/sales-pages/:slug/events`

```ts
type TrialViewEventRequest = {
  visitorToken: string; // opaque `[A-Za-z0-9_-]`, 16..256 chars
  dedupeKey: string;    // `[A-Za-z0-9_.:-]`, 8..128 chars
};

type TrialViewEventResponse = {
  accepted: true;
  deduplicated: boolean;
};
```

The server hashes visitor tokens, accepts only page views, and counts a
dedupe-key once. Send one event after a successful public page render.

## Owner APIs

Both endpoints require the normal authenticated owner session. They remain
readable after expiration so retained leads are accessible.

`GET /api/trial-commerce/leads?page=1&pageSize=25`

```ts
type TrialLeadList = {
  items: Array<{
    id: string;
    name: string;
    email: string;
    consentedAt: string;
    createdAt: string;
  }>;
  page: number;
  pageSize: number;
  total: number;
};
```

`GET /api/trial-commerce/stats`

```ts
type TrialCommerceStats = {
  visitors: number;   // distinct hashed visitor tokens
  leads: number;      // deduplicated normalized emails
  conversion: number; // leads / visitors * 100, rounded to two decimals
};
```