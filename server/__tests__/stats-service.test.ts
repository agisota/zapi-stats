import { test, expect, describe, beforeEach } from 'bun:test';
import { createTestDb } from './fixtures/test-db.ts';
import { StatsService } from '../services/stats-service.ts';
import type { Database } from 'bun:sqlite';

describe('StatsService', () => {
  let db: Database;
  let stats: StatsService;

  beforeEach(() => {
    db = createTestDb();
    stats = new StatsService(db);
  });

  describe('getLeaderboard', () => {
    test('returns all users sorted by request count', () => {
      const lb = stats.getLeaderboard();
      expect(lb.length).toBe(3); // alice, bob, charlie (no empty-name)
      expect(lb[0]!.name).toBe('alice'); // 4 requests
      expect(lb[1]!.name).toBe('bob');   // 2 requests
      expect(lb[2]!.name).toBe('charlie'); // 1 request
    });

    test('calculates correct request counts', () => {
      const lb = stats.getLeaderboard();
      const alice = lb.find(u => u.name === 'alice')!;
      expect(alice.requests).toBe(4); // 3 success + 1 failed
    });

    test('sums tokens correctly', () => {
      const lb = stats.getLeaderboard();
      const alice = lb.find(u => u.name === 'alice')!;
      // 50000 + 30000 + 20000 + 5000 = 105000
      expect(alice.tokensIn).toBe(105000);
      // 2000 + 1500 + 500 + 0 = 4000
      expect(alice.tokensOut).toBe(4000);
    });

    test('identifies top model per user', () => {
      const lb = stats.getLeaderboard();
      const alice = lb.find(u => u.name === 'alice')!;
      expect(alice.topModel).toBe('claude-opus-4-6'); // 3 uses vs 1 grok
    });

    test('identifies top provider per user', () => {
      const lb = stats.getLeaderboard();
      const bob = lb.find(u => u.name === 'bob')!;
      expect(bob.topProvider).toBe('codex');
    });

    test('calculates success rate', () => {
      const lb = stats.getLeaderboard();
      const alice = lb.find(u => u.name === 'alice')!;
      expect(alice.successRate).toBeCloseTo(0.75, 2); // 3/4
    });

    test('calculates cost', () => {
      const lb = stats.getLeaderboard();
      const alice = lb.find(u => u.name === 'alice')!;
      expect(alice.cost).toBeGreaterThan(0);
    });

    test('caches results', () => {
      const lb1 = stats.getLeaderboard();
      // Insert new data
      db.prepare(`
        INSERT INTO usage_history (provider, model, api_key_id, api_key_name, tokens_input, tokens_output, status, success, latency_ms, ttft_ms, timestamp)
        VALUES ('claude', 'claude-opus-4-6', 'key-1', 'alice', 99999, 99999, 'ok', 1, 100, 10, '2026-04-09T00:00:00Z')
      `).run();
      const lb2 = stats.getLeaderboard();
      // Should return cached (same reference)
      expect(lb2).toBe(lb1);
    });
  });

  describe('getOverview', () => {
    test('returns aggregate stats', () => {
      const ov = stats.getOverview();
      expect(ov.totalRequests).toBe(7); // all seed entries
      expect(ov.activeKeys).toBe(3); // alice, bob, charlie
      expect(ov.uniqueModels).toBe(4); // opus, grok, gpt-5.4, llama
      expect(ov.uniqueProviders).toBe(4); // claude, xai, codex, groq
    });

    test('calculates total tokens', () => {
      const ov = stats.getOverview();
      // total in: 50K + 30K + 20K + 100K + 80K + 10K + 5K = 295K
      expect(ov.totalTokensIn).toBe(295000);
      // total out: 2K + 1.5K + 0.5K + 5K + 3K + 0.8K + 0 = 12.8K
      expect(ov.totalTokensOut).toBe(12800);
    });

    test('calculates total cost', () => {
      const ov = stats.getOverview();
      expect(ov.totalCost).toBeGreaterThan(0);
    });
  });

  describe('getModelStats', () => {
    test('returns model breakdown', () => {
      const models = stats.getModelStats();
      expect(models.length).toBe(4);
      expect(models[0]!.model).toBe('claude-opus-4-6'); // 3 uses
    });

    test('calculates per-model cost', () => {
      const models = stats.getModelStats();
      const opus = models.find(m => m.model === 'claude-opus-4-6')!;
      expect(opus.cost).toBeGreaterThan(0);
      expect(opus.avgLatency).toBeGreaterThan(0);
    });
  });

  describe('getProviderStats', () => {
    test('returns provider breakdown', () => {
      const providers = stats.getProviderStats();
      expect(providers.length).toBe(4);
      expect(providers[0]!.provider).toBe('claude'); // 3 uses
    });

    test('calculates success rate per provider', () => {
      const providers = stats.getProviderStats();
      const claude = providers.find(p => p.provider === 'claude')!;
      // 2 success + 1 fail = 2/3
      expect(claude.successRate).toBeCloseTo(0.667, 2);
    });
  });

  describe('getUserPublicStats', () => {
    test('returns stats for existing user', () => {
      const user = stats.getUserPublicStats('alice');
      expect(user).not.toBeNull();
      expect(user!.name).toBe('alice');
      expect(user!.requests).toBe(4);
      expect(user!.models.length).toBe(2); // opus + grok
      expect(user!.providers.length).toBe(2); // claude + xai
    });

    test('returns null for unknown user', () => {
      const user = stats.getUserPublicStats('nonexistent');
      expect(user).toBeNull();
    });

    test('includes first and last seen', () => {
      const user = stats.getUserPublicStats('alice')!;
      expect(user.firstSeen).toBe('2026-04-08T10:00:00Z');
      expect(user.lastSeen).toBe('2026-04-08T13:00:00Z');
    });
  });
});
