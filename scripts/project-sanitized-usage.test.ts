import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Database } from 'bun:sqlite';
import { CONTRACTED_USAGE_FIELDS, projectSanitizedUsage } from './project-sanitized-usage.ts';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeFullSource(): string {
  const dir = mkdtempSync(join(tmpdir(), 'omniroute-usage-projection-'));
  tempDirs.push(dir);
  const path = join(dir, 'full.sqlite');
  const db = new Database(path);
  db.exec(`
    CREATE TABLE api_keys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      key TEXT NOT NULL UNIQUE
    );
    CREATE TABLE call_logs (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      request_body TEXT,
      response_body TEXT,
      api_key_name TEXT
    );
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
      combo_strategy TEXT DEFAULT 'direct',
      timestamp TEXT NOT NULL,
      account_key TEXT,
      account_label TEXT
    );
  `);
  db.query('INSERT INTO api_keys VALUES (?, ?, ?)').run('key-1', 'alice', 'sk-secret-live-key');
  db.query('INSERT INTO call_logs VALUES (?, ?, ?, ?, ?)').run(
    'log-1',
    '2026-01-15T12:00:00.000Z',
    '{"prompt":"secret-user-prompt"}',
    '{"text":"secret-response"}',
    'alice',
  );
  db.query(`
    INSERT INTO usage_history (
      provider, model, connection_id, api_key_id, api_key_name,
      tokens_input, tokens_output, tokens_cache_read, tokens_cache_creation, tokens_reasoning,
      status, success, latency_ms, ttft_ms, error_code, combo_strategy, timestamp, account_key, account_label
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'claude',
    'claude-opus-4-6',
    'conn-secret',
    'key-1',
    'alice',
    10,
    20,
    0,
    0,
    0,
    'ok',
    1,
    100,
    40,
    null,
    'priority',
    '2026-01-15T12:00:00.000Z',
    'oauth-email-secret',
    'alice@example.com',
  );
  db.close();
  return path;
}

describe('sanitized usage projection', () => {
  test('excludes secrets, identity, and non-contracted tables', () => {
    const sourcePath = makeFullSource();
    const outputPath = join(tempDirs[0]!, 'projection.sqlite');
    const report = projectSanitizedUsage({ sourcePath, outputPath });

    expect(report.rowCount).toBe(1);

    const projected = new Database(outputPath, { readonly: true });
    const tables = projected.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>;
    const columns = projected.query('PRAGMA table_info(usage_projection)').all() as Array<{ name: string }>;
    const row = projected.query('SELECT * FROM usage_projection').get() as Record<string, unknown>;
    projected.close();

    expect(tables.map(table => table.name)).toEqual(['usage_projection']);
    expect(columns.map(column => column.name).sort()).toEqual(['source_row_id', ...CONTRACTED_USAGE_FIELDS].sort());
    expect(row.source_row_id).toBe(1);
    expect(row.provider).toBe('claude');
    expect(row.combo_strategy).toBe('priority');
    expect(row).not.toHaveProperty('api_key_id');
    expect(row).not.toHaveProperty('api_key_name');
    expect(row).not.toHaveProperty('connection_id');
    expect(row).not.toHaveProperty('account_key');
    expect(row).not.toHaveProperty('key');
    expect(row).not.toHaveProperty('request_body');

    const bytes = readFileSync(outputPath);
    expect(bytes.includes(Buffer.from('sk-secret-live-key'))).toBe(false);
    expect(bytes.includes(Buffer.from('secret-user-prompt'))).toBe(false);
    expect(bytes.includes(Buffer.from('secret-response'))).toBe(false);
    expect(bytes.includes(Buffer.from('oauth-email-secret'))).toBe(false);
    expect(bytes.includes(Buffer.from('alice@example.com'))).toBe(false);
  });
});
