import { Database } from 'bun:sqlite';

export function createDb(dbPath: string): Database {
  const db = new Database(dbPath, { readonly: true });
  return db;
}

export function createMemoryDb(): Database {
  return new Database(':memory:');
}

export type { Database };
