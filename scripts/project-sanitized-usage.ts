import { existsSync } from 'node:fs';
import { Database } from 'bun:sqlite';

export const PROJECTION_TABLE = 'usage_projection';

export const CONTRACTED_USAGE_FIELDS = [
  'provider',
  'model',
  'tokens_input',
  'tokens_output',
  'tokens_cache_read',
  'tokens_cache_creation',
  'tokens_reasoning',
  'status',
  'success',
  'latency_ms',
  'ttft_ms',
  'error_code',
  'combo_strategy',
  'timestamp',
] as const;

export type ContractedUsageField = (typeof CONTRACTED_USAGE_FIELDS)[number];

export interface ProjectOptions {
  sourcePath: string;
  outputPath: string;
}

export interface ProjectReport {
  sourcePath: string;
  outputPath: string;
  rowCount: number;
}

function tableExists(db: Database, name: string): boolean {
  return Boolean(db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function columnNames(db: Database, table: string): Set<string> {
  return new Set((db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(column => column.name));
}

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

export function projectSanitizedUsage(options: ProjectOptions): ProjectReport {
  if (options.sourcePath === options.outputPath) throw new Error('source and output must be different files');
  if (existsSync(options.outputPath)) throw new Error(`output already exists: ${options.outputPath}`);

  const source = new Database(options.sourcePath, { readonly: true });
  try {
    if (!tableExists(source, 'usage_history')) throw new Error('source has no usage_history table');
    const available = columnNames(source, 'usage_history');
    if (!available.has('id') || !available.has('timestamp')) {
      throw new Error('usage_history must include id and timestamp');
    }

    const selectList = [
      'id AS source_row_id',
      ...CONTRACTED_USAGE_FIELDS.map(field => available.has(field) ? quoteIdent(field) : `NULL AS ${quoteIdent(field)}`),
    ].join(', ');
    const rows = source.query(`SELECT ${selectList} FROM usage_history ORDER BY id`).all() as Array<Record<string, unknown>>;
    if (rows.length === 0) throw new Error('source contains no usage rows');

    const output = new Database(options.outputPath);
    try {
      output.exec('PRAGMA journal_mode = DELETE');
      output.exec(`
        CREATE TABLE ${PROJECTION_TABLE} (
          source_row_id INTEGER PRIMARY KEY,
          provider TEXT,
          model TEXT,
          tokens_input INTEGER NOT NULL DEFAULT 0,
          tokens_output INTEGER NOT NULL DEFAULT 0,
          tokens_cache_read INTEGER NOT NULL DEFAULT 0,
          tokens_cache_creation INTEGER NOT NULL DEFAULT 0,
          tokens_reasoning INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL,
          success INTEGER NOT NULL DEFAULT 1,
          latency_ms INTEGER NOT NULL DEFAULT 0,
          ttft_ms INTEGER NOT NULL DEFAULT 0,
          error_code TEXT,
          combo_strategy TEXT,
          timestamp TEXT NOT NULL
        );
      `);
      const insert = output.query(`
        INSERT INTO ${PROJECTION_TABLE} (
          source_row_id, provider, model, tokens_input, tokens_output, tokens_cache_read,
          tokens_cache_creation, tokens_reasoning, status, success, latency_ms, ttft_ms,
          error_code, combo_strategy, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      output.exec('BEGIN IMMEDIATE');
      try {
        for (const row of rows) {
          insert.run(
            row.source_row_id,
            row.provider ?? null,
            row.model ?? null,
            row.tokens_input ?? 0,
            row.tokens_output ?? 0,
            row.tokens_cache_read ?? 0,
            row.tokens_cache_creation ?? 0,
            row.tokens_reasoning ?? 0,
            row.status ?? 'ok',
            row.success ?? 1,
            row.latency_ms ?? 0,
            row.ttft_ms ?? 0,
            row.error_code ?? null,
            row.combo_strategy ?? null,
            row.timestamp,
          );
        }
        output.exec('COMMIT');
      } catch (error) {
        output.exec('ROLLBACK');
        throw error;
      }
    } finally {
      output.close();
    }

    return { sourcePath: options.sourcePath, outputPath: options.outputPath, rowCount: rows.length };
  } finally {
    source.close();
  }
}

function parseArgs(argv: string[]): ProjectOptions {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error('arguments must be --key value pairs');
    args.set(key.slice(2), value);
  }
  const sourcePath = args.get('source');
  const outputPath = args.get('output');
  if (!sourcePath || !outputPath) throw new Error('--source and --output are required');
  return { sourcePath, outputPath };
}

if (import.meta.main) {
  try {
    const report = projectSanitizedUsage(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
