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
      expect(lb.length).toBe(3);
      expect(lb[0]!.name).toBe('alice');
      expect(lb[1]!.name).toBe('bob');
      expect(lb[2]!.name).toBe('charlie');
    });

    test('includes displayName', () => {
      const lb = stats.getLeaderboard();
      // alice is not in DISPLAY_NAMES, so displayName === name
      expect(lb[0]!.displayName).toBe('alice');
    });

    test('calculates correct request counts', () => {
      const lb = stats.getLeaderboard();
      const alice = lb.find(u => u.name === 'alice')!;
      expect(alice.requests).toBe(4);
    });

    test('sums tokens correctly', () => {
      const lb = stats.getLeaderboard();
      const alice = lb.find(u => u.name === 'alice')!;
      expect(alice.tokensIn).toBe(105000);
      expect(alice.tokensOut).toBe(4000);
      expect(alice.totalTokens).toBe(109000);
    });

    test('calculates tokensPerRequest', () => {
      const lb = stats.getLeaderboard();
      const alice = lb.find(u => u.name === 'alice')!;
      expect(alice.tokensPerRequest).toBe(Math.round(109000 / 4));
    });

    test('includes cache and reasoning tokens', () => {
      const lb = stats.getLeaderboard();
      const alice = lb.find(u => u.name === 'alice')!;
      expect(alice.tokensCacheRead).toBe(0); // test data has 0
      expect(alice.tokensCacheCreation).toBe(0);
      expect(alice.tokensReasoning).toBe(0);
    });

    test('identifies top model per user', () => {
      const lb = stats.getLeaderboard();
      const alice = lb.find(u => u.name === 'alice')!;
      expect(alice.topModel).toBe('claude-opus-4-6');
    });

    test('identifies top provider per user', () => {
      const lb = stats.getLeaderboard();
      const bob = lb.find(u => u.name === 'bob')!;
      expect(bob.topProvider).toBe('codex');
    });

    test('calculates success rate and error count', () => {
      const lb = stats.getLeaderboard();
      const alice = lb.find(u => u.name === 'alice')!;
      expect(alice.successRate).toBeCloseTo(0.75, 2);
      expect(alice.errorCount).toBe(1);
      expect(alice.errorRate).toBeCloseTo(0.25, 2);
    });

    test('calculates cost and cost breakdown', () => {
      const lb = stats.getLeaderboard();
      const alice = lb.find(u => u.name === 'alice')!;
      expect(alice.cost).toBeGreaterThan(0);
      expect(alice.inputCost).toBeGreaterThan(0);
      expect(alice.outputCost).toBeGreaterThan(0);
      expect(alice.costPerRequest).toBeGreaterThan(0);
      expect(alice.inputCost + alice.outputCost).toBeCloseTo(alice.cost, 4);
    });

    test('includes latency metrics', () => {
      const lb = stats.getLeaderboard();
      const alice = lb.find(u => u.name === 'alice')!;
      expect(alice.avgLatency).toBeGreaterThan(0);
      expect(alice.avgTtft).toBeGreaterThanOrEqual(0);
    });

    test('counts unique models and providers', () => {
      const lb = stats.getLeaderboard();
      const alice = lb.find(u => u.name === 'alice')!;
      expect(alice.uniqueModels).toBe(2); // opus + grok
      expect(alice.uniqueProviders).toBe(2); // claude + xai
    });

    test('includes first and last seen', () => {
      const lb = stats.getLeaderboard();
      const alice = lb.find(u => u.name === 'alice')!;
      expect(alice.firstSeen).toBe('2026-04-08T10:00:00Z');
      expect(alice.lastSeen).toBe('2026-04-08T13:00:00Z');
    });

    test('caches results', () => {
      const lb1 = stats.getLeaderboard();
      db.prepare(`
        INSERT INTO usage_history (provider, model, api_key_id, api_key_name, tokens_input, tokens_output, status, success, latency_ms, ttft_ms, timestamp)
        VALUES ('claude', 'claude-opus-4-6', 'key-1', 'alice', 99999, 99999, 'ok', 1, 100, 10, '2026-04-09T00:00:00Z')
      `).run();
      const lb2 = stats.getLeaderboard();
      expect(lb2).toBe(lb1);
    });
  });

  describe('getOverview', () => {
    test('returns aggregate stats', () => {
      const ov = stats.getOverview();
      expect(ov.totalRequests).toBe(7);
      expect(ov.activeKeys).toBe(3);
      expect(ov.uniqueModels).toBe(4);
      expect(ov.uniqueProviders).toBe(4);
    });

    test('calculates total tokens', () => {
      const ov = stats.getOverview();
      expect(ov.totalTokensIn).toBe(295000);
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
      expect(models[0]!.model).toBe('claude-opus-4-6');
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
    });

    test('calculates success rate per provider', () => {
      const providers = stats.getProviderStats();
      const claude = providers.find(p => p.provider === 'claude')!;
      expect(claude.successRate).toBeCloseTo(0.667, 2);
    });
  });

  describe('getUserPublicStats', () => {
    test('returns stats for existing user', () => {
      const user = stats.getUserPublicStats('alice');
      expect(user).not.toBeNull();
      expect(user!.name).toBe('alice');
      expect(user!.displayName).toBe('alice');
      expect(user!.requests).toBe(4);
      expect(user!.models.length).toBe(2);
      expect(user!.providers.length).toBe(2);
    });

    test('returns null for unknown user', () => {
      expect(stats.getUserPublicStats('nonexistent')).toBeNull();
    });
  });
});
