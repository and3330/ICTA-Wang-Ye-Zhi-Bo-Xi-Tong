# Complete premium sales-script generator

Private owner APIs (all require the existing webinar-owner middleware):

- `GET /api/webinars/:id/sales-script` returns the owner's saved questionnaire,
  immutable job history, and the real credit-lot balance.
- `PUT /api/webinars/:id/sales-script/draft` saves `{ answers }`.
- `POST /api/webinars/:id/sales-script/jobs` requires
  `{ answers, ackCost: 3600, idempotencyKey }` and returns `202`.
- `GET /api/webinars/:id/sales-script/jobs/:jobId` returns a result only after
  it has completed and the 3600-point reservation is consumed.

Questionnaire fields are exported from `shared/salesScriptQuestionnaire.ts`;
required IDs are `planName`, `instructor`, `audience`, `painPoints`, `modules`,
`pricing`, and `bonuses` (`無贈品` is a valid truthful answer). The server accepts additional string
answers for supplied proof, guarantees, scarcity, and stories.

Every job is charged exactly 3600 points from normal AI credit lots, including
enterprise and administrator accounts. This API never reserves no-card trial
calls. Admission atomically reserves lots and creates the job. Worker
checkpoints are server-only, recover under a lease after restart, and are never
returned before the final output/artifact/reservation consumption transaction.
Provider timeout, malformed/incomplete output, and bounded job timeout fail the
job and refund the same reservation exactly once.