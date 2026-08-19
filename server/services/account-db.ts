import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Database } from 'bun:sqlite';

export function createAccountDb(dbPath: string): Database {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  migrateAccountDb(db);
  return db;
}

export function createAccountMemoryDb(): Database {
  const db = new Database(':memory:');
  migrateAccountDb(db);
  return db;
}

export function migrateAccountDb(db: Database): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      verified_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS magic_links (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      provider TEXT,
      provider_message_id TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      sent_at TEXT,
      used_at TEXT,
      revoked_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS wallets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      currency TEXT NOT NULL DEFAULT 'USD',
      available_cents INTEGER NOT NULL DEFAULT 0,
      reserved_cents INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS wallet_ledger (
      id TEXT PRIMARY KEY,
      wallet_id TEXT NOT NULL,
      type TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      balance_after_cents INTEGER NOT NULL,
      label TEXT NOT NULL,
      detail TEXT NOT NULL,
      external_ref TEXT UNIQUE,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (wallet_id) REFERENCES wallets(id)
    );

    CREATE TABLE IF NOT EXISTS payment_intents (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_payment_id TEXT,
      status TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL,
      checkout_url TEXT,
      idempotency_key TEXT NOT NULL UNIQUE,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS account_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      gateway_key_id TEXT NOT NULL,
      gateway_name TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL,
      display_name TEXT NOT NULL,
      status TEXT NOT NULL,
      sync_status TEXT NOT NULL,
      no_log INTEGER NOT NULL DEFAULT 0,
      limits_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      revoked_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS usage_billing_cursors (
      account_key_id TEXT PRIMARY KEY,
      last_usage_id INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (account_key_id) REFERENCES account_keys(id)
    );

    CREATE TABLE IF NOT EXISTS skill_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      account_key_id TEXT,
      skill_id TEXT NOT NULL,
      skill_slug TEXT NOT NULL,
      action TEXT NOT NULL,
      source TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (account_key_id) REFERENCES account_keys(id)
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_hash ON sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_magic_links_hash ON magic_links(token_hash);
    CREATE INDEX IF NOT EXISTS idx_magic_links_user ON magic_links(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_account_keys_user ON account_keys(user_id);
    CREATE INDEX IF NOT EXISTS idx_ledger_wallet ON wallet_ledger(wallet_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_payment_user ON payment_intents(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_skill_events_user ON skill_events(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_skill_events_skill ON skill_events(skill_id, created_at);
  `);
}
