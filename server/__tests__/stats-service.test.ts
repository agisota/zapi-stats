import { test, expect, describe, beforeEach } from 'bun:test';
import { createTestDb } from './fixtures/test-db.ts';
import { StatsService } from '../services/stats-service.ts';
import { Anonymizer, resolveAnonSecret } from '../services/anonymizer.ts';
import { RECOVERED_HISTORY_KEY } from '../recovered-history.ts';
import type { Database } from 'bun:sqlite';

describe('StatsService', () => {
  let db: Database;
  let stats: StatsService;
  let anonymizer: Anonymizer;

  const alias = (name: string) => anonymizer.alias(name);

  beforeEach(() => {
    db = createTestDb();
    anonymizer = new Anonymizer('test-anonymization-secret');
    stats = new StatsService(db, anonymizer);
  });

  function insertPublicAggregateRows(): void {
    const insert = db.prepare(`
      INSERT INTO usage_history (provider, model, api_key_id, api_key_name, tokens_input, tokens_output, status, success, latency_ms, ttft_ms, timestamp)
      VALUES ('shared-provider', 'shared-model', ?, ?, 1000, 100, 'ok', 1, 100, 10, '2026-04-09T00:00:00Z')
    `);
    for (const [keyId, keyName] of [['key-1', 'alice'], ['key-2', 'bob'], ['key-3', 'charlie']]) {
      insert.run(keyId, keyName);
    }
  }

  describe('getLeaderboard', () => {
    test('returns all users sorted by request count', () => {
      const lb = stats.getLeaderboard();
      expect(lb.length).toBe(3);
      expect(lb[0]!.name).toBe(alias('alice'));
      expect(lb[1]!.name).toBe(alias('bob'));
      expect(lb[2]!.name).toBe(alias('charlie'));
    });

    test('includes displayName', () => {
      const lb = stats.getLeaderboard();
      expect(lb[0]!.displayName).toBe(alias('alice'));
    });

    test('calculates correct request counts', () => {
      const lb = stats.getLeaderboard();
      const alice = lb.find(u => u.name === alias('alice'))!;
      expect(alice.requests).toBe(4);
    });

    test('sums tokens correctly', () => {
      const lb = stats.getLeaderboard();
      const alice = lb.find(u => u.name === alias('alice'))!;
      expect(alice.tokensIn).toBe(105000);
      expect(alice.tokensOut).toBe(4000);
      expect(alice.totalTokens).toBe(109000);
    });

    test('calculates tokensPerRequest', () => {
      const lb = stats.getLeaderboard();
      const alice = lb.find(u => u.name === alias('alice'))!;
      expect(alice.tokensPerRequest).toBe(Math.round(109000 / 4));
    });

    test('includes cache and reasoning tokens', () => {
      const lb = stats.getLeaderboard();
      const alice = lb.find(u => u.name === alias('alice'))!;
      expect(alice.tokensCacheRead).toBe(0); // test data has 0
      expect(alice.tokensCacheCreation).toBe(0);
      expect(alice.tokensReasoning).toBe(0);
    });

    test('identifies top model per user', () => {
      const lb = stats.getLeaderboard();
      const alice = lb.find(u => u.name === alias('alice'))!;
      expect(alice.topModel).toBe('claude-opus-4-6');
    });

    test('identifies top provider per user', () => {
      const lb = stats.getLeaderboard();
      const bob = lb.find(u => u.name === alias('bob'))!;
      expect(bob.topProvider).toBe('codex');
    });

    test('calculates success rate and error count', () => {
      const lb = stats.getLeaderboard();
      const alice = lb.find(u => u.name === alias('alice'))!;
      expect(alice.successRate).toBeCloseTo(0.75, 2);
      expect(alice.errorCount).toBe(1);
      expect(alice.errorRate).toBeCloseTo(0.25, 2);
    });

    test('calculates cost and cost breakdown', () => {
      const lb = stats.getLeaderboard();
      const alice = lb.find(u => u.name === alias('alice'))!;
      expect(alice.cost).toBeGreaterThan(0);
      expect(alice.inputCost).toBeGreaterThan(0);
      expect(alice.outputCost).toBeGreaterThan(0);
      expect(alice.costPerRequest).toBeGreaterThan(0);
      expect(alice.inputCost + alice.outputCost).toBeCloseTo(alice.cost, 4);
    });

    test('includes latency metrics', () => {
      const lb = stats.getLeaderboard();
      const alice = lb.find(u => u.name === alias('alice'))!;
      expect(alice.avgLatency).toBeGreaterThan(0);
      expect(alice.avgTtft).toBeGreaterThanOrEqual(0);
    });

    test('counts unique models and providers', () => {
      const lb = stats.getLeaderboard();
      const alice = lb.find(u => u.name === alias('alice'))!;
      expect(alice.uniqueModels).toBe(2); // opus + grok
      expect(alice.uniqueProviders).toBe(2); // claude + xai
    });

    test('includes first and last seen', () => {
      const lb = stats.getLeaderboard();
      const alice = lb.find(u => u.name === alias('alice'))!;
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
    test('suppresses models below the three-key privacy threshold', () => {
      expect(stats.getModelStats()).toEqual([]);
    });

    test('returns model breakdown at the three-key privacy threshold', () => {
      insertPublicAggregateRows();
      const models = stats.getModelStats();
      expect(models).toHaveLength(1);
      expect(models[0]).toMatchObject({ model: 'shared-model', count: 3, tokensIn: 3000, tokensOut: 300 });
      expect(models[0]!.cost).toBeGreaterThan(0);
      expect(models[0]!.avgLatency).toBeGreaterThan(0);
    });
  });

  describe('getProviderStats', () => {
    test('suppresses providers below the three-key privacy threshold', () => {
      expect(stats.getProviderStats()).toEqual([]);
    });

    test('returns provider breakdown at the three-key privacy threshold', () => {
      insertPublicAggregateRows();
      const providers = stats.getProviderStats();
      expect(providers).toHaveLength(1);
      expect(providers[0]).toMatchObject({ provider: 'shared-provider', count: 3, tokensIn: 3000, tokensOut: 300 });
      expect(providers[0]!.successRate).toBe(1);
    });
  });

  describe('getUserPublicStats', () => {
    test('returns stats for existing user', () => {
      const user = stats.getUserPublicStats(alias('alice'));
      expect(user).not.toBeNull();
      expect(user!.name).toBe(alias('alice'));
      expect(user!.displayName).toBe(alias('alice'));
      expect(user!.requests).toBe(4);
      expect(user!.models.length).toBe(2);
      expect(user!.providers.length).toBe(2);
    });

    test('returns null for unknown user', () => {
      expect(stats.getUserPublicStats('nonexistent')).toBeNull();
    });
  });

  describe('recovered history', () => {
    const recoveredRows = [
      {
        provider: 'claude',
        model: 'claude-opus-4-6',
        tokensIn: 100000,
        tokensOut: 1000,
        timestamp: '2026-01-02T00:00:00Z',
      },
      {
        provider: 'recovered-provider',
        model: 'recovered-only-model',
        tokensIn: 40000,
        tokensOut: 800,
        timestamp: '2026-01-15T12:00:00Z',
      },
    ] as const;

    function insertRecoveredHistory(rows: Array<{
      provider: string;
      model: string;
      tokensIn: number;
      tokensOut: number;
      timestamp: string;
    }> = [...recoveredRows]) {
      const stmt = db.prepare(`
        INSERT INTO usage_history (provider, model, api_key_id, api_key_name, tokens_input, tokens_output, status, success, latency_ms, ttft_ms, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, 'ok', 1, 100, 10, ?)
      `);
      for (const row of rows) {
        stmt.run(row.provider, row.model, 'recovered-history', RECOVERED_HISTORY_KEY, row.tokensIn, row.tokensOut, row.timestamp);
      }
    }

    test('exposes a compact recovered-history summary without identifiers', () => {
      const empty = stats.getOverview();
      expect(empty.recoveredHistory).toEqual({ rows: 0, firstSeen: null, lastSeen: null });
      expect(Object.keys(empty.recoveredHistory)).toEqual(['rows', 'firstSeen', 'lastSeen']);

      insertRecoveredHistory();
      stats.clearCache();
      const ov = stats.getOverview();
      expect(ov.recoveredHistory).toEqual({
        rows: 2,
        firstSeen: '2026-01-02T00:00:00Z',
        lastSeen: '2026-01-15T12:00:00Z',
      });
      expect(JSON.stringify(ov.recoveredHistory)).not.toContain(RECOVERED_HISTORY_KEY);
      expect(JSON.stringify(ov.recoveredHistory)).not.toContain('/');
    });

    test('includes recovered rows in global totals and cost but not activeKeys, leaderboard, or user stats', () => {
      const baseline = stats.getOverview();
      const baselineLeaderboard = stats.getLeaderboard();
      insertRecoveredHistory();
      stats.clearCache();

      const ov = stats.getOverview();
      expect(ov.totalRequests).toBe(baseline.totalRequests + 2);
      expect(ov.totalTokensIn).toBe(baseline.totalTokensIn + 140000);
      expect(ov.totalTokensOut).toBe(baseline.totalTokensOut + 1800);
      expect(ov.totalCost).toBeGreaterThan(baseline.totalCost);
      expect(ov.uniqueModels).toBe(baseline.uniqueModels + 1);
      expect(ov.uniqueProviders).toBe(baseline.uniqueProviders + 1);
      expect(ov.activeKeys).toBe(baseline.activeKeys);
      expect(ov.activeKeys).toBe(3);

      const recoveredAlias = new Anonymizer(resolveAnonSecret()).alias(RECOVERED_HISTORY_KEY);
      const lb = stats.getLeaderboard();
      expect(lb.length).toBe(baselineLeaderboard.length);
      expect(lb.some(entry => entry.name === RECOVERED_HISTORY_KEY || entry.name === recoveredAlias)).toBe(false);

      expect(stats.resolveAlias(RECOVERED_HISTORY_KEY)).toBeNull();
      expect(stats.resolveAlias(recoveredAlias)).toBeNull();
      expect(stats.getUserPublicStats(RECOVERED_HISTORY_KEY)).toBeNull();
      expect(stats.getUserPublicStats(recoveredAlias)).toBeNull();
      expect(stats.getAuthenticatedUserStats(RECOVERED_HISTORY_KEY)).toBeNull();
    });

    test('includes recovered rows in model and provider aggregates despite the distinct-api-key HAVING filter', () => {
      insertRecoveredHistory();
      stats.clearCache();

      const recoveredModel = stats.getModelStats().find(model => model.model === 'recovered-only-model');
      expect(recoveredModel).toBeDefined();
      expect(recoveredModel!.count).toBe(1);
      expect(recoveredModel!.tokensIn).toBe(40000);
      expect(recoveredModel!.tokensOut).toBe(800);
      expect(recoveredModel!.cost).toBeGreaterThan(0);

      const recoveredProvider = stats.getProviderStats().find(provider => provider.provider === 'recovered-provider');
      expect(recoveredProvider).toBeDefined();
      expect(recoveredProvider!.count).toBe(1);
      expect(recoveredProvider!.tokensIn).toBe(40000);
      expect(recoveredProvider!.cost).toBeGreaterThan(0);
    });

    test('includes recovered rows in timeline aggregates despite the distinct-api-key HAVING filter', () => {
      const timestamp = new Date().toISOString();
      insertRecoveredHistory([{
        provider: 'recovered-provider',
        model: 'recovered-only-model',
        tokensIn: 500,
        tokensOut: 50,
        timestamp,
      }]);
      stats.clearCache();

      const timeline = stats.getTimeline('24h');
      const recoveredRequests = timeline.reduce((sum, point) => sum + point.requests, 0);
      expect(recoveredRequests).toBeGreaterThanOrEqual(1);
      expect(timeline.some(point => point.tokensIn >= 500 && point.tokensOut >= 50)).toBe(true);
    });

    test('uses source coverage rather than the public privacy threshold to bound a labelled gap', () => {
      insertRecoveredHistory();
      insertPublicAggregateRows();

      const historical = stats.getHistoricalTimeline();
      expect(historical.points).toEqual([
        { timestamp: '2026-01-02T00:00:00Z', requests: 1, tokensIn: 100000, tokensOut: 1000, cost: 0 },
        { timestamp: '2026-01-15T00:00:00Z', requests: 1, tokensIn: 40000, tokensOut: 800, cost: 0 },
        { timestamp: '2026-04-09T00:00:00Z', requests: 3, tokensIn: 3000, tokensOut: 300, cost: 0 },
      ]);
      expect(historical.gaps).toEqual([{
        start: '2026-01-16T00:00:00Z',
        end: '2026-04-06T00:00:00Z',
        label: 'Missing historical data',
      }]);
      expect(historical.points.some(point => point.timestamp >= historical.gaps[0]!.start && point.timestamp <= historical.gaps[0]!.end)).toBe(false);
      expect(historical.points.some(point => point.timestamp === '2026-04-07T00:00:00Z')).toBe(false);
      expect(JSON.stringify(historical)).not.toContain(RECOVERED_HISTORY_KEY);
    });
  });
});
