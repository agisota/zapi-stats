# OmniRoute production recovery integration design

Date: 2026-08-11
Status: design approved for the C-safe combined metric; implementation not started.

## Goal

Make recovered client/runtime telemetry visible in the current production statistics dashboard while preserving the authoritative OmniRoute API statistics and preventing duplicate counting.

The current production database is `/srv/omniroute/data/storage.sqlite` on `rox-omniroute-primary`. The dashboard reads it read-only. Its existing aggregate endpoints query `usage_history`.

## Non-goals

- Do not convert client/runtime observations into `usage_history` rows.
- Do not rewrite or backfill authoritative server request history.
- Do not combine telemetry cost with OmniRoute API cost.
- Do not expose source file paths, prompts, responses, request bodies, credentials, cookies, API-key values, or per-user client identifiers.
- Do not claim that a client event is an OmniRoute API request.

## Data model

Add two SQLite tables to the existing production database:

### `recovery_import_batches`

One row per immutable import batch:

- `batch_id` TEXT PRIMARY KEY
- `source_kind` TEXT NOT NULL
- `source_digest` TEXT NOT NULL
- `source_generated_at` TEXT NOT NULL
- `first_observed_at` TEXT NOT NULL
- `last_observed_at` TEXT NOT NULL
- `row_count` INTEGER NOT NULL
- `imported_at` TEXT NOT NULL
- `notes` TEXT NOT NULL

The digest binds the import to the reviewed local recovery artifact. No local absolute paths are stored.

### `recovery_telemetry_events`

Metadata-only events, with a unique provenance key:

- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `batch_id` TEXT NOT NULL REFERENCES `recovery_import_batches(batch_id)`
- `source_lane` TEXT NOT NULL (`codex`, `claude`, `omp`, `opencode`)
- `source_event_id` TEXT NOT NULL
- `observed_at` TEXT NOT NULL
- `model` TEXT
- `provider` TEXT
- `input_tokens` INTEGER NOT NULL DEFAULT 0
- `output_tokens` INTEGER NOT NULL DEFAULT 0
- `cached_tokens` INTEGER NOT NULL DEFAULT 0
- `cache_write_tokens` INTEGER NOT NULL DEFAULT 0
- `reasoning_tokens` INTEGER NOT NULL DEFAULT 0
- `total_tokens` INTEGER NOT NULL DEFAULT 0
- `recorded_cost_usd` REAL NOT NULL DEFAULT 0
- `status` TEXT NOT NULL
- `extraction_basis` TEXT NOT NULL
- `dedupe_key` TEXT NOT NULL UNIQUE

Indexes: `observed_at`, `(source_lane, observed_at)`, and `model`.

The unique `dedupe_key` makes a retry idempotent. The production `usage_history` table remains unchanged.

## API and UI

Add a public aggregate endpoint `GET /api/stats/observed-activity` with no raw event rows. Response fields:

- authoritative API: request count, input/output tokens, existing calculated API cost, first/last observed timestamps;
- recovery telemetry: event count, input/output/total tokens, recorded telemetry cost shown separately, first/last observed timestamps;
- `observedEventsTotal = apiRequests + telemetryEvents`;
- `observedTokensTotal = apiTokens + telemetryTokens`;
- lane breakdown by source lane;
- a fixed semantic note: `observed activity is not equivalent to OmniRoute API requests`.

The endpoint uses the existing service cache pattern and parameterized SQL. No client identity or source path is returned.

Add a clearly labeled “Observed activity” section to the public statistics page. It shows:

1. one combined observed-event total;
2. the authoritative OmniRoute API request total beside it;
3. telemetry event/token totals by lane;
4. API cost and recorded telemetry cost as separate values;
5. coverage and provenance note.

Existing leaderboard, model, provider, timeline, and user statistics remain API-only and unchanged.

## Import and deployment flow

1. Build and test the dashboard locally against an in-memory SQLite fixture containing both existing `usage_history` and recovery tables.
2. Generate a dry-run import report from the reviewed `client_telemetry.sqlite`: row count, lane counts, min/max timestamps, digest, and duplicate count.
3. On production, create a checksummed SQLite backup before mutation.
4. Quiesce the writer that owns `/srv/omniroute/data/storage.sqlite`; the stats reader is already mounted read-only. Confirm no active writer and record service state.
5. Apply `CREATE TABLE IF NOT EXISTS`, indexes, one batch row, and all events in one transaction. Use `INSERT ... ON CONFLICT(dedupe_key) DO NOTHING` only after verifying the batch digest and row counts.
6. Restart/reload only the affected stats service if needed; do not alter OmniRoute routing, auth, budgets, or provider configuration.
7. Verify `/api/stats/observed-activity`, `/api/stats/overview`, existing leaderboard/model/provider endpoints, SQLite integrity, row counts, and idempotent re-import behavior.
8. Roll back by restoring the pre-mutation database backup and the prior stats image if any check fails.

The live write requires a final point-of-risk confirmation with the exact production host, database path, batch digest, and expected imported row count. No production mutation is part of this design approval.

## Security and correctness

- Treat the local recovery DB as untrusted input; validate lane allowlist, timestamp format, non-negative integer token fields, finite non-negative cost, and exact batch digest before import.
- Reject malformed rows; do not coerce arbitrary mappings/lists into text.
- The import writer runs with least privilege and writes only the two new tables.
- Existing API totals cannot be changed by telemetry import.
- The recovered server projection is not imported into `usage_history`: current production already covers its authoritative window, and inserting it would double-count.
- GCS early `call_logs` are retained as recovery evidence but are not promoted to API usage because the dashboard's authoritative aggregates are based on `usage_history`.

## Verification

Focused checks must prove:

- schema creation is idempotent;
- malformed rows and wrong digest fail closed;
- duplicate import adds zero rows;
- lane/event/token aggregates equal the reviewed source summary;
- `observedEventsTotal` equals API requests plus telemetry events;
- API request/cost totals are byte-for-byte unchanged before vs after import;
- API overview remains healthy on the live dashboard;
- raw prompts, responses, bodies, secrets, cookies, source paths, and API-key values are absent from the production tables and endpoint response.
