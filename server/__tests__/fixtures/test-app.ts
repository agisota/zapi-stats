import { createTestDb } from './test-db.ts';
import { createApp } from '../../index.ts';

export function createTestApp(options?: Parameters<typeof createApp>[1]) {
  const db = createTestDb();
  const app = createApp(db, options);
  return { app, db };
}
