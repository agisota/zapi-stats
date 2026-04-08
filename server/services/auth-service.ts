import type { Database } from 'bun:sqlite';

export interface ApiKeyInfo {
  id: string;
  name: string;
  noLog: boolean;
  isActive: boolean;
}

export class AuthService {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  validateKey(apiKey: string): ApiKeyInfo | null {
    const row = this.db.prepare(
      'SELECT id, name, no_log, is_active FROM api_keys WHERE key = ?'
    ).get(apiKey) as { id: string; name: string; no_log: number; is_active: number } | null;

    if (!row) return null;
    if (!row.is_active) return null;

    return {
      id: row.id,
      name: row.name,
      noLog: row.no_log === 1,
      isActive: row.is_active === 1,
    };
  }
}
