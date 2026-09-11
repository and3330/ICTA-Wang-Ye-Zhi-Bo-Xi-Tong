# Per-session registration counts

The owner-only `GET /api/webinars/:id/session-registration-counts` endpoint
returns the stable `SessionRegistrationCountsDto` shared contract:

```ts
{
  counts: Array<{
    key: string;
    startTimeISO: string | null;
    labelKind: "session" | "recurring" | "justInTime" | "onDemand" | "unassigned";
    status: "scheduled" | "live" | "ended" | "cancelled" | "unknown";
    registrationCount: number;
  }>;
  totalRegistered: number;
}
```

Timed `key` values use the label kind and canonical epoch milliseconds
(`session-<milliseconds>`, `recurring-<milliseconds>`, or
`justInTime-<milliseconds>`). `onDemand` and `unassigned` are null-start
buckets. The on-demand bucket is present (including at zero) only when
`scheduleMode.onDemand` is explicitly enabled. An unassigned bucket is present
only when it contains registrations.

The endpoint is owner scoped and never public. The existing
`GET /api/webinars/stats/summary` response includes the same DTO at
`stats[webinarId].sessionRegistrationCounts`; that batch path uses one SQL
registration aggregate and one session metadata query for all of the owner's
webinars.