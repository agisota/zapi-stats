import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Database } from 'bun:sqlite';
import { RECOVERED_COMBO_STRATEGY, RECOVERED_HISTORY_KEY } from '../server/recovered-history.ts';
import { projectSanitizedUsage } from './project-sanitized-usage.ts';
import { importUsageProjection, sha256File } from './import-usage-projection.ts';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'omniroute-usage-import-'));
  tempDirs.push(dir);
  return dir;
}

function makeFullSource(dir: string, timestamp = '2026-01-15T12:00:00.000Z'): string {
  const path = join(dir, 'full.sqlite');
  const db = new Database(path);
  db.exec(`
    CREATE TABLE api_keys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      key TEXT NOT NULL UNIQUE
    );
    CREATE TABLE usage_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT,
      model TEXT,
      api_key_id TEXT,
      api_key_name TEXT,
      tokens_input INTEGER DEFAULT 0,
      tokens_output INTEGER DEFAULT 0,
      tokens_cache_read INTEGER DEFAULT 0,
      tokens_cache_creation INTEGER DEFAULT 0,
      tokens_reasoning INTEGER DEFAULT 0,
      status TEXT,
      success INTEGER DEFAULT 1,
      latency_ms INTEGER DEFAULT 0,
      ttft_ms INTEGER DEFAULT 0,
      error_code TEXT,
      combo_strategy TEXT DEFAULT 'direct',
      timestamp TEXT NOT NULL
    );
  `);
  db.query('INSERT INTO api_keys VALUES (?, ?, ?)').run('key-1', 'alice', 'sk-secret-live-key');
  db.query(`
    INSERT INTO usage_history (
      provider, model, api_key_id, api_key_name, tokens_input, tokens_output,
      status, success, latency_ms, ttft_ms, combo_strategy, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('claude', 'claude-opus-4-6', 'key-1', 'alice', 10, 20, 'ok', 1, 100, 40, 'priority', timestamp);
  db.query(`
    INSERT INTO usage_history (
      provider, model, api_key_id, api_key_name, tokens_input, tokens_output,
      status, success, latency_ms, ttft_ms, combo_strategy, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('codex', 'gpt-5.4', 'key-1', 'alice', 5, 7, 'ok', 1, 80, 20, 'direct', '2026-01-15T12:01:00.000Z');
  db.close();
  return path;
}

function makeTarget(dir: string, existingTimestamp?: string): string {
  const path = join(dir, 'target.sqlite');
  const db = new Database(path);
  db.exec(`
    CREATE TABLE usage_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT,
      model TEXT,
      connection_id TEXT,
      api_key_id TEXT,
      api_key_name TEXT,
      tokens_input INTEGER DEFAULT 0,
      tokens_output INTEGER DEFAULT 0,
      tokens_cache_read INTEGER DEFAULT 0,
      tokens_cache_creation INTEGER DEFAULT 0,
      tokens_reasoning INTEGER DEFAULT 0,
      status TEXT,
      success INTEGER DEFAULT 1,
      latency_ms INTEGER DEFAULT 0,
      ttft_ms INTEGER DEFAULT 0,
      error_code TEXT,
      timestamp TEXT NOT NULL
    );
  `);
  if (existingTimestamp) {
    db.query(`
      INSERT INTO usage_history (provider, model, api_key_name, tokens_input, tokens_output, status, success, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('claude', 'claude-opus-4-6', 'bob', 1, 1, 'ok', 1, existingTimestamp);
  }
  db.close();
  return path;
}

function makeProjection(dir: string): { projectionPath: string; digest: string } {
  const sourcePath = makeFullSource(dir);
  const projectionPath = join(dir, 'projection.sqlite');
  projectSanitizedUsage({ sourcePath, outputPath: projectionPath });
  return { projectionPath, digest: sha256File(projectionPath) };
}

describe('usage projection importer', () => {
  test('fails before opening the target for a wrong digest', () => {
    const dir = tempDir();
    const { projectionPath } = makeProjection(dir);
    const targetPath = join(dir, 'missing-target.sqlite');

    expect(() => importUsageProjection({
      sourcePath: projectionPath,
      targetPath,
      batchId: 'batch-digest',
      sourceKind: 'test',
      sourceDigest: '0'.repeat(64),
      sourceGeneratedAt: '2026-08-13T00:00:00.000Z',
      notes: 'test import',
    })).toThrow('source digest mismatch');
    expect(existsSync(targetPath)).toBe(false);
  });

  test('rejects overlap with existing usage_history', () => {
    const dir = tempDir();
    const { projectionPath, digest } = makeProjection(dir);
    const targetPath = makeTarget(dir, '2026-01-15T12:00:30.000Z');

    expect(() => importUsageProjection({
      sourcePath: projectionPath,
      targetPath,
      batchId: 'batch-overlap',
      sourceKind: 'test',
      sourceDigest: digest,
      sourceGeneratedAt: '2026-08-13T00:00:00.000Z',
      notes: 'test import',
    })).toThrow('overlap');
  });

  test('imports valid rows with the reserved synthetic key and recovered combo strategy', () => {
    const dir = tempDir();
    const { projectionPath, digest } = makeProjection(dir);
    const targetPath = makeTarget(dir, '2026-08-01T00:00:00.000Z');

    const report = importUsageProjection({
      sourcePath: projectionPath,
      targetPath,
      batchId: 'batch-1',
      sourceKind: 'sanitized_usage_projection',
      sourceDigest: digest,
      sourceGeneratedAt: '2026-08-13T00:00:00.000Z',
      notes: 'test import',
    });

    const db = new Database(targetPath, { readonly: true });
    const imported = db.query(
      'SELECT api_key_name, combo_strategy, provider, source_row_id FROM usage_history WHERE api_key_name = ? ORDER BY id',
    ).all(RECOVERED_HISTORY_KEY) as Array<{ api_key_name: string; combo_strategy: string; provider: string; source_row_id: number }>;
    const batches = db.query('SELECT source_digest, row_count FROM usage_projection_import_batches').all() as Array<{ source_digest: string; row_count: number }>;
    const secretHits = db.query("SELECT COUNT(*) as n FROM sqlite_master WHERE sql LIKE '%sk-secret-live-key%'").get() as { n: number };
    db.close();

    expect(report.importedRows).toBe(2);
    expect(report.duplicateRows).toBe(0);
    expect(imported).toHaveLength(2);
    expect(imported.every(row => row.api_key_name === RECOVERED_HISTORY_KEY)).toBe(true);
    expect(imported.every(row => row.combo_strategy === RECOVERED_COMBO_STRATEGY)).toBe(true);
    expect(imported.map(row => row.provider)).toEqual(['claude', 'codex']);
    expect(imported.map(row => row.source_row_id)).toEqual([1, 2]);
    expect(batches).toEqual([{ source_digest: digest, row_count: 2 }]);
    expect(secretHits.n).toBe(0);
  });

  test('makes same-batch retry a no-op', () => {
    const dir = tempDir();
    const { projectionPath, digest } = makeProjection(dir);
    const targetPath = makeTarget(dir);
    const options = {
      sourcePath: projectionPath,
      targetPath,
      batchId: 'batch-retry',
      sourceKind: 'test',
      sourceDigest: digest,
      sourceGeneratedAt: '2026-08-13T00:00:00.000Z',
      notes: 'test import',
    };

    const first = importUsageProjection(options);
    const second = importUsageProjection(options);
    const db = new Database(targetPath, { readonly: true });
    const counts = db.query(
      `SELECT
         (SELECT COUNT(*) FROM usage_projection_import_batches) as batches,
         (SELECT COUNT(*) FROM usage_history WHERE api_key_name = ?) as imported
      `,
    ).get(RECOVERED_HISTORY_KEY) as { batches: number; imported: number };
    db.close();

    expect(first.importedRows).toBe(2);
    expect(first.duplicateRows).toBe(0);
    expect(second.importedRows).toBe(0);
    expect(second.duplicateRows).toBe(2);
    expect(counts).toEqual({ batches: 1, imported: 2 });
  });
});
