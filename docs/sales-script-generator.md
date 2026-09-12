# Complete premium sales-script generator

Private owner APIs (all require the existing webinar-owner middleware):

- `GET /api/webinars/:id/sales-script` returns balance, job history, public
  five-field draft data before payment, and
  `purchase: { id, status, jobId? } | null`, `hasPurchasedAccess`, and
  `canGenerate`. It never includes confidential question definitions.
- `PUT /api/webinars/:id/sales-script/draft` saves `{ answers }`. Before
  purchase it accepts only the five public fields and merges them into the
  stored draft, so pre-existing confidential data is not overwritten.
- `POST /api/webinars/:id/sales-script/purchase` requires
  `{ answers: <five basic fields>, ackCost: 3600, idempotencyKey }` and returns
  `202` with the purchase/access DTO. It atomically reserves 3600 points; it
  does not create a job or call AI.
- `GET /api/webinars/:id/sales-script/questionnaire` returns `{ groups }` only
  with a valid paid entitlement, otherwise `402`. This is the sole full
  questionnaire-definition endpoint.
- `POST /api/webinars/:id/sales-script/jobs` requires
  `{ purchaseId, answers: <full answers>, idempotencyKey }` and returns `202`.
  It transfers the existing purchase reservation and never performs a second
  debit or balance check.
- `GET /api/webinars/:id/sales-script/jobs/:jobId` returns a result only after
  it has completed and the 3600-point reservation is consumed.

`shared/salesScriptQuestionnaire.ts` is browser-safe and contains only the
five basic ids/types (`planName`, `audience`, `painPoints`, `modules`,
`pricing`). Full optional/required labels, help, examples and groups
are server-only in `server/salesScriptQuestionnairePrivate.ts`. Full required
ids are `planName`, `instructor`, `audience`, `painPoints`, `modules`,
`pricing`, and `bonuses` (`無贈品` is valid).

Every purchase is charged exactly 3600 points from normal AI credit lots,
including enterprise and administrator accounts. It never reserves no-card
trial calls. A `ready` or `generating` purchase reservation is explicitly
excluded from the generic 15-minute stale reservation sweep, so a customer can
take longer than fifteen minutes to complete the confidential questionnaire.
Only job creation starts the 45-minute worker deadline. A job consumes that
same reservation on completion. Failure refunds it exactly once and marks the
purchase `refunded`, revoking access unless an older completed paid job grants
historical access. Completed paid jobs retain question/download access forever,
but do not grant a free regeneration: another generation needs another
purchase.