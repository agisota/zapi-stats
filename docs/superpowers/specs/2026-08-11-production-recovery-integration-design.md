# OmniRoute production recovery integration design

Date: 2026-08-11
Status: implemented and production-verified for the C-safe combined metric and the approved sanitized April–June API-history merge.

## Goal

Make recovered client/runtime telemetry visible in the current production statistics dashboard while preserving the authoritative OmniRoute API statistics and preventing duplicate counting.

The current production database is `/srv/omniroute/data/storage.sqlite` on `rox-omniroute-primary`. The dashboard reads it read-only. Its existing aggregate endpoints query `usage_history`.

## Non-goals

- Do not convert client/runtime observations into `usage_history` rows.
- Do not rewrite or backfill authoritative server request history; the separately approved sanitized April–June `usage_history` projection is an additive recovered-history merge, not an authoritative rewrite.
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
- `source_lane` TEXT NOT NULL (`codex`, `claude`, `claude-drive`, `omp`, `opencode`, `openrouter`)
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

## Operator access

View the recovered values at `https://stats.rox.one`, on the **Observed Activity** section of the statistics page. The same aggregate is available at `/api/stats/observed-activity`. The page keeps authoritative OmniRoute API requests and costs separate from recovered telemetry, and shows telemetry lane totals plus coverage dates. Leaderboard, model, provider, timeline, and user statistics remain API-only.

The production import contains the original 335772 metadata-only events across `omp`, `claude`, `codex`, and `opencode`, plus separately bound Drive batches for `claude-drive` and `openrouter`. It does not expose raw event rows, source paths, prompts, responses, credentials, cookies, or API-key values.


## Import and deployment flow

1. Build and test the dashboard locally against an in-memory SQLite fixture containing both existing `usage_history` and recovery tables.
2. Generate a dry-run import report from the reviewed `client_telemetry.sqlite`: row count, lane counts, min/max timestamps, digest, and duplicate count.
3. On production, create a checksummed SQLite backup before mutation.
4. Quiesce the writer that owns `/srv/omniroute/data/storage.sqlite`; the stats reader is already mounted read-only. Confirm no active writer and record service state.
5. Apply `CREATE TABLE IF NOT EXISTS`, indexes, one batch row, and all events in one transaction. Use `INSERT ... ON CONFLICT(dedupe_key) DO NOTHING` only after verifying the batch digest and row counts.
6. Restart/reload only the affected stats service if needed; do not alter OmniRoute routing, auth, budgets, or provider configuration.
7. Verify `/api/stats/observed-activity`, `/api/stats/overview`, existing leaderboard/model/provider endpoints, SQLite integrity, row counts, and idempotent re-import behavior.
8. Roll back by restoring the pre-mutation database backup and the prior stats image if any check fails.

The live write was approved at point of risk, completed on `rox-omniroute-primary`, and verified with a checksummed pre-mutation backup, SQLite integrity check, row counts, API smoke checks, and importer idempotency checks.

## Security and correctness

- Treat the local recovery DB as untrusted input; validate lane allowlist, timestamp format, non-negative integer token fields, finite non-negative cost, and exact batch digest before import.
- Reject malformed rows; do not coerce arbitrary mappings/lists into text.
- The import writer runs with least privilege and writes only the two new tables.
- Existing API totals cannot be changed by telemetry import.
- The recovered server projection is not imported into `usage_history`: current production already covers its authoritative window, and inserting it would double-count.
- GCS early `call_logs` are retained as recovery evidence but are not promoted to API usage because the dashboard's authoritative aggregates are based on `usage_history`.

## Drive recovery additions

The authenticated Drive sweep found two substantive, structured metadata sources:

- `openrouter_activity_2026-01-27.csv`: 367 generation rows from 2026-01-14 through 2026-01-26, 21,192,328 normalized tokens, and $0.486359 reported generation cost. It is imported as the separate `openrouter` lane; the export's API-key name, user, and raw request fields are excluded.
- `.claude 2` project JSONL: 2,389 files scanned, 13,992 assistant usage records from 2026-01-15 through 2026-01-16, 1,667,781,970 normalized tokens, and no inferred cost. It is imported as the separate `claude-drive` lane; raw prompts, responses, session IDs, and paths are excluded.

The Drive Claude CSV has two zero-cost rows, the JSON usage export has zero requests, and both organization usage CSVs are header-only; they remain catalogued evidence and are not imported as zero-valued events. Large session/log files without structured usage metadata remain provenance-only.

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

Verification result: production contains three import batches with 350131 recovery events; the two Drive retries added zero rows. `/api/health`, `/api/stats/observed-activity`, and `/api/stats/overview` returned successfully after deployment, SQLite integrity returned `ok`, and the recovered telemetry remains separate from `usage_history`.

## Amendment: sanitized recovered API-history merge

The approved API-history recovery source is `/Users/marklindgreen/Projects/zed_learnings/omni-logs/omni_live.sqlite`: 246,549 `usage_history` rows spanning `2026-04-15T15:58:20.526Z` through `2026-06-15T07:53:22.004Z`. The source SHA-256 is `5f706a44d09e0d482c8413b55bae7e619e032c950875686a3a0d248a6df6d2b8`.

Before import, `scripts/project-sanitized-usage.ts` writes a separate projection. The projection contains only `source_row_id`, provider/model, token counters, status/success, latency/TTFT, error code, combo strategy, and timestamp. It contains no `api_keys` table, API-key identifiers/names, connection IDs, account labels, request/response bodies, credentials, cookies, or raw logs. The durable projection currently has 246,549 rows, the same timestamp window, and SHA-256 `bafa927d6f4cbe2a07091af318feeef756a39ec75f6b36097cf0bab1ee8f8f6a`.

`scripts/import-usage-projection.ts` imports only the projection into `usage_history`, using `api_key_name = "__recovered_history__"`, `api_key_id = NULL`, and `combo_strategy = "recovered"`. It creates `usage_projection_import_batches` with a unique source digest, source metadata, row count, timestamp bounds, and notes. The importer verifies the exact projection digest before opening the target, rejects malformed rows and any timestamp overlap with existing `usage_history`, commits the batch and rows atomically, and makes an exact same-batch retry a no-op.

Production import completed on `rox-omniroute-primary` using a checksummed pre-mutation backup at `/srv/omniroute/data/db_backups/storage-pre-recovered-api-20260813T000000Z.sqlite` (SHA-256 `4a62e33e8bd328d09302d849ae06f54327d9ce0876723791ac6336ae8858d4ab`). The batch recorded 246,549 rows with the expected bounds and digest. Post-import `PRAGMA integrity_check` returned `ok`; recovered rows matched all source counts and token sums; the stats container was deployed as a production-compatible `linux/amd64` image and reported healthy; `/api/health`, `/api/stats/overview`, `/api/stats/models`, `/api/stats/providers`, `/api/leaderboard`, and synthetic-user access were smoke-checked. Exact local importer tests and the production batch uniqueness provide idempotency coverage. Temporary projection/import files were removed from production after import.

## Release closure and residual historical gaps

On 2026-08-19, commit `84af728` recorded the recovery implementation, its privacy boundary, import scripts, and focused tests. The release verification ran `git diff --check`, seven focused Bun test files (63 passing assertions), and `bun run build`.

The remaining authoritative API-history gaps are `2026-03-01` through `2026-04-14` and `2026-06-16` through `2026-07-21`. A fresh read-only GCS listing still begins at `2026-07-31`; it cannot close either gap. The earliest production backup, `db_2026-07-21T20-46-57-682Z_pre-migration.sqlite`, has zero `usage_history` and `call_logs` rows. A read-only Drive metadata scan returned only previously catalogued January/February usage exports before timing out; it produced no March–July OmniRoute request-history candidate. Azure remains an unresolved lead because no storage-account/container mapping is known.

No source from this audit was imported. The next evidence gate is a read-only inventory of the Azure container or an independently located immutable server snapshot covering one of the two gaps. Any candidate must demonstrate structured `usage_history` or equivalent server request records, timestamp bounds, token semantics, and non-overlap before a separate sanitized projection and import batch are considered.
