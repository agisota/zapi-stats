import type { Database } from 'bun:sqlite';
import { calculateCost, getModelRate } from './pricing.ts';
import { Anonymizer, resolveAnonSecret } from './anonymizer.ts';
import { RECOVERED_HISTORY_KEY } from '../recovered-history.ts';

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
  requestsPerDay: number;
  outputRatio: number;
  peakHour: number;
  providerDiversity: number;
  providerBreakdown: Array<{ provider: string; percent: number }>;
  activeDays: number;
  avgSessionMessages: number;
  longestSessionMessages: number;
  hourlyActivity: number[];
  dailyActivity: number[];
}

export interface RecoveredHistorySummary {
  rows: number;
  firstSeen: string | null;
  lastSeen: string | null;
}

export interface OverviewStats {
  totalRequests: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCost: number;
  activeKeys: number;
  uniqueModels: number;
  uniqueProviders: number;
  recoveredHistory: RecoveredHistorySummary;
}

export interface ModelStats {
  model: string;
  provider: string;
  count: number;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  avgLatency: number;
  successRate: number;
  users: number;
  lastSeen: string;
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

export interface HistoricalTimelineGap {
  start: string;
  end: string;
  label: string;
}

export interface HistoricalTimeline {
  points: TimelinePoint[];
  gaps: HistoricalTimelineGap[];
}

export interface ObservedTelemetryLane {
  lane: string;
  events: number;
  tokensIn: number;
  tokensOut: number;
  totalTokens: number;
  recordedCost: number;
  firstSeen: string | null;
  lastSeen: string | null;
}

export interface ObservedActivity {
  api: {
    requests: number;
    tokensIn: number;
    tokensOut: number;
    cost: number;
    firstSeen: string | null;
    lastSeen: string | null;
  };
  telemetry: {
    events: number;
    tokensIn: number;
    tokensOut: number;
    totalTokens: number;
    recordedCost: number;
    firstSeen: string | null;
    lastSeen: string | null;
    lanes: ObservedTelemetryLane[];
  };
  observedEventsTotal: number;
  observedTokensIn: number;
  observedTokensOut: number;
  observedTokensTotal: number;
  note: string;
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
  private anonymizer: Anonymizer;
  private cache = new Map<string, CacheEntry<unknown>>();

  constructor(db: Database, anonymizer = new Anonymizer(resolveAnonSecret())) {
    this.db = db;
    this.anonymizer = anonymizer;
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
          MAX(timestamp) as lastSeen,
          COUNT(DISTINCT DATE(timestamp)) as activeDays
        FROM usage_history
        WHERE api_key_name IS NOT NULL AND api_key_name != '' AND api_key_name != ?
        GROUP BY api_key_name
        ORDER BY requests DESC
      `).all(RECOVERED_HISTORY_KEY) as Array<{
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
        activeDays: number;
      }>;

      return rows.map(row => {
        const topModel = this.db.prepare(
          'SELECT model, COUNT(*) as cnt FROM usage_history WHERE api_key_name = ? GROUP BY model ORDER BY cnt DESC LIMIT 1'
        ).get(row.name) as { model: string; cnt: number } | null;

        const topProvider = this.db.prepare(
          'SELECT provider, COUNT(*) as cnt FROM usage_history WHERE api_key_name = ? GROUP BY provider ORDER BY cnt DESC LIMIT 1'
        ).get(row.name) as { provider: string; cnt: number } | null;

        const peakHourRow = this.db.prepare(
          `SELECT strftime('%H', timestamp) as h, COUNT(*) as c FROM usage_history WHERE api_key_name = ? GROUP BY h ORDER BY c DESC LIMIT 1`
        ).get(row.name) as { h: string; c: number } | null;

        const providerRows = this.db.prepare(
          'SELECT provider, COUNT(*) as cnt FROM usage_history WHERE api_key_name = ? GROUP BY provider'
        ).all(row.name) as Array<{ provider: string; cnt: number }>;

        const timestampRows = this.db.prepare(
          'SELECT timestamp FROM usage_history WHERE api_key_name = ? ORDER BY timestamp ASC'
        ).all(row.name) as Array<{ timestamp: string }>;

        const { cost, inputCost, outputCost } = this.calculateUserCostDetailed(row.name);
        const totalTokens = row.tokensIn + row.tokensOut;

        const providerDiversity = this.computeShannonEntropy(providerRows, row.requests);
        const provTotal = providerRows.reduce((s, p) => s + p.cnt, 0);
        const providerBreakdown = providerRows
          .map(p => ({ provider: p.provider, percent: provTotal > 0 ? (p.cnt / provTotal) * 100 : 0 }))
          .sort((a, b) => b.percent - a.percent)
          .slice(0, 4);
        const { avgSessionMessages, longestSessionMessages } = this.computeSessionStats(timestampRows);

        const alias = this.anonymizer.alias(row.name);
        return {
          name: alias,
          displayName: alias,
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
          requestsPerDay: row.activeDays > 0 ? row.requests / row.activeDays : 0,
          outputRatio: row.tokensIn > 0 ? row.tokensOut / row.tokensIn : 0,
          peakHour: peakHourRow ? parseInt(peakHourRow.h, 10) : 0,
          providerDiversity,
          providerBreakdown,
          activeDays: row.activeDays,
          avgSessionMessages,
          longestSessionMessages,
          hourlyActivity: this.getHourlyActivity(row.name),
          dailyActivity: this.getDailyActivity(row.name),
        };
      });
    });
  }

  private getDailyActivity(name: string): number[] {
    const rows = this.db.prepare(
      "SELECT DATE(timestamp) as d, COUNT(*) as c FROM usage_history WHERE api_key_name = ? GROUP BY d ORDER BY d ASC"
    ).all(name) as Array<{ d: string; c: number }>;

    if (rows.length === 0) return [];

    const first = rows[0]!.d;
    const last = rows[rows.length - 1]!.d;
    const startMs = new Date(first).getTime();
    const endMs = new Date(last).getTime();
    const totalDays = Math.round((endMs - startMs) / 86_400_000) + 1;

    const byDate = new Map(rows.map(r => [r.d, r.c]));
    return Array.from({ length: totalDays }, (_, i) => {
      const date = new Date(startMs + i * 86_400_000).toISOString().slice(0, 10);
      return byDate.get(date) ?? 0;
    });
  }

  private getHourlyActivity(name: string): number[] {
    const rows = this.db.prepare(
      "SELECT CAST(strftime('%H', timestamp) AS INTEGER) as h, COUNT(*) as c FROM usage_history WHERE api_key_name = ? GROUP BY h ORDER BY h ASC"
    ).all(name) as Array<{ h: number; c: number }>;
    return Array.from({ length: 24 }, (_, i) => {
      const found = rows.find(r => r.h === i);
      return found ? found.c : 0;
    });
  }

  getObservedActivity(): ObservedActivity {
    return this.getCached('observed-activity', 60_000, () => {
      const api = this.db.prepare(`
        SELECT COUNT(*) as requests,
          COALESCE(SUM(tokens_input), 0) as tokensIn,
          COALESCE(SUM(tokens_output), 0) as tokensOut,
          MIN(timestamp) as firstSeen,
          MAX(timestamp) as lastSeen
        FROM usage_history
      `).get() as ObservedActivity['api'];

      const hasTelemetry = Boolean(this.db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'recovery_telemetry_events'"
      ).get());

      const telemetry = hasTelemetry
        ? this.db.prepare(`
            SELECT COUNT(*) as events,
              COALESCE(SUM(input_tokens), 0) as tokensIn,
              COALESCE(SUM(output_tokens), 0) as tokensOut,
              COALESCE(SUM(total_tokens), 0) as totalTokens,
              COALESCE(SUM(recorded_cost_usd), 0) as recordedCost,
              MIN(observed_at) as firstSeen,
              MAX(observed_at) as lastSeen
            FROM recovery_telemetry_events
          `).get() as Omit<ObservedActivity['telemetry'], 'lanes'>
        : { events: 0, tokensIn: 0, tokensOut: 0, totalTokens: 0, recordedCost: 0, firstSeen: null, lastSeen: null };

      const lanes = hasTelemetry
        ? this.db.prepare(`
            SELECT source_lane as lane, COUNT(*) as events,
              COALESCE(SUM(input_tokens), 0) as tokensIn,
              COALESCE(SUM(output_tokens), 0) as tokensOut,
              COALESCE(SUM(total_tokens), 0) as totalTokens,
              COALESCE(SUM(recorded_cost_usd), 0) as recordedCost,
              MIN(observed_at) as firstSeen,
              MAX(observed_at) as lastSeen
            FROM recovery_telemetry_events
            GROUP BY source_lane
            ORDER BY source_lane ASC
          `).all() as ObservedTelemetryLane[]
        : [];

      return {
        api: { ...api, cost: this.calculateTotalCost() },
        telemetry: { ...telemetry, lanes },
        observedEventsTotal: api.requests + telemetry.events,
        observedTokensIn: api.tokensIn + telemetry.tokensIn,
        observedTokensOut: api.tokensOut + telemetry.tokensOut,
        observedTokensTotal: api.tokensIn + api.tokensOut + telemetry.totalTokens,
        note: 'Observed activity is not equivalent to OmniRoute API requests.',
      };
    });
  }

  getOverview(): OverviewStats {
    return this.getCached('overview', 60_000, () => {
      const row = this.db.prepare(`
        SELECT
          COUNT(*) as totalRequests,
          SUM(tokens_input) as totalTokensIn,
          SUM(tokens_output) as totalTokensOut,
          COUNT(DISTINCT CASE WHEN api_key_name IS NOT NULL AND api_key_name != '' AND api_key_name != ? THEN api_key_name END) as activeKeys,
          COUNT(DISTINCT model) as uniqueModels,
          COUNT(DISTINCT provider) as uniqueProviders
        FROM usage_history
      `).get(RECOVERED_HISTORY_KEY) as {
        totalRequests: number;
        totalTokensIn: number;
        totalTokensOut: number;
        activeKeys: number;
        uniqueModels: number;
        uniqueProviders: number;
      };

      const recoveredHistory = this.db.prepare(`
        SELECT COUNT(*) as rows, MIN(timestamp) as firstSeen, MAX(timestamp) as lastSeen
        FROM usage_history
        WHERE api_key_name = ?
      `).get(RECOVERED_HISTORY_KEY) as RecoveredHistorySummary;

      const totalCost = this.calculateTotalCost();
      return { ...row, totalCost, recoveredHistory };
    });
  }

  getModelStats(): ModelStats[] {
    return this.getCached('models', 120_000, () => {
      const rows = this.db.prepare(`
        SELECT
          model,
          provider,
          SUM(count) as count,
          SUM(tokensIn) as tokensIn,
          SUM(tokensOut) as tokensOut,
          SUM(avgLatency * count) / SUM(count) as avgLatency,
          SUM(successes) as successes,
          SUM(users) as users,
          MAX(lastSeen) as lastSeen
        FROM (
          SELECT
            model,
            provider,
            COUNT(*) as count,
            SUM(tokens_input) as tokensIn,
            SUM(tokens_output) as tokensOut,
            AVG(latency_ms) as avgLatency,
            SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes,
            COUNT(DISTINCT api_key_name) as users,
            MAX(timestamp) as lastSeen
          FROM usage_history
          WHERE api_key_name IS NULL OR api_key_name != ?
          GROUP BY provider, model
          HAVING COUNT(DISTINCT api_key_name) >= 3

          UNION ALL

          SELECT
            model,
            provider,
            COUNT(*) as count,
            SUM(tokens_input) as tokensIn,
            SUM(tokens_output) as tokensOut,
            AVG(latency_ms) as avgLatency,
            SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes,
            COUNT(DISTINCT api_key_name) as users,
            MAX(timestamp) as lastSeen
          FROM usage_history
          WHERE api_key_name = ?
          GROUP BY provider, model
        )
        GROUP BY provider, model
        ORDER BY count DESC
      `).all(RECOVERED_HISTORY_KEY, RECOVERED_HISTORY_KEY) as Array<{ model: string; provider: string; count: number; tokensIn: number; tokensOut: number; avgLatency: number; successes: number; users: number; lastSeen: string }>;

      return rows.map(r => ({
        model: r.model,
        provider: r.provider,
        count: r.count,
        tokensIn: r.tokensIn,
        tokensOut: r.tokensOut,
        avgLatency: Math.round(r.avgLatency ?? 0),
        successRate: r.count > 0 ? r.successes / r.count : 0,
        users: r.users,
        lastSeen: r.lastSeen,
        cost: this.calculateModelCost(r.model),
      }));
    });
  }

  getProviderStats(): ProviderStats[] {
    return this.getCached('providers', 120_000, () => {
      const rows = this.db.prepare(`
        SELECT provider,
          SUM(count) as count,
          SUM(tokensIn) as tokensIn,
          SUM(tokensOut) as tokensOut,
          SUM(successes) as successes
        FROM (
          SELECT provider, COUNT(*) as count, SUM(tokens_input) as tokensIn, SUM(tokens_output) as tokensOut,
            SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes
          FROM usage_history
          WHERE api_key_name IS NULL OR api_key_name != ?
          GROUP BY provider
          HAVING COUNT(DISTINCT api_key_name) >= 3

          UNION ALL

          SELECT provider, COUNT(*) as count, SUM(tokens_input) as tokensIn, SUM(tokens_output) as tokensOut,
            SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes
          FROM usage_history
          WHERE api_key_name = ?
          GROUP BY provider
        )
        GROUP BY provider
        ORDER BY count DESC
      `).all(RECOVERED_HISTORY_KEY, RECOVERED_HISTORY_KEY) as Array<{ provider: string; count: number; tokensIn: number; tokensOut: number; successes: number }>;

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
      SELECT bucket, SUM(requests) as requests, SUM(tokensIn) as tokensIn, SUM(tokensOut) as tokensOut
      FROM (
        SELECT strftime('%Y-%m-%dT%H:00:00Z', timestamp) as bucket, COUNT(*) as requests,
          SUM(tokens_input) as tokensIn, SUM(tokens_output) as tokensOut
        FROM usage_history
        WHERE timestamp >= ? AND (api_key_name IS NULL OR api_key_name != ?)
        GROUP BY bucket
        HAVING COUNT(DISTINCT api_key_name) >= 3

        UNION ALL

        SELECT strftime('%Y-%m-%dT%H:00:00Z', timestamp) as bucket, COUNT(*) as requests,
          SUM(tokens_input) as tokensIn, SUM(tokens_output) as tokensOut
        FROM usage_history
        WHERE timestamp >= ? AND api_key_name = ?
        GROUP BY bucket
      )
      GROUP BY bucket
      ORDER BY bucket ASC
    `).all(since, RECOVERED_HISTORY_KEY, since, RECOVERED_HISTORY_KEY) as Array<{ bucket: string; requests: number; tokensIn: number; tokensOut: number }>;

    return rows.map(r => ({
      timestamp: r.bucket,
      requests: r.requests,
      tokensIn: r.tokensIn,
      tokensOut: r.tokensOut,
      cost: 0,
    }));
  }

  getHistoricalTimeline(): HistoricalTimeline {
    return this.getCached('historical-timeline', 60_000, () => {
      const recoveredRows = this.db.prepare(`
        SELECT strftime('%Y-%m-%dT00:00:00Z', timestamp) as bucket,
          COUNT(*) as requests, SUM(tokens_input) as tokensIn, SUM(tokens_output) as tokensOut
        FROM usage_history
        WHERE api_key_name = ?
        GROUP BY bucket
        ORDER BY bucket ASC
      `).all(RECOVERED_HISTORY_KEY) as Array<Omit<TimelinePoint, 'timestamp' | 'cost'> & { bucket: string }>;

      const currentRows = this.db.prepare(`
        SELECT strftime('%Y-%m-%dT00:00:00Z', timestamp) as bucket,
          COUNT(*) as requests, SUM(tokens_input) as tokensIn, SUM(tokens_output) as tokensOut
        FROM usage_history
        WHERE api_key_name IS NOT NULL AND api_key_name != '' AND api_key_name != ?
        GROUP BY bucket
        HAVING COUNT(DISTINCT api_key_name) >= 3
        ORDER BY bucket ASC
      `).all(RECOVERED_HISTORY_KEY) as Array<Omit<TimelinePoint, 'timestamp' | 'cost'> & { bucket: string }>;

      const firstCurrentSourceDay = this.db.prepare(`
        SELECT MIN(strftime('%Y-%m-%dT00:00:00Z', timestamp)) as bucket
        FROM usage_history
        WHERE api_key_name IS NOT NULL AND api_key_name != '' AND api_key_name != ?
      `).get(RECOVERED_HISTORY_KEY) as { bucket: string | null };

      const pointsByDay = new Map<string, TimelinePoint>();
      for (const row of [...recoveredRows, ...currentRows]) {
        const point = pointsByDay.get(row.bucket);
        if (point) {
          point.requests += row.requests;
          point.tokensIn += row.tokensIn;
          point.tokensOut += row.tokensOut;
          continue;
        }
        pointsByDay.set(row.bucket, {
          timestamp: row.bucket,
          requests: row.requests,
          tokensIn: row.tokensIn,
          tokensOut: row.tokensOut,
          cost: 0,
        });
      }

      const lastRecovered = recoveredRows.at(-1)?.bucket;
      const firstCurrent = firstCurrentSourceDay.bucket ?? undefined;
      const gaps: HistoricalTimelineGap[] = [];
      if (lastRecovered && firstCurrent) {
        const start = new Date(lastRecovered);
        start.setUTCDate(start.getUTCDate() + 1);
        const end = new Date(firstCurrent);
        end.setUTCDate(end.getUTCDate() - 1);
        if (start <= end) {
          gaps.push({
            start: start.toISOString().replace('.000', ''),
            end: end.toISOString().replace('.000', ''),
            label: 'Missing historical data',
          });
        }
      }

      return {
        points: [...pointsByDay.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
        gaps,
      };
    });
  }

  resolveAlias(alias: string): string | null {
    const rows = this.db.prepare(
      "SELECT DISTINCT api_key_name as name FROM usage_history WHERE api_key_name IS NOT NULL AND api_key_name != '' AND api_key_name != ?"
    ).all(RECOVERED_HISTORY_KEY) as Array<{ name: string }>;
    return rows.find(row => this.anonymizer.alias(row.name) === alias)?.name ?? null;
  }

  getUserPublicStats(alias: string): UserPublicStats | null {
    const name = this.resolveAlias(alias);
    return name ? this.getUserStatsForKey(name) : null;
  }

  getAuthenticatedUserStats(name: string): UserPublicStats | null {
    return this.getUserStatsForKey(name);
  }

  private getUserStatsForKey(name: string): UserPublicStats | null {
    if (name === RECOVERED_HISTORY_KEY) return null;

    const row = this.db.prepare(`
      SELECT api_key_name as name, COUNT(*) as requests, SUM(tokens_input) as tokensIn, SUM(tokens_output) as tokensOut,
        AVG(latency_ms) as avgLatency, SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes,
        MIN(timestamp) as firstSeen, MAX(timestamp) as lastSeen
      FROM usage_history WHERE api_key_name = ?
    `).get(name) as { name: string | null; requests: number; tokensIn: number; tokensOut: number; avgLatency: number; successes: number; firstSeen: string; lastSeen: string } | null;

    if (!row || !row.name || row.requests === 0) return null;

    const models = this.db.prepare(
      `SELECT model, provider, COUNT(*) as count, SUM(tokens_input) as tokensIn, SUM(tokens_output) as tokensOut,
        AVG(latency_ms) as avgLatency, SUM(CASE WHEN success=1 THEN 1 ELSE 0 END) as successes,
        COUNT(DISTINCT api_key_name) as users, MAX(timestamp) as lastSeen
       FROM usage_history WHERE api_key_name = ? GROUP BY provider, model ORDER BY count DESC`
    ).all(name) as Array<{ model: string; provider: string; count: number; tokensIn: number; tokensOut: number; avgLatency: number; successes: number; users: number; lastSeen: string }>;

    const providers = this.db.prepare(
      'SELECT provider, COUNT(*) as count, SUM(tokens_input) as tokensIn, SUM(tokens_output) as tokensOut, SUM(CASE WHEN success=1 THEN 1 ELSE 0 END) as successes FROM usage_history WHERE api_key_name = ? GROUP BY provider ORDER BY count DESC'
    ).all(name) as Array<{ provider: string; count: number; tokensIn: number; tokensOut: number; successes: number }>;

    const alias = this.anonymizer.alias(row.name);
    return {
      name: alias,
      displayName: alias,
      requests: row.requests,
      tokensIn: row.tokensIn,
      tokensOut: row.tokensOut,
      cost: this.calculateUserCost(row.name),
      successRate: row.requests > 0 ? row.successes / row.requests : 0,
      avgLatency: Math.round(row.avgLatency),
      models: models.map(m => ({
        model: m.model,
        provider: m.provider,
        count: m.count,
        tokensIn: m.tokensIn,
        tokensOut: m.tokensOut,
        avgLatency: Math.round(m.avgLatency ?? 0),
        successRate: m.count > 0 ? m.successes / m.count : 0,
        users: m.users,
        lastSeen: m.lastSeen,
        cost: 0,
      })),
      providers: providers.map(p => ({ ...p, cost: 0, successRate: p.count > 0 ? p.successes / p.count : 0 })),
      firstSeen: row.firstSeen,
      lastSeen: row.lastSeen,
    };
  }

  private computeShannonEntropy(providerRows: Array<{ provider: string; cnt: number }>, total: number): number {
    if (total === 0 || providerRows.length === 0) return 0;
    return providerRows.reduce((sum, r) => {
      const p = r.cnt / total;
      return sum - p * Math.log(p);
    }, 0);
  }

  private computeSessionStats(timestampRows: Array<{ timestamp: string }>): { avgSessionMessages: number; longestSessionMessages: number } {
    const SESSION_GAP_MS = 30 * 60 * 1000;
    if (timestampRows.length === 0) return { avgSessionMessages: 0, longestSessionMessages: 0 };

    let sessionCount = 1;
    let currentSessionMessages = 1;
    let longestSessionMessages = 1;

    for (let i = 1; i < timestampRows.length; i++) {
      const prev = new Date(timestampRows[i - 1]!.timestamp).getTime();
      const curr = new Date(timestampRows[i]!.timestamp).getTime();
      if (curr - prev > SESSION_GAP_MS) {
        if (currentSessionMessages > longestSessionMessages) {
          longestSessionMessages = currentSessionMessages;
        }
        sessionCount++;
        currentSessionMessages = 1;
      } else {
        currentSessionMessages++;
      }
    }
    if (currentSessionMessages > longestSessionMessages) {
      longestSessionMessages = currentSessionMessages;
    }

    return {
      avgSessionMessages: timestampRows.length / sessionCount,
      longestSessionMessages,
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
