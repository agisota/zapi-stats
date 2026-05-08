import { Database } from 'bun:sqlite';

const SCHEMA = `
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key TEXT NOT NULL UNIQUE,
  machine_id TEXT,
  allowed_models TEXT DEFAULT '[]',
  no_log INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  allowed_connections TEXT,
  auto_resolve INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  access_schedule TEXT,
  max_requests_per_day INTEGER,
  max_requests_per_minute INTEGER
);
CREATE INDEX idx_ak_key ON api_keys(key);

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
CREATE INDEX idx_uh_timestamp ON usage_history(timestamp);
CREATE INDEX idx_uh_provider ON usage_history(provider);
CREATE INDEX idx_uh_model ON usage_history(model);

CREATE TABLE call_logs (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  method TEXT,
  path TEXT,
  status INTEGER,
  model TEXT,
  provider TEXT,
  account TEXT,
  connection_id TEXT,
  duration INTEGER DEFAULT 0,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  source_format TEXT,
  target_format TEXT,
  api_key_id TEXT,
  api_key_name TEXT,
  combo_name TEXT,
  request_body TEXT,
  response_body TEXT,
  error TEXT,
  request_type TEXT DEFAULT NULL
);
CREATE INDEX idx_cl_timestamp ON call_logs(timestamp);

CREATE TABLE mcp_tool_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_name TEXT NOT NULL,
  input_hash TEXT,
  output_summary TEXT,
  duration_ms INTEGER,
  api_key_id TEXT,
  success INTEGER DEFAULT 1,
  error_code TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_mta_tool ON mcp_tool_audit(tool_name);
CREATE INDEX idx_mta_apikey ON mcp_tool_audit(api_key_id);
`;

const SEED_KEYS = [
  { id: 'key-1', name: 'alice', key: 'agisota-aaa111-pzdrk-bbb222', noLog: 0 },
  { id: 'key-2', name: 'bob', key: 'agisota-ccc333-pzdrk-ddd444', noLog: 0 },
  { id: 'key-3', name: 'charlie', key: 'agisota-eee555-pzdrk-fff666', noLog: 1 },
  { id: 'key-inactive', name: 'inactive', key: 'agisota-ggg777-pzdrk-hhh888', noLog: 0, isActive: 0 },
] as const;

const SEED_USAGE = [
  // alice — heavy claude user
  { provider: 'claude', model: 'claude-opus-4-6', keyId: 'key-1', keyName: 'alice', tokensIn: 50000, tokensOut: 2000, latency: 1500, ttft: 200, success: 1, errorCode: null, timestamp: '2026-04-08T10:00:00Z' },
  { provider: 'claude', model: 'claude-opus-4-6', keyId: 'key-1', keyName: 'alice', tokensIn: 30000, tokensOut: 1500, latency: 1200, ttft: 180, success: 1, errorCode: null, timestamp: '2026-04-08T11:00:00Z' },
  { provider: 'xai', model: 'grok-4-1-fast-reasoning', keyId: 'key-1', keyName: 'alice', tokensIn: 20000, tokensOut: 500, latency: 800, ttft: 100, success: 1, errorCode: null, timestamp: '2026-04-08T12:00:00Z' },
  // bob — codex user
  { provider: 'codex', model: 'gpt-5.4', keyId: 'key-2', keyName: 'bob', tokensIn: 100000, tokensOut: 5000, latency: 2000, ttft: 300, success: 1, errorCode: null, timestamp: '2026-04-07T14:00:00Z' },
  { provider: 'codex', model: 'gpt-5.4', keyId: 'key-2', keyName: 'bob', tokensIn: 80000, tokensOut: 3000, latency: 1800, ttft: 250, success: 1, errorCode: null, timestamp: '2026-04-07T15:00:00Z' },
  // charlie — no_log user
  { provider: 'groq', model: 'llama-3.3-70b-versatile', keyId: 'key-3', keyName: 'charlie', tokensIn: 10000, tokensOut: 800, latency: 300, ttft: 50, success: 1, errorCode: null, timestamp: '2026-04-08T09:00:00Z' },
  // failed request from alice
  { provider: 'claude', model: 'claude-opus-4-6', keyId: 'key-1', keyName: 'alice', tokensIn: 5000, tokensOut: 0, latency: 500, ttft: 0, success: 0, errorCode: '429', timestamp: '2026-04-08T13:00:00Z' },
] as const;

export function createTestDb(path = ':memory:'): Database {
  const db = new Database(path);
  db.exec(SCHEMA);

  const insertKey = db.prepare(
    'INSERT INTO api_keys (id, name, key, no_log, is_active, created_at) VALUES ($id, $name, $key, $noLog, $isActive, $createdAt)'
  );
  for (const k of SEED_KEYS) {
    insertKey.run({
      $id: k.id,
      $name: k.name,
      $key: k.key,
      $noLog: k.noLog,
      $isActive: 'isActive' in k ? k.isActive : 1,
      $createdAt: '2026-03-01T00:00:00Z',
    });
  }

  const insertUsage = db.prepare(`
    INSERT INTO usage_history (provider, model, api_key_id, api_key_name, tokens_input, tokens_output, tokens_cache_read, tokens_cache_creation, tokens_reasoning, status, success, latency_ms, ttft_ms, error_code, timestamp)
    VALUES ($provider, $model, $keyId, $keyName, $tokensIn, $tokensOut, 0, 0, 0, $status, $success, $latency, $ttft, $errorCode, $timestamp)
  `);
  for (const u of SEED_USAGE) {
    insertUsage.run({
      $provider: u.provider,
      $model: u.model,
      $keyId: u.keyId,
      $keyName: u.keyName,
      $tokensIn: u.tokensIn,
      $tokensOut: u.tokensOut,
      $status: u.success === 0 ? 'error' : 'ok',
      $success: u.success,
      $latency: u.latency,
      $ttft: u.ttft,
      $errorCode: u.errorCode,
      $timestamp: u.timestamp,
    });
  }

  return db;
}

export { SEED_KEYS as TEST_KEYS, SEED_USAGE as TEST_USAGE };
