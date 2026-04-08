import type { Database } from 'bun:sqlite';
import { calculateCost, getModelRate } from './pricing.ts';
import { getDisplayName } from './display-names.ts';

export interface LeaderboardEntry {
  name: string;
  displayName: string;
  requests: number;
  tokensIn: number;
  tokensOut: number;
  tokensCacheRead: number;
  tokensCacheCreation: number;
  tokensReasoning: number;
  totalTokens: number;
  tokensPerRequest: number;
  cost: number;
  costPerRequest: number;
  inputCost: number;
  outputCost: number;
  avgLatency: number;
  avgTtft: number;
  successRate: number;
  errorCount: number;
  errorRate: number;
  uniqueModels: number;
  uniqueProviders: number;
  topModel: string;
  topProvider: string;
  firstSeen: string;
  lastSeen: string;
}

export interface OverviewStats {
  totalRequests: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCost: number;
  activeKeys: number;
  uniqueModels: number;
  uniqueProviders: number;
}

export interface ModelStats {
  model: string;
  count: number;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  avgLatency: number;
}

export interface ProviderStats {
  provider: string;
  count: number;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  successRate: number;
}

export interface TimelinePoint {
  timestamp: string;
  requests: number;
  tokensIn: number;
  tokensOut: number;
  cost: number;
}

export interface UserPublicStats {
  name: string;
  displayName: string;
  requests: number;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  successRate: number;
  avgLatency: number;
  models: ModelStats[];
  providers: ProviderStats[];
  firstSeen: string;
  lastSeen: string;
}

interface CacheEntry<T> {
  data: T;
  expiry: number;
}

export class StatsService {
  private db: Database;
  private cache = new Map<string, CacheEntry<unknown>>();

  constructor(db: Database) {
    this.db = db;
  }

  private getCached<T>(key: string, ttlMs: number, fn: () => T): T {
    const now = Date.now();
    const cached = this.cache.get(key) as CacheEntry<T> | undefined;
    if (cached && cached.expiry > now) {
      return cached.data;
    }
    const data = fn();
    this.cache.set(key, { data, expiry: now + ttlMs });
    return data;
  }

  clearCache(): void {
    this.cache.clear();
  }

  getLeaderboard(): LeaderboardEntry[] {
    return this.getCached('leaderboard', 60_000, () => {
      const rows = this.db.prepare(`
        SELECT
          api_key_name as name,
          COUNT(*) as requests,
          SUM(tokens_input) as tokensIn,
          SUM(tokens_output) as tokensOut,
          SUM(tokens_cache_read) as tokensCacheRead,
          SUM(tokens_cache_creation) as tokensCacheCreation,
          SUM(tokens_reasoning) as tokensReasoning,
          AVG(latency_ms) as avgLatency,
          AVG(ttft_ms) as avgTtft,
          SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes,
          SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as errorCount,
          COUNT(DISTINCT model) as uniqueModels,
          COUNT(DISTINCT provider) as uniqueProviders,
          MIN(timestamp) as firstSeen,
          MAX(timestamp) as lastSeen
        FROM usage_history
        WHERE api_key_name IS NOT NULL AND api_key_name != ''
        GROUP BY api_key_name
        ORDER BY requests DESC
      `).all() as Array<{
        name: string;
        requests: number;
        tokensIn: number;
        tokensOut: number;
        tokensCacheRead: number;
        tokensCacheCreation: number;
        tokensReasoning: number;
        avgLatency: number;
        avgTtft: number;
        successes: number;
        errorCount: number;
        uniqueModels: number;
        uniqueProviders: number;
        firstSeen: string;
        lastSeen: string;
      }>;

      return rows.map(row => {
        const topModel = this.db.prepare(
          'SELECT model, COUNT(*) as cnt FROM usage_history WHERE api_key_name = ? GROUP BY model ORDER BY cnt DESC LIMIT 1'
        ).get(row.name) as { model: string; cnt: number } | null;

        const topProvider = this.db.prepare(
          'SELECT provider, COUNT(*) as cnt FROM usage_history WHERE api_key_name = ? GROUP BY provider ORDER BY cnt DESC LIMIT 1'
        ).get(row.name) as { provider: string; cnt: number } | null;

        const { cost, inputCost, outputCost } = this.calculateUserCostDetailed(row.name);
        const totalTokens = row.tokensIn + row.tokensOut;

        return {
          name: row.name,
          displayName: getDisplayName(row.name),
          requests: row.requests,
          tokensIn: row.tokensIn,
          tokensOut: row.tokensOut,
          tokensCacheRead: row.tokensCacheRead ?? 0,
          tokensCacheCreation: row.tokensCacheCreation ?? 0,
          tokensReasoning: row.tokensReasoning ?? 0,
          totalTokens,
          tokensPerRequest: row.requests > 0 ? Math.round(totalTokens / row.requests) : 0,
          cost,
          costPerRequest: row.requests > 0 ? cost / row.requests : 0,
          inputCost,
          outputCost,
          avgLatency: Math.round(row.avgLatency ?? 0),
          avgTtft: Math.round(row.avgTtft ?? 0),
          successRate: row.requests > 0 ? row.successes / row.requests : 0,
          errorCount: row.errorCount,
          errorRate: row.requests > 0 ? row.errorCount / row.requests : 0,
          uniqueModels: row.uniqueModels,
          uniqueProviders: row.uniqueProviders,
          topModel: topModel?.model ?? 'unknown',
          topProvider: topProvider?.provider ?? 'unknown',
          firstSeen: row.firstSeen,
          lastSeen: row.lastSeen,
        };
      });
    });
  }

  getOverview(): OverviewStats {
    return this.getCached('overview', 60_000, () => {
      const row = this.db.prepare(`
        SELECT
          COUNT(*) as totalRequests,
          SUM(tokens_input) as totalTokensIn,
          SUM(tokens_output) as totalTokensOut,
          COUNT(DISTINCT api_key_name) as activeKeys,
          COUNT(DISTINCT model) as uniqueModels,
          COUNT(DISTINCT provider) as uniqueProviders
        FROM usage_history
      `).get() as {
        totalRequests: number;
        totalTokensIn: number;
        totalTokensOut: number;
        activeKeys: number;
        uniqueModels: number;
        uniqueProviders: number;
      };

      const totalCost = this.calculateTotalCost();
      return { ...row, totalCost };
    });
  }

  getModelStats(): ModelStats[] {
    return this.getCached('models', 120_000, () => {
      const rows = this.db.prepare(`
        SELECT model, COUNT(*) as count, SUM(tokens_input) as tokensIn, SUM(tokens_output) as tokensOut, AVG(latency_ms) as avgLatency
        FROM usage_history GROUP BY model ORDER BY count DESC
      `).all() as Array<{ model: string; count: number; tokensIn: number; tokensOut: number; avgLatency: number }>;

      return rows.map(r => ({
        ...r,
        avgLatency: Math.round(r.avgLatency),
        cost: this.calculateModelCost(r.model),
      }));
    });
  }

  getProviderStats(): ProviderStats[] {
    return this.getCached('providers', 120_000, () => {
      const rows = this.db.prepare(`
        SELECT provider, COUNT(*) as count, SUM(tokens_input) as tokensIn, SUM(tokens_output) as tokensOut,
          SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes
        FROM usage_history GROUP BY provider ORDER BY count DESC
      `).all() as Array<{ provider: string; count: number; tokensIn: number; tokensOut: number; successes: number }>;

      return rows.map(r => ({
        provider: r.provider,
        count: r.count,
        tokensIn: r.tokensIn,
        tokensOut: r.tokensOut,
        cost: this.calculateProviderCost(r.provider),
        successRate: r.count > 0 ? r.successes / r.count : 0,
      }));
    });
  }

  getTimeline(period: string = '24h'): TimelinePoint[] {
    const hours = period === '7d' ? 168 : period === '30d' ? 720 : 24;
    const since = new Date(Date.now() - hours * 3600_000).toISOString();

    const rows = this.db.prepare(`
      SELECT strftime('%Y-%m-%dT%H:00:00Z', timestamp) as bucket, COUNT(*) as requests,
        SUM(tokens_input) as tokensIn, SUM(tokens_output) as tokensOut
      FROM usage_history WHERE timestamp >= ? GROUP BY bucket ORDER BY bucket ASC
    `).all(since) as Array<{ bucket: string; requests: number; tokensIn: number; tokensOut: number }>;

    return rows.map(r => ({
      timestamp: r.bucket,
      requests: r.requests,
      tokensIn: r.tokensIn,
      tokensOut: r.tokensOut,
      cost: 0,
    }));
  }

  getUserPublicStats(name: string): UserPublicStats | null {
    const row = this.db.prepare(`
      SELECT api_key_name as name, COUNT(*) as requests, SUM(tokens_input) as tokensIn, SUM(tokens_output) as tokensOut,
        AVG(latency_ms) as avgLatency, SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes,
        MIN(timestamp) as firstSeen, MAX(timestamp) as lastSeen
      FROM usage_history WHERE api_key_name = ?
    `).get(name) as { name: string | null; requests: number; tokensIn: number; tokensOut: number; avgLatency: number; successes: number; firstSeen: string; lastSeen: string } | null;

    if (!row || !row.name || row.requests === 0) return null;

    const models = this.db.prepare(
      'SELECT model, COUNT(*) as count, SUM(tokens_input) as tokensIn, SUM(tokens_output) as tokensOut, AVG(latency_ms) as avgLatency FROM usage_history WHERE api_key_name = ? GROUP BY model ORDER BY count DESC'
    ).all(name) as Array<{ model: string; count: number; tokensIn: number; tokensOut: number; avgLatency: number }>;

    const providers = this.db.prepare(
      'SELECT provider, COUNT(*) as count, SUM(tokens_input) as tokensIn, SUM(tokens_output) as tokensOut, SUM(CASE WHEN success=1 THEN 1 ELSE 0 END) as successes FROM usage_history WHERE api_key_name = ? GROUP BY provider ORDER BY count DESC'
    ).all(name) as Array<{ provider: string; count: number; tokensIn: number; tokensOut: number; successes: number }>;

    return {
      name: row.name,
      displayName: getDisplayName(row.name),
      requests: row.requests,
      tokensIn: row.tokensIn,
      tokensOut: row.tokensOut,
      cost: this.calculateUserCost(row.name),
      successRate: row.requests > 0 ? row.successes / row.requests : 0,
      avgLatency: Math.round(row.avgLatency),
      models: models.map(m => ({ ...m, avgLatency: Math.round(m.avgLatency), cost: 0 })),
      providers: providers.map(p => ({ ...p, cost: 0, successRate: p.count > 0 ? p.successes / p.count : 0 })),
      firstSeen: row.firstSeen,
      lastSeen: row.lastSeen,
    };
  }

  private calculateUserCostDetailed(name: string): { cost: number; inputCost: number; outputCost: number } {
    const rows = this.db.prepare(
      'SELECT model, SUM(tokens_input) as tin, SUM(tokens_output) as tout FROM usage_history WHERE api_key_name = ? GROUP BY model'
    ).all(name) as Array<{ model: string; tin: number; tout: number }>;

    let inputCost = 0;
    let outputCost = 0;
    for (const r of rows) {
      const rate = getModelRate(r.model);
      inputCost += (r.tin * rate.input) / 1_000_000;
      outputCost += (r.tout * rate.output) / 1_000_000;
    }
    return { cost: inputCost + outputCost, inputCost, outputCost };
  }

  private calculateUserCost(name: string): number {
    return this.calculateUserCostDetailed(name).cost;
  }

  private calculateTotalCost(): number {
    const rows = this.db.prepare(
      'SELECT model, SUM(tokens_input) as tin, SUM(tokens_output) as tout FROM usage_history GROUP BY model'
    ).all() as Array<{ model: string; tin: number; tout: number }>;
    return rows.reduce((sum, r) => sum + calculateCost(r.model, r.tin, r.tout), 0);
  }

  private calculateModelCost(model: string): number {
    const row = this.db.prepare(
      'SELECT SUM(tokens_input) as tin, SUM(tokens_output) as tout FROM usage_history WHERE model = ?'
    ).get(model) as { tin: number; tout: number } | null;
    if (!row) return 0;
    return calculateCost(model, row.tin, row.tout);
  }

  private calculateProviderCost(provider: string): number {
    const rows = this.db.prepare(
      'SELECT model, SUM(tokens_input) as tin, SUM(tokens_output) as tout FROM usage_history WHERE provider = ? GROUP BY model'
    ).all(provider) as Array<{ model: string; tin: number; tout: number }>;
    return rows.reduce((sum, r) => sum + calculateCost(r.model, r.tin, r.tout), 0);
  }
}
