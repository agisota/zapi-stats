# Realtime public statistics polling design

- **Date:** 2026-08-19
- **Status:** Approved
- **Reviewer:** repository owner

## Context

The public Analytics page currently refetches queries every 60 seconds, while several server-side statistics aggregates are cached for another 60 seconds. A visible dashboard can therefore lag newly recorded OmniRoute usage by nearly two minutes.

The dashboard must display newly eligible server-side statistics promptly without adding a persistent stream, modifying storage, or weakening the public privacy rules. The existing statistics endpoints already express the authoritative aggregate contract.

## Functional requirements

- **FR-1:** An open Analytics page MUST refetch its existing public statistics queries every 5 seconds.
- **FR-2:** The client MUST retain the latest successful query result while a refresh is pending or fails.
- **FR-3:** Live-facing server aggregates—leaderboard, overview, observed activity, timeline, and historical timeline—MUST use a cache TTL no greater than 5 seconds.
- **FR-4:** Model and provider aggregates MUST use a cache TTL no greater than 5 seconds when displayed by the Analytics page.
- **FR-5:** The implementation MUST NOT change endpoint paths, response payloads, SQLite schema, recovery import batches, pricing, or public aggregation/privacy eligibility.
- **FR-6:** The implementation MUST NOT establish WebSocket, SSE, or any other persistent client connection.

## Non-functional requirements

- **NFR-1:** A visible query result MUST be at most 5 seconds stale because of application caching, excluding upstream database-write latency and request transit time.
- **NFR-2:** Browser polling MUST remain client-initiated and reuse the established React Query lifecycle.
- **NFR-3:** Failed refreshes MUST preserve the prior rendered data and MUST NOT blank the dashboard.
- **NFR-4:** The implementation MUST preserve the three-distinct-key public aggregation threshold and recovered-history exception.

## Acceptance criteria

- **AC-1 (FR-1):** Given an open Analytics page, when five seconds elapse, then React Query schedules a refetch for its public statistics queries.
- **AC-2 (FR-3, FR-4):** Given a new eligible `usage_history` row, when an aggregate endpoint is requested more than five seconds after its previous computation, then it includes the row according to existing query semantics.
- **AC-3 (FR-2, NFR-3):** Given a refresh failure after a successful response, when the page renders, then the last successful values remain visible.
- **AC-4 (FR-5, NFR-4):** Given a public aggregate below the three-key threshold, when polling refreshes it, then the aggregate remains suppressed; recovered-history behavior remains unchanged.
- **AC-5 (FR-6):** Given an Analytics page, when it runs, then it opens no persistent event-stream connection.

## Edge cases

- **EC-1:** A request fails transiently. React Query preserves cached success data and retries at the next scheduled interval.
- **EC-2:** No browser tab is open. No client polling occurs; server-side caches expire normally.
- **EC-3:** A row is not public-aggregation eligible. It is not exposed merely because of faster refresh.
- **EC-4:** A recovered-history row is present. It continues to use the reserved recovered marker path and does not disclose the marker.

## API contracts

No API contract changes. Existing endpoints retain their paths, request parameters, payloads, errors, and authentication:

```ts
GET /api/leaderboard
GET /api/stats/overview
GET /api/stats/observed-activity
GET /api/stats/timeline?period=7d|30d
GET /api/stats/historical-timeline
GET /api/stats/models
GET /api/stats/providers
```

## Data models

N/A. No SQLite schema, tables, indexes, migrations, or payload fields change.

## Out of scope

- WebSocket, SSE, push subscriptions, or server fan-out: five-second polling is sufficient and avoids persistent connection lifecycle work.
- Background-tab realtime guarantees: the contract applies to an open dashboard query lifecycle.
- Changes to the recovered-history dataset or imports.
- Removal or reduction of privacy thresholds.
- User-specific logs, authentication, account, skills, billing, or deployment endpoints.
