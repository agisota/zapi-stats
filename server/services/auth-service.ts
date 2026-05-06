import type { Database } from 'bun:sqlite';
import { getDisplayName } from './display-names.ts';

export interface ApiKeyInfo {
  id: string;
  name: string;
  displayName: string;
  noLog: boolean;
  isActive: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

export class AuthService {
  private db: Database;
  private apiKeyColumns: Set<string>;

  constructor(db: Database) {
    this.db = db;
    this.apiKeyColumns = new Set(
      (this.db.prepare('PRAGMA table_info(api_keys)').all() as Array<{ name: string }>).map(c => c.name),
    );
  }

  validateKey(apiKey: string): ApiKeyInfo | null {
    const row = this.db.prepare(
      `SELECT
        id,
        name,
        no_log,
        is_active,
        ${this.col('created_at', "'1970-01-01T00:00:00.000Z'")} as created_at,
        ${this.col('last_used_at', 'NULL')} as last_used_at
      FROM api_keys
      WHERE key = ?`
    ).get(apiKey) as { id: string; name: string; no_log: number; is_active: number; created_at: string; last_used_at: string | null } | null;

    if (!row) return null;
    if (!row.is_active) return null;

    return {
      id: row.id,
      name: row.name,
      displayName: getDisplayName(row.name),
      noLog: row.no_log === 1,
      isActive: row.is_active === 1,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
    };
  }

  private col(column: string, fallback: string): string {
    return this.apiKeyColumns.has(column) ? column : fallback;
  }
}
