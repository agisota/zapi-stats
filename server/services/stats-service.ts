import type { Database } from 'bun:sqlite';
import { calculateCost } from './pricing.ts';

export interface LeaderboardEntry {
  name: string;
  requests: number;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  lastSeen: string;
  topModel: string;
  topProvider: string;
  successRate: number;
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
          MAX(timestamp) as lastSeen,
          SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes
        FROM usage_history
        WHERE api_key_name IS NOT NULL AND api_key_name != ''
        GROUP BY api_key_name
        ORDER BY requests DESC
      `).all() as Array<{
        name: string;
        requests: number;
        tokensIn: number;
        tokensOut: number;
        lastSeen: string;
        successes: number;
      }>;

      return rows.map(row => {
        const topModel = this.db.prepare(`
          SELECT model, COUNT(*) as cnt FROM usage_history
          WHERE api_key_name = ? GROUP BY model ORDER BY cnt DESC LIMIT 1
        `).get(row.name) as { model: string; cnt: number } | null;

        const topProvider = this.db.prepare(`
          SELECT provider, COUNT(*) as cnt FROM usage_history
          WHERE api_key_name = ? GROUP BY provider ORDER BY cnt DESC LIMIT 1
        `).get(row.name) as { provider: string; cnt: number } | null;

        return {
          name: row.name,
          requests: row.requests,
          tokensIn: row.tokensIn,
          tokensOut: row.tokensOut,
          cost: this.calculateUserCost(row.name),
          lastSeen: row.lastSeen,
          topModel: topModel?.model ?? 'unknown',
          topProvider: topProvider?.provider ?? 'unknown',
          successRate: row.requests > 0 ? row.successes / row.requests : 0,
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
        SELECT
          model,
          COUNT(*) as count,
          SUM(tokens_input) as tokensIn,
          SUM(tokens_output) as tokensOut,
          AVG(latency_ms) as avgLatency
        FROM usage_history
        GROUP BY model
        ORDER BY count DESC
      `).all() as Array<{
        model: string;
        count: number;
        tokensIn: number;
        tokensOut: number;
        avgLatency: number;
      }>;

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
        SELECT
          provider,
          COUNT(*) as count,
          SUM(tokens_input) as tokensIn,
          SUM(tokens_output) as tokensOut,
          SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes
        FROM usage_history
        GROUP BY provider
        ORDER BY count DESC
      `).all() as Array<{
        provider: string;
        count: number;
        tokensIn: number;
        tokensOut: number;
        successes: number;
      }>;

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
    const bucketHours = hours <= 24 ? 1 : hours <= 168 ? 6 : 24;
    const since = new Date(Date.now() - hours * 3600_000).toISOString();

    const rows = this.db.prepare(`
      SELECT
        strftime('%Y-%m-%dT%H:00:00Z', timestamp) as bucket,
        COUNT(*) as requests,
        SUM(tokens_input) as tokensIn,
        SUM(tokens_output) as tokensOut
      FROM usage_history
      WHERE timestamp >= ?
      GROUP BY bucket
      ORDER BY bucket ASC
    `).all(since) as Array<{
      bucket: string;
      requests: number;
      tokensIn: number;
      tokensOut: number;
    }>;

    return rows.map(r => ({
      timestamp: r.bucket,
      requests: r.requests,
      tokensIn: r.tokensIn,
      tokensOut: r.tokensOut,
      cost: 0, // calculated below would require per-model breakdown
    }));
  }

  getUserPublicStats(name: string): UserPublicStats | null {
    const row = this.db.prepare(`
      SELECT
        api_key_name as name,
        COUNT(*) as requests,
        SUM(tokens_input) as tokensIn,
        SUM(tokens_output) as tokensOut,
        AVG(latency_ms) as avgLatency,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes,
        MIN(timestamp) as firstSeen,
        MAX(timestamp) as lastSeen
      FROM usage_history
      WHERE api_key_name = ?
    `).get(name) as {
      name: string | null;
      requests: number;
      tokensIn: number;
      tokensOut: number;
      avgLatency: number;
      successes: number;
      firstSeen: string;
      lastSeen: string;
    } | null;

    if (!row || !row.name || row.requests === 0) return null;

    const models = this.db.prepare(`
      SELECT model, COUNT(*) as count, SUM(tokens_input) as tokensIn, SUM(tokens_output) as tokensOut, AVG(latency_ms) as avgLatency
      FROM usage_history WHERE api_key_name = ? GROUP BY model ORDER BY count DESC
    `).all(name) as Array<{ model: string; count: number; tokensIn: number; tokensOut: number; avgLatency: number }>;

    const providers = this.db.prepare(`
      SELECT provider, COUNT(*) as count, SUM(tokens_input) as tokensIn, SUM(tokens_output) as tokensOut, SUM(CASE WHEN success=1 THEN 1 ELSE 0 END) as successes
      FROM usage_history WHERE api_key_name = ? GROUP BY provider ORDER BY count DESC
    `).all(name) as Array<{ provider: string; count: number; tokensIn: number; tokensOut: number; successes: number }>;

    return {
      name: row.name,
      requests: row.requests,
      tokensIn: row.tokensIn,
      tokensOut: row.tokensOut,
      cost: this.calculateUserCost(name),
      successRate: row.requests > 0 ? row.successes / row.requests : 0,
      avgLatency: Math.round(row.avgLatency),
      models: models.map(m => ({
        ...m,
        avgLatency: Math.round(m.avgLatency),
        cost: 0,
      })),
      providers: providers.map(p => ({
        ...p,
        cost: 0,
        successRate: p.count > 0 ? p.successes / p.count : 0,
      })),
      firstSeen: row.firstSeen,
      lastSeen: row.lastSeen,
    };
  }

  private calculateUserCost(name: string): number {
    const rows = this.db.prepare(
      'SELECT model, SUM(tokens_input) as tin, SUM(tokens_output) as tout FROM usage_history WHERE api_key_name = ? GROUP BY model'
    ).all(name) as Array<{ model: string; tin: number; tout: number }>;

    return rows.reduce((sum, r) => sum + calculateCost(r.model, r.tin, r.tout), 0);
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
