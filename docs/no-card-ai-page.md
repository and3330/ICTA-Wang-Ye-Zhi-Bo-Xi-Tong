# AI sales-page draft API

`POST /api/product-sales-pages/:pageId/ai-draft` creates a **draft proposal
only** for an existing, owner-authorized product sales page. It never saves,
publishes, changes a public snapshot, creates images, or initiates payment.

Body:

```ts
{ brief: string; audience?: string }
```

`brief` is trimmed and limited to 2,000 characters; `audience` is optional and
limited to 1,000. The server supplies the actual product name and price to the
model and validates the returned data into safe existing editor block types.
The model cannot supply block IDs, prices, HTML, testimonials, image URLs, or
an offer ID.

Success:

```ts
{
  blocks: SalesPageBlock[]; // safe, editor-compatible draft blocks only
  cost: { kind: "trial_call" | "ai_points" | "unlimited"; amount: number; remaining: number | null };
}
```

An active no-card trial consumes one of its shared 50 provider-call ledger
entries (`trial_call`, amount `1`). Paid/manual access uses the established
five-point generation cost (`ai_points`, amount `5`); enterprise access is
`unlimited`, amount `0`. A failed provider response or invalid model JSON
refunds the reservation. It may generate a proposal while a page has a live
published snapshot; the editor must explicitly apply the returned blocks and
then save/publish to change that snapshot.