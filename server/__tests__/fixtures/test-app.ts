import { createTestDb } from './test-db.ts';
import { createApp } from '../../index.ts';

export function createTestApp() {
  const db = createTestDb();
  const app = createApp(db);
  return { app, db };
}
