import { createTestDb } from './test-db.ts';
import { createApp } from '../../index.ts';
import { resolveAnonSecret } from '../../services/anonymizer.ts';

const TEST_ANON_SECRET = resolveAnonSecret({ NODE_ENV: 'test' });

export function createTestApp(options?: Parameters<typeof createApp>[1]) {
  const db = createTestDb();
  const normalized = typeof options === 'string'
    ? { logsPath: options, anonSecret: TEST_ANON_SECRET }
    : { anonSecret: TEST_ANON_SECRET, ...options };
  const app = createApp(db, normalized);
  return { app, db };
}
