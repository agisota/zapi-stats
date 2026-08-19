# Historical OmniRoute API timeline design

Date: 2026-08-19
Status: proposed

## Goal

Let the public Analytics page show the combined authoritative OmniRoute API history from the first recovered request through the current production history without depicting an unknown historical period as zero traffic.

Known coverage at design time:

- recovered `usage_history`: 2026-04-15T15:58:20.526Z through 2026-06-15T07:53:22.004Z;
- current production `usage_history`: 2026-07-22T08:49:41.208Z through the query time;
- confirmed historical gap: 2026-06-16 through 2026-07-21.

## Scope

Add a non-breaking public endpoint:

```text
GET /api/stats/historical-timeline
```

The endpoint returns a metadata-only daily aggregate:

```ts
interface HistoricalTimeline {
  points: Array<{
    timestamp: string;
    requests: number;
    tokensIn: number;
    tokensOut: number;
  }>;
  gaps: Array<{
    start: string;
    end: string;
    label: string;
  }>;
}
```

`points` contain only days with a public aggregate. The endpoint never emits API-key names, aliases, source paths, request bodies, raw logs, credentials, or per-user records.

A `gap` is emitted only when a recovered coverage interval ends before the authoritative current-public interval begins. It explicitly means historical data is unavailable. The backend does not synthesize zero-valued points for that interval.

The existing `/api/stats/timeline?period=…` response remains unchanged for existing 24-hour, 7-day, and 30-day consumers.

## Backend behavior

1. Aggregate `usage_history` in UTC daily buckets.
2. Preserve the existing public privacy rule for non-recovered data: a daily bucket is public only when it has at least three distinct API keys.
3. Include recovered rows through the reserved recovered-history marker, independent of the three-key threshold, matching current overview/model/provider/timeline semantics.
4. Return one combined point per eligible day, summing recovered and current rows only if they ever share a day.
5. Derive the confirmed gap from the terminal recovered day and the first non-recovered server-history day, independent of public aggregation eligibility. A privacy-suppressed day must not be labelled missing historical data.
6. Cache with the existing `StatsService` cache pattern.

## Frontend behavior

The existing request timeline gets a three-state selector:

```text
7d | 30d | All history
```

- `7d` and `30d` retain their current endpoint and hourly visualization.
- `All history` uses the new endpoint and daily points.
- The graph renders one combined requests series. Tooltip retains per-day request, input-token, and output-token values.
- For each API-provided gap, the chart renders a shaded `Missing historical data` reference area and inserts null boundary points so the requests line does not bridge the gap.
- The gap is not represented by a zero request or token value.

## Tests and verification

Focused tests must prove:

1. existing period timeline output remains compatible;
2. historical daily points combine eligible current and recovered rows;
3. public non-recovered rows below the three-key threshold are absent;
4. recovered rows remain eligible without exposing the reserved marker;
5. a known recovered-to-current discontinuity returns exactly one labelled gap;
6. no generated point within the gap has zeroed request/token metrics;
7. the frontend build succeeds; and
8. production health, historical endpoint, recovered row count, and the deployed JS asset are verified after explicit deployment approval.

## Non-goals

- Do not fill the March-to-April or June-to-July historical gaps.
- Do not merge agent telemetry into authoritative API history.
- Do not alter `usage_history`, import batches, production SQLite schema, API-key privacy rules, leaderboard, user statistics, or current totals.
- Do not deploy without explicit point-of-risk approval.
