import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Database } from 'bun:sqlite';

const ALLOWED_LANES: Record<string, true> = { codex: true, claude: true, omp: true, opencode: true, openrouter: true, 'claude-drive': true };
const NOTE = 'Observed activity is not equivalent to OmniRoute API requests.';

export interface ImportOptions {
  sourcePath: string;
  targetPath: string;
  batchId: string;
  sourceKind: string;
  sourceDigest: string;
  sourceGeneratedAt: string;
  notes: string;
  dryRun?: boolean;
}

export interface ImportReport {
  batchId: string;
  sourceDigest: string;
  sourceRows: number;
  importedRows: number;
  duplicateRows: number;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  laneCounts: Record<string, number>;
  totalTokens: number;
  recordedCost: number;
  dryRun: boolean;
}

interface SourceEvent {
  source_lane: string;
  source_event_id: string;
  source_dedupe_key: string;
  observed_at: string;
  model: string | null;
  provider: string | null;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  cache_write_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  cost_usd: number;
  status: string;
  extraction_basis: string;
}

export function createRecoverySchema(db: Database): void {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS recovery_import_batches (
      batch_id TEXT PRIMARY KEY,
      source_kind TEXT NOT NULL,
      source_digest TEXT NOT NULL,
      source_generated_at TEXT NOT NULL,
      first_observed_at TEXT NOT NULL,
      last_observed_at TEXT NOT NULL,
      row_count INTEGER NOT NULL,
      imported_at TEXT NOT NULL,
      notes TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS recovery_telemetry_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id TEXT NOT NULL REFERENCES recovery_import_batches(batch_id),
      source_lane TEXT NOT NULL,
      source_event_id TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      model TEXT,
      provider TEXT,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cached_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      reasoning_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      recorded_cost_usd REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      extraction_basis TEXT NOT NULL,
      dedupe_key TEXT NOT NULL UNIQUE
    );
    CREATE INDEX IF NOT EXISTS idx_recovery_events_observed_at
      ON recovery_telemetry_events(observed_at);
    CREATE INDEX IF NOT EXISTS idx_recovery_events_lane_observed_at
      ON recovery_telemetry_events(source_lane, observed_at);
    CREATE INDEX IF NOT EXISTS idx_recovery_events_model
      ON recovery_telemetry_events(model);
  `);
}

export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function assertText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}
function assertTimestamp(value: unknown, field: string): string {
  const text = assertText(value, field);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(text) || Number.isNaN(Date.parse(text))) {
    throw new Error(`${field} must be an ISO timestamp`);
  }
  return text;
}


function assertNonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return value as number;
}

function assertCost(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error('cost_usd must be a finite non-negative number');
  }
  return value;
}

function validateEvent(raw: Record<string, unknown>): SourceEvent {
  const source_lane = assertText(raw.source_lane, 'source_lane');
  if (!ALLOWED_LANES[source_lane]) throw new Error(`unsupported source lane: ${source_lane}`);
  const source_event_id = assertText(raw.source_event_id, 'source_event_id');
  const source_dedupe_key = assertText(raw.dedupe_key, 'dedupe_key');
  const observed_at = assertTimestamp(raw.observed_at, 'observed_at');
  return {
    source_lane,
    source_event_id,
    source_dedupe_key,
    observed_at,
    model: raw.model == null ? null : assertText(raw.model, 'model'),
    provider: raw.provider == null ? null : assertText(raw.provider, 'provider'),
    input_tokens: assertNonNegativeInteger(raw.input_tokens, 'input_tokens'),
    output_tokens: assertNonNegativeInteger(raw.output_tokens, 'output_tokens'),
    cached_tokens: assertNonNegativeInteger(raw.cached_tokens, 'cached_tokens'),
    cache_write_tokens: assertNonNegativeInteger(raw.cache_write_tokens, 'cache_write_tokens'),
    reasoning_tokens: assertNonNegativeInteger(raw.reasoning_tokens, 'reasoning_tokens'),
    total_tokens: assertNonNegativeInteger(raw.total_tokens, 'total_tokens'),
    cost_usd: assertCost(raw.cost_usd),
    status: assertText(raw.status, 'status'),
    extraction_basis: assertText(raw.extraction_basis, 'extraction_basis'),
  };
}

function readEvents(source: Database): SourceEvent[] {
  const rows = source.query('SELECT source_lane, source_event_id, dedupe_key, observed_at, model, provider, input_tokens, output_tokens, cached_tokens, cache_write_tokens, reasoning_tokens, total_tokens, cost_usd, status, extraction_basis FROM events ORDER BY id').all() as Record<string, unknown>[];
  return rows.map(validateEvent);
}

function summarize(events: SourceEvent[], options: ImportOptions): ImportReport {
  const laneCounts: Record<string, number> = {};
  let totalTokens = 0;
  let recordedCost = 0;
  let firstObservedAt: string | null = null;
  let lastObservedAt: string | null = null;
  for (const event of events) {
    laneCounts[event.source_lane] = (laneCounts[event.source_lane] ?? 0) + 1;
    totalTokens += event.total_tokens;
    recordedCost += event.cost_usd;
    if (firstObservedAt === null || event.observed_at < firstObservedAt) firstObservedAt = event.observed_at;
    if (lastObservedAt === null || event.observed_at > lastObservedAt) lastObservedAt = event.observed_at;
  }
  return {
    batchId: options.batchId,
    sourceDigest: options.sourceDigest,
    sourceRows: events.length,
    importedRows: 0,
    duplicateRows: 0,
    firstObservedAt,
    lastObservedAt,
    laneCounts,
    totalTokens,
    recordedCost,
    dryRun: options.dryRun === true,
  };
}

export function importTelemetry(options: ImportOptions): ImportReport {
  if (options.sourcePath === options.targetPath) throw new Error('source and target must be different files');
  const actualDigest = sha256File(options.sourcePath);
  if (actualDigest !== options.sourceDigest) throw new Error(`source digest mismatch: expected ${options.sourceDigest}, got ${actualDigest}`);
  assertText(options.batchId, 'batchId');
  assertText(options.sourceKind, 'sourceKind');
  assertText(options.sourceGeneratedAt, 'sourceGeneratedAt');
  assertText(options.notes, 'notes');
  if (Number.isNaN(Date.parse(options.sourceGeneratedAt))) throw new Error('sourceGeneratedAt must be an ISO timestamp');

  const source = new Database(options.sourcePath, { readonly: true });
  try {
    const events = readEvents(source);
    const report = summarize(events, options);
    if (report.sourceRows === 0) throw new Error('source contains no telemetry events');
    if (options.dryRun) return report;

    const target = new Database(options.targetPath);
    try {
      createRecoverySchema(target);
      const existing = target.query('SELECT source_digest, row_count FROM recovery_import_batches WHERE batch_id = ?').get(options.batchId) as { source_digest: string; row_count: number } | null;
      if (existing && (existing.source_digest !== options.sourceDigest || existing.row_count !== report.sourceRows)) {
        throw new Error(`batch ${options.batchId} already exists with different source metadata`);
      }

      target.exec('BEGIN IMMEDIATE');
      try {
        target.query(`
          INSERT OR IGNORE INTO recovery_import_batches
            (batch_id, source_kind, source_digest, source_generated_at, first_observed_at, last_observed_at, row_count, imported_at, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(options.batchId, options.sourceKind, options.sourceDigest, options.sourceGeneratedAt, report.firstObservedAt, report.lastObservedAt, report.sourceRows, new Date().toISOString(), `${options.notes} ${NOTE}`);
        const insert = target.query(`
          INSERT INTO recovery_telemetry_events
            (batch_id, source_lane, source_event_id, observed_at, model, provider, input_tokens, output_tokens, cached_tokens, cache_write_tokens, reasoning_tokens, total_tokens, recorded_cost_usd, status, extraction_basis, dedupe_key)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(dedupe_key) DO NOTHING
        `);
        for (const event of events) {
          const dedupeKey = `${options.sourceDigest}:${event.source_dedupe_key}`;
          const result = insert.run(options.batchId, event.source_lane, event.source_event_id, event.observed_at, event.model, event.provider, event.input_tokens, event.output_tokens, event.cached_tokens, event.cache_write_tokens, event.reasoning_tokens, event.total_tokens, event.cost_usd, event.status, event.extraction_basis, dedupeKey) as { changes?: number };
          if (result.changes === 1) report.importedRows++;
          else report.duplicateRows++;
        }
        target.exec('COMMIT');
      } catch (error) {
        target.exec('ROLLBACK');
        throw error;
      }
      return report;
    } finally {
      target.close();
    }
  } finally {
    source.close();
  }
}

function parseArgs(argv: string[]): ImportOptions {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error('arguments must be --key value pairs');
    args.set(key.slice(2), value);
  }
  const sourcePath = args.get('source');
  const targetPath = args.get('target');
  const batchId = args.get('batch-id');
  const sourceDigest = args.get('source-digest');
  if (!sourcePath || !targetPath || !batchId || !sourceDigest) throw new Error('--source, --target, --batch-id, and --source-digest are required');
  return {
    sourcePath,
    targetPath,
    batchId,
    sourceDigest,
    sourceKind: args.get('source-kind') ?? 'client_telemetry.sqlite',
    sourceGeneratedAt: args.get('source-generated-at') ?? new Date().toISOString(),
    notes: args.get('notes') ?? 'Recovered metadata-only client telemetry import.',
    dryRun: args.get('dry-run') === 'true',
  };
}

if (import.meta.main) {
  try {
    const report = importTelemetry(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
