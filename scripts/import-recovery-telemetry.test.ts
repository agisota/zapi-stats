import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Database } from 'bun:sqlite';
import { importTelemetry, sha256File } from './import-recovery-telemetry.ts';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeSource(lane = 'codex', observedAt = '2026-02-24T07:31:16.284Z'): string {
  const dir = mkdtempSync(join(tmpdir(), 'omniroute-recovery-test-'));
  tempDirs.push(dir);
  const path = join(dir, 'source.sqlite');
  const db = new Database(path);
  db.exec(`
    CREATE TABLE events (
      id INTEGER PRIMARY KEY,
      source_lane TEXT NOT NULL,
      source_event_id TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      model TEXT,
      provider TEXT,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      cached_tokens INTEGER NOT NULL,
      cache_write_tokens INTEGER NOT NULL,
      reasoning_tokens INTEGER NOT NULL,
      total_tokens INTEGER NOT NULL,
      cost_usd REAL NOT NULL,
      status TEXT NOT NULL,
      extraction_basis TEXT NOT NULL,
      dedupe_key TEXT NOT NULL UNIQUE
    );
  `);
  db.query(`
    INSERT INTO events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(1, lane, 'event-1', observedAt, 'gpt-5.4', 'codex', 10, 20, 0, 0, 0, 30, 0, 'observed', 'test', `${lane}-dedupe-1`);
  db.query(`
    INSERT INTO events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(2, lane, 'event-1', '2026-02-24T07:32:16.284Z', 'gpt-5.4', 'codex', 11, 21, 0, 0, 0, 32, 0, 'observed', 'test', `${lane}-dedupe-2`);
  db.close();
  return path;
}

describe('recovery telemetry importer', () => {
  test('imports valid rows and makes retry idempotent', () => {
    const sourcePath = makeSource();
    const targetPath = join(tempDirs[0]!, 'target.sqlite');
    const digest = sha256File(sourcePath);
    const options = {
      sourcePath,
      targetPath,
      batchId: 'batch-1',
      sourceKind: 'test',
      sourceDigest: digest,
      sourceGeneratedAt: '2026-08-11T07:10:18.354Z',
      notes: 'test import',
    };

    const first = importTelemetry(options);
    const second = importTelemetry(options);
    const db = new Database(targetPath, { readonly: true });
    const counts = db.query('SELECT (SELECT COUNT(*) FROM recovery_import_batches) as batches, (SELECT COUNT(*) FROM recovery_telemetry_events) as events').get() as { batches: number; events: number };
    db.close();

    expect(first.importedRows).toBe(2);
    expect(first.duplicateRows).toBe(0);
    expect(second.importedRows).toBe(0);
    expect(second.duplicateRows).toBe(2);
    expect(counts).toEqual({ batches: 1, events: 2 });
  });

  test('accepts OpenRouter as a recovered telemetry lane', () => {
    const sourcePath = makeSource('openrouter');
    const targetPath = join(tempDirs[0]!, 'target.sqlite');
    const report = importTelemetry({
      sourcePath,
      targetPath,
      batchId: 'batch-openrouter',
      sourceKind: 'drive_openrouter_activity',
      sourceDigest: sha256File(sourcePath),
      sourceGeneratedAt: '2026-08-11T12:00:00.000Z',
      notes: 'Drive OpenRouter activity export',
    });

    expect(report.importedRows).toBe(2);
    expect(report.laneCounts).toEqual({ openrouter: 2 });
  });

  test('accepts Drive Claude usage as a separate recovered lane', () => {
    const sourcePath = makeSource('claude-drive');
    const targetPath = join(tempDirs[0]!, 'target.sqlite');
    const report = importTelemetry({
      sourcePath,
      targetPath,
      batchId: 'batch-claude-drive',
      sourceKind: 'drive_claude_usage',
      sourceDigest: sha256File(sourcePath),
      sourceGeneratedAt: '2026-08-11T12:00:00.000Z',
      notes: 'Drive Claude usage metadata',
    });

    expect(report.importedRows).toBe(2);
    expect(report.laneCounts).toEqual({ 'claude-drive': 2 });
  });

  test('fails closed for an unsupported lane', () => {
    const sourcePath = makeSource('unknown');
    const targetPath = join(tempDirs[0]!, 'target.sqlite');
    expect(() => importTelemetry({
      sourcePath,
      targetPath,
      batchId: 'batch-invalid',
      sourceKind: 'test',
      sourceDigest: sha256File(sourcePath),
      sourceGeneratedAt: '2026-08-11T07:10:18.354Z',
      notes: 'test import',
    })).toThrow('unsupported source lane');
  });

  test('fails closed for a malformed timestamp', () => {
    const sourcePath = makeSource('codex', 'not-a-timestamp');
    const targetPath = join(tempDirs[0]!, 'target.sqlite');
    expect(() => importTelemetry({
      sourcePath,
      targetPath,
      batchId: 'batch-timestamp',
      sourceKind: 'test',
      sourceDigest: sha256File(sourcePath),
      sourceGeneratedAt: '2026-08-11T07:10:18.354Z',
      notes: 'test import',
    })).toThrow('observed_at must be an ISO timestamp');
  });

  test('fails before opening the target for a wrong digest', () => {
    const sourcePath = makeSource();
    const targetPath = join(tempDirs[0]!, 'target.sqlite');
    expect(() => importTelemetry({
      sourcePath,
      targetPath,
      batchId: 'batch-digest',
      sourceKind: 'test',
      sourceDigest: '0'.repeat(64),
      sourceGeneratedAt: '2026-08-11T07:10:18.354Z',
      notes: 'test import',
    })).toThrow('source digest mismatch');
  });
});
