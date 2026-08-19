import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { Database } from 'bun:sqlite';
import { RECOVERED_COMBO_STRATEGY, RECOVERED_HISTORY_KEY } from '../server/recovered-history.ts';
import { CONTRACTED_USAGE_FIELDS, PROJECTION_TABLE } from './project-sanitized-usage.ts';

export { RECOVERED_COMBO_STRATEGY, RECOVERED_HISTORY_KEY };
export const SYNTHETIC_API_KEY_NAME = RECOVERED_HISTORY_KEY;
export const BATCH_TABLE = 'usage_projection_import_batches';

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
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  dryRun: boolean;
}

interface ProjectionRow {
  source_row_id: number;
  provider: string | null;
  model: string | null;
  tokens_input: number;
  tokens_output: number;
  tokens_cache_read: number;
  tokens_cache_creation: number;
  tokens_reasoning: number;
  status: string;
  success: number;
  latency_ms: number;
  ttft_ms: number;
  error_code: string | null;
  combo_strategy: string | null;
  timestamp: string;
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

function assertStatus(value: unknown): string {
  return assertText(value, 'status');
}

function tableExists(db: Database, name: string): boolean {
  return Boolean(db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function columnNames(db: Database, table: string): Set<string> {
  return new Set((db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(column => column.name));
}

function validateRow(raw: Record<string, unknown>): ProjectionRow {
  return {
    source_row_id: assertNonNegativeInteger(raw.source_row_id, 'source_row_id'),
    provider: raw.provider == null ? null : assertText(raw.provider, 'provider'),
    model: raw.model == null ? null : assertText(raw.model, 'model'),
    tokens_input: assertNonNegativeInteger(raw.tokens_input, 'tokens_input'),
    tokens_output: assertNonNegativeInteger(raw.tokens_output, 'tokens_output'),
    tokens_cache_read: assertNonNegativeInteger(raw.tokens_cache_read, 'tokens_cache_read'),
    tokens_cache_creation: assertNonNegativeInteger(raw.tokens_cache_creation, 'tokens_cache_creation'),
    tokens_reasoning: assertNonNegativeInteger(raw.tokens_reasoning, 'tokens_reasoning'),
    status: assertStatus(raw.status),
    success: assertNonNegativeInteger(raw.success, 'success'),
    latency_ms: assertNonNegativeInteger(raw.latency_ms, 'latency_ms'),
    ttft_ms: assertNonNegativeInteger(raw.ttft_ms, 'ttft_ms'),
    error_code: raw.error_code == null ? null : assertText(raw.error_code, 'error_code'),
    combo_strategy: raw.combo_strategy == null ? null : assertText(raw.combo_strategy, 'combo_strategy'),
    timestamp: assertTimestamp(raw.timestamp, 'timestamp'),
  };
}

function readProjection(source: Database): ProjectionRow[] {
  if (!tableExists(source, PROJECTION_TABLE)) {
    throw new Error(`source is not a sanitized usage projection: missing ${PROJECTION_TABLE}`);
  }
  const available = columnNames(source, PROJECTION_TABLE);
  for (const field of ['source_row_id', ...CONTRACTED_USAGE_FIELDS]) {
    if (!available.has(field)) throw new Error(`projection is missing contracted field ${field}`);
  }
  const extra = [...available].filter(name => name !== 'source_row_id' && !(CONTRACTED_USAGE_FIELDS as readonly string[]).includes(name));
  if (extra.length > 0) throw new Error(`projection contains non-contracted fields: ${extra.join(', ')}`);
  const selectList = ['source_row_id', ...CONTRACTED_USAGE_FIELDS].join(', ');
  const rows = source.query(`SELECT ${selectList} FROM ${PROJECTION_TABLE} ORDER BY source_row_id`).all() as Array<Record<string, unknown>>;
  return rows.map(validateRow);
}

export function createUsageImportSchema(db: Database): void {
  if (!tableExists(db, 'usage_history')) throw new Error('target has no usage_history table');
  const columns = columnNames(db, 'usage_history');
  if (!columns.has('combo_strategy')) {
    db.exec("ALTER TABLE usage_history ADD COLUMN combo_strategy TEXT");
  }
  if (!columns.has('source_row_id')) {
    db.exec('ALTER TABLE usage_history ADD COLUMN source_row_id INTEGER');
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${BATCH_TABLE} (
      batch_id TEXT PRIMARY KEY,
      source_kind TEXT NOT NULL,
      source_digest TEXT NOT NULL UNIQUE,
      source_generated_at TEXT NOT NULL,
      first_timestamp TEXT NOT NULL,
      last_timestamp TEXT NOT NULL,
      row_count INTEGER NOT NULL,
      imported_at TEXT NOT NULL,
      notes TEXT NOT NULL
    );
  `);
}

function summarize(rows: ProjectionRow[], options: ImportOptions): ImportReport {
  let firstTimestamp: string | null = null;
  let lastTimestamp: string | null = null;
  for (const row of rows) {
    if (firstTimestamp === null || row.timestamp < firstTimestamp) firstTimestamp = row.timestamp;
    if (lastTimestamp === null || row.timestamp > lastTimestamp) lastTimestamp = row.timestamp;
  }
  return {
    batchId: options.batchId,
    sourceDigest: options.sourceDigest,
    sourceRows: rows.length,
    importedRows: 0,
    duplicateRows: 0,
    firstTimestamp,
    lastTimestamp,
    dryRun: options.dryRun === true,
  };
}

export function importUsageProjection(options: ImportOptions): ImportReport {
  if (options.sourcePath === options.targetPath) throw new Error('source and target must be different files');
  const actualDigest = sha256File(options.sourcePath);
  if (actualDigest !== options.sourceDigest) {
    throw new Error(`source digest mismatch: expected ${options.sourceDigest}, got ${actualDigest}`);
  }
  assertText(options.batchId, 'batchId');
  assertText(options.sourceKind, 'sourceKind');
  assertText(options.notes, 'notes');
  assertTimestamp(options.sourceGeneratedAt, 'sourceGeneratedAt');

  const source = new Database(options.sourcePath, { readonly: true });
  try {
    const rows = readProjection(source);
    const report = summarize(rows, options);
    if (report.sourceRows === 0) throw new Error('source contains no usage rows');
    if (options.dryRun) return report;
    if (!existsSync(options.targetPath)) throw new Error(`target does not exist: ${options.targetPath}`);

    const target = new Database(options.targetPath);
    try {
      createUsageImportSchema(target);
      const existing = target.query(
        `SELECT source_digest, row_count FROM ${BATCH_TABLE} WHERE batch_id = ?`,
      ).get(options.batchId) as { source_digest: string; row_count: number } | null;
      if (existing) {
        if (existing.source_digest !== options.sourceDigest || existing.row_count !== report.sourceRows) {
          throw new Error(`batch ${options.batchId} already exists with different source metadata`);
        }
        report.duplicateRows = existing.row_count;
        return report;
      }
      const digestOwner = target.query(
        `SELECT batch_id FROM ${BATCH_TABLE} WHERE source_digest = ?`,
      ).get(options.sourceDigest) as { batch_id: string } | null;
      if (digestOwner) {
        throw new Error(`source digest already imported as batch ${digestOwner.batch_id}`);
      }

      const overlap = target.query(
        'SELECT 1 FROM usage_history WHERE timestamp >= ? AND timestamp <= ? LIMIT 1',
      ).get(report.firstTimestamp, report.lastTimestamp);
      if (overlap) {
        throw new Error('projection overlaps existing usage_history');
      }

      target.exec('BEGIN IMMEDIATE');
      try {
        target.query(`
          INSERT INTO ${BATCH_TABLE}
            (batch_id, source_kind, source_digest, source_generated_at, first_timestamp, last_timestamp, row_count, imported_at, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          options.batchId,
          options.sourceKind,
          options.sourceDigest,
          options.sourceGeneratedAt,
          report.firstTimestamp,
          report.lastTimestamp,
          report.sourceRows,
          new Date().toISOString(),
          options.notes,
        );
        const insert = target.query(`
          INSERT INTO usage_history (
            provider, model, api_key_name, tokens_input, tokens_output, tokens_cache_read,
            tokens_cache_creation, tokens_reasoning, status, success, latency_ms, ttft_ms,
            error_code, combo_strategy, timestamp, source_row_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const row of rows) {
          insert.run(
            row.provider,
            row.model,
            RECOVERED_HISTORY_KEY,
            row.tokens_input,
            row.tokens_output,
            row.tokens_cache_read,
            row.tokens_cache_creation,
            row.tokens_reasoning,
            row.status,
            row.success,
            row.latency_ms,
            row.ttft_ms,
            row.error_code,
            RECOVERED_COMBO_STRATEGY,
            row.timestamp,
            row.source_row_id,
          );
          report.importedRows++;
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
  if (!sourcePath || !targetPath || !batchId || !sourceDigest) {
    throw new Error('--source, --target, --batch-id, and --source-digest are required');
  }
  return {
    sourcePath,
    targetPath,
    batchId,
    sourceDigest,
    sourceKind: args.get('source-kind') ?? 'sanitized_usage_projection',
    sourceGeneratedAt: args.get('source-generated-at') ?? new Date().toISOString(),
    notes: args.get('notes') ?? 'Sanitized recovered usage projection import.',
    dryRun: args.get('dry-run') === 'true',
  };
}

if (import.meta.main) {
  try {
    const report = importUsageProjection(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
