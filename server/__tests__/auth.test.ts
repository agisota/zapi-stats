import { test, expect, describe, beforeEach } from 'bun:test';
import { createTestDb, TEST_KEYS } from './fixtures/test-db.ts';
import { AuthService } from '../services/auth-service.ts';
import type { Database } from 'bun:sqlite';

describe('AuthService', () => {
  let db: Database;
  let auth: AuthService;

  beforeEach(() => {
    db = createTestDb();
    auth = new AuthService(db);
  });

  test('validates a known active key', () => {
    const result = auth.validateKey('agisota-aaa111-pzdrk-bbb222');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('key-1');
    expect(result!.name).toBe('alice');
    expect(result!.isActive).toBe(true);
    expect(result!.noLog).toBe(false);
  });

  test('returns noLog=true for no_log key', () => {
    const result = auth.validateKey('agisota-eee555-pzdrk-fff666');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('charlie');
    expect(result!.noLog).toBe(true);
  });

  test('rejects unknown key', () => {
    const result = auth.validateKey('agisota-unknown-pzdrk-invalid');
    expect(result).toBeNull();
  });

  test('rejects inactive key', () => {
    const result = auth.validateKey('agisota-ggg777-pzdrk-hhh888');
    expect(result).toBeNull();
  });

  test('rejects empty string', () => {
    const result = auth.validateKey('');
    expect(result).toBeNull();
  });
});
