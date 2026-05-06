import type { Database } from 'bun:sqlite';
import { join, resolve } from 'node:path';
import { calculateCost } from './pricing.ts';
import { getSkillsCatalog, type SkillItemWithCategory } from './skills-catalog.ts';

export interface LogEntry {
  id: string;
  timestamp: string;
  method: string | null;
  path: string | null;
  model: string | null;
  requestedModel: string | null;
  provider: string | null;
  status: number | null;
  success: boolean;
  duration: number;
  tokensIn: number;
  tokensOut: number;
  tokensCacheRead: number;
  tokensCacheCreation: number;
  tokensReasoning: number;
  apiKeyName: string;
  sourceFormat: string | null;
  targetFormat: string | null;
  requestType: string | null;
  requestSummary: string | null;
  error: string | null;
  detailState: string | null;
  artifactSizeBytes: number | null;
  hasRequestBody: boolean;
  hasResponseBody: boolean;
  hasPipelineDetails: boolean;
}

export interface LogDetail extends LogEntry {
  account: string | null;
  connectionId: string | null;
  comboName: string | null;
  comboStepId: string | null;
  detail: unknown;
  trace: TraceStep[];
  artifact: {
    available: boolean;
    relpath: string | null;
    sizeBytes: number | null;
    preview: unknown;
  };
}

export interface TraceStep {
  id: string;
  kind: 'request' | 'auth' | 'routing' | 'model_call' | 'response' | 'billing';
  title: string;
  summary: string;
  timestamp: string;
  durationMs: number | null;
  status: 'success' | 'warning' | 'error' | 'info';
  meta: Array<{ label: string; value: string }>;
  detail: string;
}

export interface LogPage {
  logs: LogEntry[];
  items: LogEntry[];
  nextCursor: string | null;
  total: number;
  limit: number;
  offset: number;
}

export interface LogFacets {
  models: Array<{ value: string; count: number }>;
  providers: Array<{ value: string; count: number }>;
  statuses: Array<{ value: string; count: number }>;
  dates: Array<{ value: string; count: number }>;
}

export interface UserSession {
  id: string;
  firstSeen: string;
  lastSeen: string;
  requests: number;
  successful: number;
  successRate: number;
  tokensIn: number;
  tokensOut: number;
  avgLatency: number;
  topModel: string | null;
  topProvider: string | null;
  lastSummary: string | null;
}

export interface BalanceLedgerEntry {
  id: string;
  timestamp: string;
  type: 'credit' | 'debit' | 'refill';
  label: string;
  amount: number;
  balanceAfter: number;
  detail: string;
}

export interface UserBalance {
  monthlyLimit: number;
  currency: 'USD';
  periodStart: string;
  nextRefillAt: string;
  currentSpend: number;
  remaining: number;
  usagePercent: number;
  keyCreatedAt: string;
  ledger: BalanceLedgerEntry[];
}

export interface ActivityDay {
  date: string;
  requests: number;
  sessions: number;
  tokens: number;
  cost: number;
  successRate: number;
  firstSeen: string | null;
  lastSeen: string | null;
  topModel: string | null;
  topProvider: string | null;
}

export interface UserRecommendation {
  id: string;
  severity: 'info' | 'attention' | 'critical';
  title: string;
  body: string;
  action: string;
}

export interface UserActivityAnalytics {
  days: ActivityDay[];
  recommendations: UserRecommendation[];
}

export interface SkillMappingItem {
  id: string;
  slug: string;
  category: string;
  source: string;
  status: 'used' | 'recommended' | 'unused';
  confidence: number;
  evidence: string;
  reason: string;
  insight: string;
  nextStep: string;
  matchedSignals: string[];
  installCommand: string;
}

export interface UserSkillsMapping {
  totalSkills: number;
  usedCount: number;
  recommendedCount: number;
  items: SkillMappingItem[];
}

type SortColumn = 'timestamp' | 'duration' | 'status' | 'model' | 'provider' | 'tokens';

interface LogFilters {
  cursor?: string;
  q?: string;
  limit?: number;
  offset?: number;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  model?: string;
  provider?: string;
  status?: string;
  sort?: string;
  order?: string;
}

interface DbLogRow {
  id: string;
  timestamp: string;
  method: string | null;
  path: string | null;
  status: number | null;
  model: string | null;
  requestedModel: string | null;
  provider: string | null;
  account: string | null;
  connectionId: string | null;
  duration: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  tokensCacheRead: number | null;
  tokensCacheCreation: number | null;
  tokensReasoning: number | null;
  sourceFormat: string | null;
  targetFormat: string | null;
  apiKeyName: string;
  comboName: string | null;
  comboStepId: string | null;
  error: string | null;
  detailState: string | null;
  artifactRelpath: string | null;
  artifactSizeBytes: number | null;
  hasRequestBody: number | null;
  hasResponseBody: number | null;
  hasPipelineDetails: number | null;
  requestSummary: string | null;
  requestType: string | null;
  requestBody?: string | null;
  responseBody?: string | null;
}

const SORT_SQL: Record<SortColumn, string> = {
  timestamp: 'timestamp',
  duration: 'duration',
  status: 'status',
  model: 'model',
  provider: 'provider',
  tokens: '(tokens_in + tokens_out + COALESCE(tokens_cache_read, 0) + COALESCE(tokens_reasoning, 0))',
};

const SECRET_KEY_RE = /(authorization|api[-_ ]?key|token|secret|cookie|password|bearer|x-api-key)/i;
const SECRET_VALUE_RE = /(sk-[A-Za-z0-9_-]{16,}|agisota-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]{12,})/g;
const MONTHLY_LIMIT_USD = 10_000;

export class LogReader {
  private db: Database;
  private logsPath?: string;
  private callLogColumns: Set<string>;
  private detailTableExists: boolean;

  constructor(db: Database, logsPath?: string) {
    this.db = db;
    this.logsPath = logsPath;
    this.callLogColumns = new Set(
      (this.db.prepare('PRAGMA table_info(call_logs)').all() as Array<{ name: string }>).map(c => c.name),
    );
    this.detailTableExists = this.tableExists('request_detail_logs');
  }

  async getUserLogs(apiKeyName: string, options: LogFilters = {}): Promise<LogPage> {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
    const offset = Math.max(0, options.offset ?? 0);
    const { where, params } = this.buildWhere(apiKeyName, options);
    const sort = this.normalizeSort(options.sort);
    const order = options.order?.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const totalRow = this.db.prepare(`SELECT COUNT(*) as total FROM call_logs WHERE ${where}`).get(params) as { total: number };
    const rows = this.db.prepare(`
      SELECT ${this.baseSelectList()}
      FROM call_logs
      WHERE ${where}
      ORDER BY ${SORT_SQL[sort]} ${order}, timestamp DESC
      LIMIT $limit OFFSET $offset
    `).all({ ...params, $limit: limit, $offset: offset }) as DbLogRow[];

    const logs = rows.map(row => this.toEntry(row));
    return {
      logs,
      items: logs,
      nextCursor: offset + limit < totalRow.total ? logs.at(-1)?.id ?? null : null,
      total: totalRow.total,
      limit,
      offset,
    };
  }

  getUserLogFacets(apiKeyName: string): LogFacets {
    const byValue = (field: string) => this.db.prepare(`
      SELECT ${field} as value, COUNT(*) as count
      FROM call_logs
      WHERE api_key_name = ? AND ${field} IS NOT NULL AND ${field} != ''
      GROUP BY ${field}
      ORDER BY count DESC
      LIMIT 80
    `).all(apiKeyName) as Array<{ value: string; count: number }>;

    const statuses = this.db.prepare(`
      SELECT CASE WHEN status >= 200 AND status < 400 THEN 'success' ELSE 'error' END as value, COUNT(*) as count
      FROM call_logs
      WHERE api_key_name = ?
      GROUP BY value
      ORDER BY value DESC
    `).all(apiKeyName) as Array<{ value: string; count: number }>;

    const dates = this.db.prepare(`
      SELECT substr(timestamp, 1, 10) as value, COUNT(*) as count
      FROM call_logs
      WHERE api_key_name = ?
      GROUP BY value
      ORDER BY value DESC
      LIMIT 45
    `).all(apiKeyName) as Array<{ value: string; count: number }>;

    return {
      models: byValue('model'),
      providers: byValue('provider'),
      statuses,
      dates,
    };
  }

  getUserSessions(apiKeyName: string): UserSession[] {
    const rows = this.db.prepare(`
      SELECT ${this.baseSelectList()}
      FROM call_logs
      WHERE api_key_name = ?
      ORDER BY timestamp ASC
    `).all(apiKeyName) as DbLogRow[];

    const sessions: DbLogRow[][] = [];
    const gapMs = 30 * 60 * 1000;
    for (const row of rows) {
      const current = sessions.at(-1);
      const previous = current?.at(-1);
      const previousMs = previous ? new Date(previous.timestamp).getTime() : 0;
      const currentMs = new Date(row.timestamp).getTime();
      if (!current || current.length === 0 || currentMs - previousMs > gapMs) {
        sessions.push([row]);
      } else {
        current.push(row);
      }
    }

    return sessions
      .reverse()
      .slice(0, 80)
      .map((session, index) => this.toSession(session, index));
  }

  async getLogDetail(apiKeyName: string, logId: string): Promise<LogDetail | null> {
    const row = this.db.prepare(`
      SELECT ${this.baseSelectList()}
      FROM call_logs
      WHERE api_key_name = $apiKeyName AND id = $logId
      LIMIT 1
    `).get({ $apiKeyName: apiKeyName, $logId: logId }) as DbLogRow | null;

    if (!row) return null;

    const detail = this.getDetailTablePayload(logId);
    const artifactPreview = await this.getArtifactPreview(row.artifactRelpath);
    const entry = this.toEntry(row);
    const trace = this.buildTrace(row, detail, artifactPreview.preview);

    return {
      ...entry,
      account: row.account,
      connectionId: row.connectionId,
      comboName: row.comboName,
      comboStepId: row.comboStepId,
      detail,
      trace,
      artifact: {
        available: artifactPreview.available,
        relpath: row.artifactRelpath,
        sizeBytes: row.artifactSizeBytes,
        preview: artifactPreview.preview,
      },
    };
  }

  getUserBalance(apiKeyName: string, createdAt: string): UserBalance {
    const monthlyLimit = MONTHLY_LIMIT_USD;
    const now = new Date();
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const nextRefillAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const mayRefillAt = new Date('2026-05-01T00:00:00.000Z');
    const created = new Date(createdAt);
    const ledger: BalanceLedgerEntry[] = [];

    let balance = monthlyLimit;
    ledger.push({
      id: 'initial-credit',
      timestamp: createdAt,
      type: 'credit',
      label: 'Стартовый баланс ключа',
      amount: monthlyLimit,
      balanceAfter: balance,
      detail: 'Первая виртуальная операция при создании API key: ежемесячный лимит открыт на $10,000.',
    });

    if (created.getTime() < mayRefillAt.getTime()) {
      const spendBeforeMay = this.sumUserCost(apiKeyName, created.toISOString(), mayRefillAt.toISOString());
      if (spendBeforeMay > 0) {
        balance = Math.max(0, balance - spendBeforeMay);
        ledger.push({
          id: 'pre-may-usage',
          timestamp: new Date(mayRefillAt.getTime() - 1).toISOString(),
          type: 'debit',
          label: 'Использование до майского refill',
          amount: -spendBeforeMay,
          balanceAfter: balance,
          detail: 'Агрегированная расчетная стоимость запросов до 01.05.2026.',
        });
      }
      const refill = Math.max(0, monthlyLimit - balance);
      balance = monthlyLimit;
      ledger.push({
        id: '2026-05-refill',
        timestamp: mayRefillAt.toISOString(),
        type: 'refill',
        label: 'Ежемесячное пополнение баланса',
        amount: refill,
        balanceAfter: balance,
        detail: refill > 0
          ? '01.05.2026 баланс был восполнен ровно на сумму, которой не хватало до $10,000.'
          : '01.05.2026 баланс уже был полным, поэтому сумма пополнения равна $0.',
      });
    }

    const currentSpend = this.sumUserCost(apiKeyName, periodStart.toISOString(), now.toISOString());
    const remaining = Math.max(0, monthlyLimit - currentSpend);
    ledger.push({
      id: 'current-month-usage',
      timestamp: now.toISOString(),
      type: 'debit',
      label: 'Использование в текущем месяце',
      amount: -currentSpend,
      balanceAfter: remaining,
      detail: 'Сумма списания расчетная: считается из read-only логов и тарифов моделей, без изменения системных таблиц.',
    });

    return {
      monthlyLimit,
      currency: 'USD',
      periodStart: periodStart.toISOString(),
      nextRefillAt: nextRefillAt.toISOString(),
      currentSpend,
      remaining,
      usagePercent: monthlyLimit > 0 ? Math.min(1, currentSpend / monthlyLimit) : 0,
      keyCreatedAt: createdAt,
      ledger,
    };
  }

  getUserActivityAnalytics(apiKeyName: string): UserActivityAnalytics {
    const rows = this.db.prepare(`
      SELECT ${this.baseSelectList()}
      FROM call_logs
      WHERE api_key_name = ?
      ORDER BY timestamp ASC
    `).all(apiKeyName) as DbLogRow[];

    const byDate = new Map<string, DbLogRow[]>();
    for (const row of rows) {
      const date = row.timestamp.slice(0, 10);
      const list = byDate.get(date) ?? [];
      list.push(row);
      byDate.set(date, list);
    }

    const days = [...byDate.entries()].map(([date, dayRows]) => {
      const successful = dayRows.filter(row => this.isSuccess(row)).length;
      const modelCounts = this.countBy(dayRows.map(row => row.model).filter(Boolean) as string[]);
      const providerCounts = this.countBy(dayRows.map(row => row.provider).filter(Boolean) as string[]);
      return {
        date,
        requests: dayRows.length,
        sessions: this.countSessions(dayRows),
        tokens: dayRows.reduce((sum, row) => sum + (row.tokensIn ?? 0) + (row.tokensOut ?? 0) + (row.tokensCacheRead ?? 0) + (row.tokensReasoning ?? 0), 0),
        cost: this.costRows(dayRows),
        successRate: dayRows.length > 0 ? successful / dayRows.length : 0,
        firstSeen: dayRows[0]?.timestamp ?? null,
        lastSeen: dayRows.at(-1)?.timestamp ?? null,
        topModel: this.topCount(modelCounts),
        topProvider: this.topCount(providerCounts),
      };
    }).sort((a, b) => a.date.localeCompare(b.date));

    return {
      days,
      recommendations: this.buildRecommendations(rows, days),
    };
  }

  getUserSkillsMapping(apiKeyName: string): UserSkillsMapping {
    const skills = getSkillsCatalog();
    const rows = this.db.prepare(`
      SELECT model, provider, path, request_summary, error_summary
      FROM call_logs
      WHERE api_key_name = ?
      ORDER BY timestamp DESC
      LIMIT 1500
    `).all(apiKeyName) as Array<{ model: string | null; provider: string | null; path: string | null; request_summary: string | null; error_summary: string | null }>;

    const haystack = rows
      .map(row => `${row.model ?? ''} ${row.provider ?? ''} ${row.path ?? ''} ${row.request_summary ?? ''} ${row.error_summary ?? ''}`)
      .join('\n')
      .toLowerCase();
    const userSignals = this.userSkillSignals(rows);

    const scored = skills.map(skill => scoreSkill(skill, haystack, userSignals));
    const usedAll = scored.filter(item => item.status === 'used');
    const used = usedAll.sort((a, b) => b.confidence - a.confidence).slice(0, 16);
    const recommended = scored
      .filter(item => item.status !== 'used')
      .sort((a, b) => b.confidence - a.confidence || b.downloads - a.downloads)
      .slice(0, 16)
      .map(item => ({ ...item, status: 'recommended' as const }));
    const selectedIds = new Set([...used, ...recommended].map(item => item.id));
    const sampleUnused = scored
      .filter(item => item.status === 'unused' && !selectedIds.has(item.id))
      .sort((a, b) => b.downloads - a.downloads)
      .slice(0, 8);
    const items = [...used, ...recommended, ...sampleUnused].map(({ downloads: _downloads, ...item }) => item);

    return {
      totalSkills: skills.length,
      usedCount: usedAll.length,
      recommendedCount: recommended.length,
      items,
    };
  }

  private sumUserCost(apiKeyName: string, fromIso: string, toIso: string): number {
    const rows = this.db.prepare(`
      SELECT
        COALESCE(${this.col('model')}, ${this.col('requested_model')}, 'unknown') as model,
        SUM(COALESCE(${this.col('tokens_in', '0')}, 0)) as tokensIn,
        SUM(COALESCE(${this.col('tokens_out', '0')}, 0)) as tokensOut
      FROM call_logs
      WHERE api_key_name = $apiKeyName
        AND timestamp >= $fromIso
        AND timestamp < $toIso
      GROUP BY COALESCE(${this.col('model')}, ${this.col('requested_model')}, 'unknown')
    `).all({ $apiKeyName: apiKeyName, $fromIso: fromIso, $toIso: toIso }) as Array<{ model: string; tokensIn: number; tokensOut: number }>;

    return rows.reduce((sum, row) => sum + calculateCost(row.model, row.tokensIn ?? 0, row.tokensOut ?? 0), 0);
  }

  private costRows(rows: DbLogRow[]): number {
    return rows.reduce((sum, row) => sum + calculateCost(row.model ?? row.requestedModel ?? 'unknown', row.tokensIn ?? 0, row.tokensOut ?? 0), 0);
  }

  private countSessions(rows: DbLogRow[]): number {
    if (rows.length === 0) return 0;
    const sorted = [...rows].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const gapMs = 30 * 60 * 1000;
    let sessions = 1;
    let previousMs = new Date(sorted[0]!.timestamp).getTime();
    for (const row of sorted.slice(1)) {
      const currentMs = new Date(row.timestamp).getTime();
      if (currentMs - previousMs > gapMs) sessions += 1;
      previousMs = currentMs;
    }
    return sessions;
  }

  private isSuccess(row: DbLogRow): boolean {
    const status = row.status ?? 0;
    return status >= 200 && status < 400;
  }

  private buildRecommendations(rows: DbLogRow[], days: ActivityDay[]): UserRecommendation[] {
    if (rows.length === 0) {
      return [{
        id: 'first-session',
        severity: 'info',
        title: 'Логи пока не накопились',
        body: 'После первых запросов здесь появятся советы по моделям, latency, cost и стабильности.',
        action: 'Сделайте несколько рабочих запросов через API key и вернитесь к кабинету.',
      }];
    }

    const recommendations: UserRecommendation[] = [];
    const successful = rows.filter(row => this.isSuccess(row)).length;
    const successRate = successful / rows.length;
    const avgLatency = rows.reduce((sum, row) => sum + (row.duration ?? 0), 0) / rows.length;
    const totalCost = this.costRows(rows);
    const providerCounts = this.countBy(rows.map(row => row.provider).filter(Boolean) as string[]);
    const topProviderCount = Math.max(0, ...providerCounts.values());
    const providerConcentration = rows.length > 0 ? topProviderCount / rows.length : 0;
    const activeDays = days.filter(day => day.requests > 0).length;

    if (successRate < 0.9) {
      recommendations.push({
        id: 'success-rate-critical',
        severity: 'critical',
        title: 'Много неуспешных запросов',
        body: `Success rate сейчас ${Math.round(successRate * 100)}%. Ошибки напрямую сжигают баланс и ломают agent flow.`,
        action: 'Отфильтруйте логи по ошибкам и проверьте модели, лимиты provider и retry behavior.',
      });
    } else if (successRate < 0.97) {
      recommendations.push({
        id: 'success-rate-watch',
        severity: 'attention',
        title: 'Есть запас по стабильности',
        body: `Success rate ${Math.round(successRate * 100)}%: рабочий уровень, но не production-grade для длинных agent sessions.`,
        action: 'Сравните error rows с успешными запросами той же модели и provider.',
      });
    }

    if (avgLatency > 12_000) {
      recommendations.push({
        id: 'latency-high',
        severity: 'attention',
        title: 'Высокая задержка',
        body: `Средняя задержка около ${Math.round(avgLatency / 100) / 10} c. Для интерактивных агентов это уже заметно пользователю.`,
        action: 'Проверьте более быстрые модели для routing, draft и tool-planning шагов.',
      });
    }

    if (totalCost > MONTHLY_LIMIT_USD * 0.75) {
      recommendations.push({
        id: 'cost-heavy',
        severity: 'critical',
        title: 'Баланс близко к лимиту',
        body: `Расчетная стоимость за видимый период уже выше 75% месячного лимита $${MONTHLY_LIMIT_USD.toLocaleString('en-US')}.`,
        action: 'Вынесите тяжелые рассуждения в точечные вызовы и используйте mini/flash модели для дешевых шагов.',
      });
    } else if (totalCost > MONTHLY_LIMIT_USD * 0.35) {
      recommendations.push({
        id: 'cost-watch',
        severity: 'attention',
        title: 'Cost стоит держать под контролем',
        body: 'Основной расход обычно создают длинные prompts, retries и дорогие модели на простых шагах.',
        action: 'Смотрите trace запроса: где растут tokens и где можно сменить модель.',
      });
    }

    if (providerConcentration > 0.85 && providerCounts.size > 1) {
      recommendations.push({
        id: 'provider-concentration',
        severity: 'info',
        title: 'Провайдер почти монополизирует трафик',
        body: 'Один provider обслуживает большую часть запросов. Это удобно, но снижает отказоустойчивость.',
        action: 'Добавьте fallback модели для критичных сценариев и проверяйте latency по provider.',
      });
    }

    if (activeDays < 3 && days.length >= 7) {
      recommendations.push({
        id: 'activity-rhythm',
        severity: 'info',
        title: 'Неровный ритм активности',
        body: 'Heatmap показывает редкие пики вместо устойчивого рабочего паттерна.',
        action: 'Используйте сессии как контрольные точки: сравнивайте cost, ошибки и модели по активным дням.',
      });
    }

    if (recommendations.length === 0) {
      recommendations.push({
        id: 'healthy-ops',
        severity: 'info',
        title: 'Рабочий профиль выглядит здорово',
        body: 'Success rate, latency и cost не показывают явных провалов на текущем срезе.',
        action: 'Продолжайте смотреть trace деталей при росте cost или при смене основной модели.',
      });
    }

    return recommendations.slice(0, 5);
  }

  private userSkillSignals(rows: Array<{ request_summary: string | null; error_summary: string | null; path: string | null; model: string | null; provider: string | null }>): Set<string> {
    const haystack = rows
      .map(row => `${row.request_summary ?? ''} ${row.error_summary ?? ''} ${row.path ?? ''} ${row.model ?? ''} ${row.provider ?? ''}`)
      .join('\n')
      .toLowerCase();
    const signals = new Set<string>();

    if (/ui|ux|visual|frontend|react|vite|css|browser|screenshot|mobile|accessibility/.test(haystack)) signals.add('Веб и интерфейсы');
    if (/deploy|docker|caddy|cloudflare|server|container|ssh|health|status|infra|endpoint/.test(haystack)) signals.add('Инфраструктура и деплой');
    if (/error|failed|secret|security|auth|key|token|privacy|audit|risk/.test(haystack)) signals.add('Безопасность и аудит');
    if (/research|analyze|find|compare|source|paper|docs|web|crawl/.test(haystack)) signals.add('Исследования и анализ');
    if (/report|pdf|docx|deck|slides|spreadsheet|table|csv|presentation/.test(haystack)) signals.add('Документы и офис');
    if (/agent|tool|workflow|trace|session|mcp|skill|prompt|planner|executor|verifier/.test(haystack)) signals.add('Агенты и workflow');
    if (/api|sdk|integration|webhook|provider|postgres|sqlite|database|route/.test(haystack)) signals.add('Интеграции и API');

    return signals.size > 0 ? signals : new Set(['Агенты и workflow', 'Инфраструктура и деплой']);
  }

  private buildTrace(row: DbLogRow, detail: unknown, artifactPreview: unknown): TraceStep[] {
    const timestamp = row.timestamp;
    const durationMs = row.duration ?? null;
    const statusCode = row.status ?? 0;
    const success = this.isSuccess(row);
    const model = row.model ?? row.requestedModel ?? 'unknown';
    const provider = row.provider ?? 'unknown';
    const tokens = (row.tokensIn ?? 0) + (row.tokensOut ?? 0) + (row.tokensCacheRead ?? 0) + (row.tokensReasoning ?? 0);
    const cost = calculateCost(model, row.tokensIn ?? 0, row.tokensOut ?? 0);
    const detailHints = summarizePayload(detail ?? artifactPreview);

    return [
      {
        id: 'request',
        kind: 'request',
        title: 'Входящий запрос',
        summary: `${row.method ?? 'HTTP'} ${row.path ?? 'unknown path'}`,
        timestamp,
        durationMs: null,
        status: 'info',
        meta: [
          { label: 'type', value: row.requestType ?? 'completion' },
          { label: 'source', value: row.sourceFormat ?? 'client' },
        ],
        detail: 'Клиент отправил запрос в API. На этом шаге фиксируются путь, формат и очищенное описание без секретов.',
      },
      {
        id: 'auth',
        kind: 'auth',
        title: 'API key scope',
        summary: row.apiKeyName,
        timestamp,
        durationMs: null,
        status: success ? 'success' : 'warning',
        meta: [
          { label: 'key profile', value: row.apiKeyName },
          { label: 'status', value: String(statusCode || 'unknown') },
        ],
        detail: 'Запрос привязан к личному API key. Кабинет показывает только этот профиль и не раскрывает сам ключ.',
      },
      {
        id: 'routing',
        kind: 'routing',
        title: 'Routing decision',
        summary: `${row.requestedModel ?? model} -> ${provider}`,
        timestamp,
        durationMs: null,
        status: row.provider ? 'success' : 'warning',
        meta: [
          { label: 'requested', value: row.requestedModel ?? model },
          { label: 'provider', value: provider },
        ],
        detail: 'Routing layer выбрал provider/model для выполнения запроса. Здесь удобно искать неочевидные fallback или model alias.',
      },
      {
        id: 'model-call',
        kind: 'model_call',
        title: 'LLM call',
        summary: model,
        timestamp,
        durationMs,
        status: success ? 'success' : 'error',
        meta: [
          { label: 'tokens in', value: String(row.tokensIn ?? 0) },
          { label: 'tokens out', value: String(row.tokensOut ?? 0) },
          { label: 'cache', value: String((row.tokensCacheRead ?? 0) + (row.tokensCacheCreation ?? 0)) },
        ],
        detail: detailHints || 'Модель обработала prompt/response. На hover смотрите tokens, latency и sanitized details.',
      },
      {
        id: 'response',
        kind: 'response',
        title: success ? 'Ответ клиенту' : 'Ошибка ответа',
        summary: success ? 'Successful response' : (row.error ?? 'Request failed'),
        timestamp,
        durationMs,
        status: success ? 'success' : 'error',
        meta: [
          { label: 'status', value: String(statusCode || 'unknown') },
          { label: 'latency', value: durationMs != null ? `${Math.round(durationMs / 100) / 10}s` : 'unknown' },
        ],
        detail: row.error ?? row.requestSummary ?? 'Финальный результат запроса после обработки provider response.',
      },
      {
        id: 'billing',
        kind: 'billing',
        title: 'Balance impact',
        summary: `-${formatUsd(cost)} расчетно`,
        timestamp,
        durationMs: null,
        status: cost > 2 ? 'warning' : 'info',
        meta: [
          { label: 'tokens', value: String(tokens) },
          { label: 'cost', value: formatUsd(cost) },
        ],
        detail: 'Списание виртуального баланса считается из read-only логов и тарифной таблицы приложения. Системные таблицы не изменяются.',
      },
    ];
  }

  private buildWhere(apiKeyName: string, options: LogFilters): { where: string; params: Record<string, string | number> } {
    const clauses = ['api_key_name = $apiKeyName'];
    const params: Record<string, string | number> = { $apiKeyName: apiKeyName };

    if (options.cursor) {
      clauses.push('id < $cursor');
      params.$cursor = options.cursor;
    }
    if (options.date) {
      clauses.push("substr(timestamp, 1, 10) = $date");
      params.$date = options.date;
    }
    if (options.dateFrom) {
      clauses.push('timestamp >= $dateFrom');
      params.$dateFrom = options.dateFrom;
    }
    if (options.dateTo) {
      clauses.push('timestamp <= $dateTo');
      params.$dateTo = options.dateTo;
    }
    if (options.model) {
      clauses.push('model = $model');
      params.$model = options.model;
    }
    if (options.provider) {
      clauses.push('provider = $provider');
      params.$provider = options.provider;
    }
    if (options.status) {
      if (options.status === 'success') {
        clauses.push('status >= 200 AND status < 400');
      } else if (options.status === 'error') {
        clauses.push('(status < 200 OR status >= 400 OR status IS NULL)');
      } else if (/^\d+$/.test(options.status)) {
        clauses.push('status = $status');
        params.$status = Number(options.status);
      }
    }
    if (options.q?.trim()) {
      params.$q = `%${options.q.trim().toLowerCase()}%`;
      clauses.push(`(
        lower(id) LIKE $q OR lower(COALESCE(model, '')) LIKE $q OR lower(COALESCE(provider, '')) LIKE $q OR
        lower(COALESCE(path, '')) LIKE $q OR lower(COALESCE(${this.col('request_summary', "''")}, '')) LIKE $q OR
        lower(COALESCE(${this.col('error_summary', this.col('error', "''"))}, '')) LIKE $q
      )`);
    }

    return { where: clauses.join(' AND '), params };
  }

  private baseSelectList(): string {
    return [
      'id',
      'timestamp',
      this.alias('method', 'method'),
      this.alias('path', 'path'),
      this.alias('status', 'status'),
      this.alias('model', 'model'),
      this.alias('requested_model', 'requestedModel'),
      this.alias('provider', 'provider'),
      this.alias('account', 'account'),
      this.alias('connection_id', 'connectionId'),
      this.alias('duration', 'duration', '0'),
      this.alias('tokens_in', 'tokensIn', '0'),
      this.alias('tokens_out', 'tokensOut', '0'),
      this.alias('tokens_cache_read', 'tokensCacheRead', '0'),
      this.alias('tokens_cache_creation', 'tokensCacheCreation', '0'),
      this.alias('tokens_reasoning', 'tokensReasoning', '0'),
      this.alias('source_format', 'sourceFormat'),
      this.alias('target_format', 'targetFormat'),
      'api_key_name as apiKeyName',
      this.alias('combo_name', 'comboName'),
      this.alias('combo_step_id', 'comboStepId'),
      this.alias('error_summary', 'error', this.col('error', 'NULL')),
      this.alias('detail_state', 'detailState'),
      this.alias('artifact_relpath', 'artifactRelpath'),
      this.alias('artifact_size_bytes', 'artifactSizeBytes'),
      this.alias('has_request_body', 'hasRequestBody', this.callLogColumns.has('request_body') ? 'CASE WHEN request_body IS NOT NULL THEN 1 ELSE 0 END' : '0'),
      this.alias('has_response_body', 'hasResponseBody', this.callLogColumns.has('response_body') ? 'CASE WHEN response_body IS NOT NULL THEN 1 ELSE 0 END' : '0'),
      this.alias('has_pipeline_details', 'hasPipelineDetails', '0'),
      this.alias('request_summary', 'requestSummary'),
      this.alias('request_type', 'requestType'),
      this.alias('request_body', 'requestBody'),
      this.alias('response_body', 'responseBody'),
    ].join(', ');
  }

  private alias(column: string, alias: string, fallback = 'NULL'): string {
    return `${this.col(column, fallback)} as ${alias}`;
  }

  private col(column: string, fallback = 'NULL'): string {
    return this.callLogColumns.has(column) ? column : fallback;
  }

  private normalizeSort(value?: string): SortColumn {
    if (value === 'duration' || value === 'status' || value === 'model' || value === 'provider' || value === 'tokens') {
      return value;
    }
    return 'timestamp';
  }

  private toEntry(row: DbLogRow): LogEntry {
    const status = row.status ?? 0;
    return {
      id: row.id,
      timestamp: row.timestamp,
      method: row.method,
      path: row.path,
      model: row.model,
      requestedModel: row.requestedModel,
      provider: row.provider,
      status: row.status,
      success: status >= 200 && status < 400,
      duration: row.duration ?? 0,
      tokensIn: row.tokensIn ?? 0,
      tokensOut: row.tokensOut ?? 0,
      tokensCacheRead: row.tokensCacheRead ?? 0,
      tokensCacheCreation: row.tokensCacheCreation ?? 0,
      tokensReasoning: row.tokensReasoning ?? 0,
      apiKeyName: row.apiKeyName,
      sourceFormat: row.sourceFormat,
      targetFormat: row.targetFormat,
      requestType: row.requestType,
      requestSummary: row.requestSummary,
      error: row.error,
      detailState: row.detailState,
      artifactSizeBytes: row.artifactSizeBytes,
      hasRequestBody: row.hasRequestBody === 1,
      hasResponseBody: row.hasResponseBody === 1,
      hasPipelineDetails: row.hasPipelineDetails === 1,
    };
  }

  private toSession(rows: DbLogRow[], index: number): UserSession {
    const modelCounts = this.countBy(rows.map(r => r.model).filter(Boolean) as string[]);
    const providerCounts = this.countBy(rows.map(r => r.provider).filter(Boolean) as string[]);
    const successful = rows.filter(r => {
      const status = r.status ?? 0;
      return status >= 200 && status < 400;
    }).length;
    const latencySum = rows.reduce((sum, r) => sum + (r.duration ?? 0), 0);
    const first = rows[0]!;
    const last = rows[rows.length - 1]!;

    return {
      id: `session-${first.timestamp}-${index}`,
      firstSeen: first.timestamp,
      lastSeen: last.timestamp,
      requests: rows.length,
      successful,
      successRate: rows.length > 0 ? successful / rows.length : 0,
      tokensIn: rows.reduce((sum, r) => sum + (r.tokensIn ?? 0), 0),
      tokensOut: rows.reduce((sum, r) => sum + (r.tokensOut ?? 0), 0),
      avgLatency: rows.length > 0 ? Math.round(latencySum / rows.length) : 0,
      topModel: this.topCount(modelCounts),
      topProvider: this.topCount(providerCounts),
      lastSummary: last.requestSummary ?? last.error ?? null,
    };
  }

  private countBy(values: string[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    return counts;
  }

  private topCount(counts: Map<string, number>): string | null {
    let top: string | null = null;
    let count = -1;
    for (const [value, next] of counts) {
      if (next > count) {
        top = value;
        count = next;
      }
    }
    return top;
  }

  private getDetailTablePayload(logId: string): unknown {
    if (!this.detailTableExists) return null;
    const detail = this.db.prepare(`
      SELECT client_request, translated_request, provider_response, client_response, provider, model, source_format, target_format, duration_ms
      FROM request_detail_logs
      WHERE call_log_id = ?
      ORDER BY timestamp DESC
      LIMIT 1
    `).get(logId) as Record<string, unknown> | null;
    return detail ? redact(detail) : null;
  }

  private async getArtifactPreview(relpath: string | null): Promise<{ available: boolean; preview: unknown }> {
    if (!this.logsPath || !relpath) {
      return { available: false, preview: null };
    }

    const base = resolve(this.logsPath);
    const target = resolve(join(base, relpath));
    if (!target.startsWith(base)) {
      return { available: false, preview: null };
    }

    try {
      const parsed = await Bun.file(target).json();
      return { available: true, preview: redact(parsed) };
    } catch {
      return { available: false, preview: null };
    }
  }

  private tableExists(name: string): boolean {
    const row = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
    return Boolean(row);
  }
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[truncated]';
  if (value == null) return value;
  if (typeof value === 'string') {
    const sanitized = value.replace(SECRET_VALUE_RE, '[redacted]');
    return sanitized.length > 12_000 ? `${sanitized.slice(0, 12_000)}... [truncated]` : sanitized;
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 80).map(item => redact(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    out[key] = SECRET_KEY_RE.test(key) ? '[redacted]' : redact(nested, depth + 1);
  }
  return out;
}

interface ScoredSkillMappingItem extends SkillMappingItem {
  downloads: number;
}

function scoreSkill(skill: SkillItemWithCategory, haystack: string, userSignals: Set<string>): ScoredSkillMappingItem {
  const title = skill.title.toLowerCase();
  const slug = skill.slug.toLowerCase();
  const tagHit = skill.tags.some(tag => haystack.includes(tag.toLowerCase()));
  const titleTokens = title.split(/[^a-zа-я0-9]+/i).filter(token => token.length >= 4);
  const titleHits = titleTokens.filter(token => haystack.includes(token)).length;
  const slugHit = haystack.includes(slug) || haystack.includes(slug.replaceAll('-', ' '));
  const categorySignal = userSignals.has(skill.category);
  const intel = categorySkillIntel(skill.category);
  const matchedSignals = buildSkillSignals(skill, { slugHit, tagHit, titleHits, categorySignal });

  if (slugHit || tagHit || titleHits >= 2) {
    return {
      id: skill.id,
      slug: skill.slug,
      category: skill.category,
      source: skill.source,
      status: 'used',
      confidence: Math.min(0.98, 0.72 + titleHits * 0.07 + (slugHit ? 0.12 : 0) + (tagHit ? 0.08 : 0)),
      evidence: slugHit ? 'Найдено прямое совпадение slug/name в ваших логах.' : 'Совпали теги или ключевые слова из описаний запросов.',
      reason: `Этот skill уже близок к реальным запросам пользователя. Его стоит закрепить как повторяемый шаг в категории "${skill.category}", а не держать как случайную подсказку.`,
      insight: intel.used,
      nextStep: intel.usedNextStep,
      matchedSignals,
      installCommand: skill.installCommand,
      downloads: skill.downloads,
    };
  }

  if (categorySignal) {
    return {
      id: skill.id,
      slug: skill.slug,
      category: skill.category,
      source: skill.source,
      status: 'recommended',
      confidence: Math.min(0.82, 0.5 + Math.log10(Math.max(10, skill.downloads + 10)) / 10),
      evidence: `Ваши последние запросы часто попадают в категорию "${skill.category}".`,
      reason: intel.reason,
      insight: intel.recommended,
      nextStep: intel.nextStep,
      matchedSignals,
      installCommand: skill.installCommand,
      downloads: skill.downloads,
    };
  }

  return {
    id: skill.id,
    slug: skill.slug,
    category: skill.category,
    source: skill.source,
    status: 'unused',
    confidence: 0.2,
    evidence: 'В последних логах нет явных совпадений.',
    reason: 'Пока нет сигнала, что этот skill нужен в текущем рабочем профиле пользователя.',
    insight: 'Не добавляем в основной workflow без признаков пользы: так кабинет остается операционным, а не списком всего каталога.',
    nextStep: 'Вернуться к нему, когда в логах появятся похожие задачи или ошибки.',
    matchedSignals,
    installCommand: skill.installCommand,
    downloads: skill.downloads,
  };
}

function buildSkillSignals(
  skill: SkillItemWithCategory,
  matches: { slugHit: boolean; tagHit: boolean; titleHits: number; categorySignal: boolean },
): string[] {
  const signals: string[] = [];
  if (matches.slugHit) signals.push('direct slug');
  if (matches.tagHit) signals.push('tag match');
  if (matches.titleHits > 0) signals.push(`${matches.titleHits} title tokens`);
  if (matches.categorySignal) signals.push(skill.category);
  if (skill.downloads > 0) signals.push(`${skill.downloads} installs`);
  return signals.slice(0, 5);
}

function categorySkillIntel(category: string): { reason: string; recommended: string; nextStep: string; used: string; usedNextStep: string } {
  if (category === 'Веб и интерфейсы') {
    return {
      reason: 'В логах есть UI/frontend/mobile/browser задачи. Skill может стать контрольным шагом перед релизом интерфейса: проверка responsive layout, readable text, hover/focus и screenshot evidence.',
      recommended: 'Ожидаемый выигрыш: меньше визуальных регрессий и меньше ручной проверки после каждого UI pass.',
      nextStep: 'Используйте skill как visual QA checklist перед build/deploy и сохраняйте desktop/mobile screenshots.',
      used: 'Ваш профиль уже содержит UI-сигналы, значит этот skill полезен как постоянный quality gate для визуальных изменений.',
      usedNextStep: 'Держите его рядом с Playwright evidence и прогоняйте после каждого frontend patch.',
    };
  }
  if (category === 'Инфраструктура и деплой') {
    return {
      reason: 'В логах заметны deploy/health/container/endpoint операции. Skill поможет стандартизировать release checks: build, container restart, health URLs, rollback заметки.',
      recommended: 'Ожидаемый выигрыш: меньше “полураскатанных” релизов и быстрее диагностика, если endpoint отвечает не тем build.',
      nextStep: 'Применяйте skill перед restart/deploy и фиксируйте release tag + health evidence.',
      used: 'Инфраструктурные сигналы уже есть в логах, поэтому этот skill стоит считать частью deploy pipeline.',
      usedNextStep: 'Привяжите его к чеклисту: build -> restart only target container -> health -> screenshots.',
    };
  }
  if (category === 'Безопасность и аудит') {
    return {
      reason: 'В логах встречаются error/auth/key/token/security сигналы. Skill нужен как короткий risk pass: не печатать секреты, проверить scope, sanitizer и доверительные границы.',
      recommended: 'Ожидаемый выигрыш: меньше утечек в UI/debug и меньше опасных операций при работе с API keys.',
      nextStep: 'Запускайте перед публикацией trace/debug экранов и перед изменениями auth/profile views.',
      used: 'Профиль уже содержит security/auth-сигналы; этот skill полезен как guardrail для личного кабинета и логов.',
      usedNextStep: 'Проверяйте raw JSON/debug panels и redaction после каждого изменения log detail.',
    };
  }
  if (category === 'Исследования и анализ') {
    return {
      reason: 'В запросах видны analyze/research/compare/source задачи. Skill поможет делать выводы из логов доказательно: гипотеза, источники, confidence, next probe.',
      recommended: 'Ожидаемый выигрыш: рекомендации в кабинете станут менее generic и будут опираться на реальные patterns.',
      nextStep: 'Используйте skill для разборов “почему cost/latency выросли” или “какие модели работают лучше”.',
      used: 'Аналитические сигналы уже есть; skill подходит для регулярных разборов сессий и leaderboard patterns.',
      usedNextStep: 'Фиксируйте выводы рядом с sessions/trace evidence, а не в отдельной заметке без привязки к логам.',
    };
  }
  if (category === 'Документы и офис') {
    return {
      reason: 'В логах есть report/table/csv/deck/pdf/docx паттерны. Skill поможет превратить agent output в проверяемые deliverables с форматированием и evidence.',
      recommended: 'Ожидаемый выигрыш: меньше ручного доведения отчетов и таблиц после LLM calls.',
      nextStep: 'Подключайте skill, когда trace показывает длинные document/report generation сессии.',
      used: 'Документные сигналы уже встречаются; skill можно использовать как delivery layer для отчетов и таблиц.',
      usedNextStep: 'Добавьте проверку экспортов/preview как обязательный финальный шаг.',
    };
  }
  if (category === 'Агенты и workflow') {
    return {
      reason: 'В логах есть agent/tool/workflow/trace/session сигналы. Skill поможет разложить сессии на роли, шаги, проверки и handoff без потери контекста.',
      recommended: 'Ожидаемый выигрыш: понятнее agent traces, меньше повторных manual prompts и лучше воспроизводимость сложных задач.',
      nextStep: 'Используйте skill для длинных сессий: goal -> tools -> LLM calls -> errors -> final evidence.',
      used: 'Профиль уже явно agent/workflow-heavy; skill стоит использовать как стандартную карту execution flow.',
      usedNextStep: 'Свяжите skill с trace replay: каждый крупный запрос должен иметь понятные steps и финальное доказательство.',
    };
  }
  if (category === 'Интеграции и API') {
    return {
      reason: 'В логах есть API/provider/route/database/webhook сигналы. Skill поможет описывать контракт, параметры вызова, fallback и compatibility risks.',
      recommended: 'Ожидаемый выигрыш: меньше ошибок при смене provider/model aliases и меньше ручной отладки клиентов.',
      nextStep: 'Применяйте skill перед добавлением endpoints, SDK hints или provider routing copy.',
      used: 'Интеграционные сигналы уже есть; skill полезен для контрактов API, моделей и provider маршрутов.',
      usedNextStep: 'Проверяйте backward compatibility и показывайте пользователю точные base URL/model параметры.',
    };
  }
  return {
    reason: `Skill совпадает с направлением "${category}" в логах и может закрыть повторяющиеся операции.`,
    recommended: 'Ожидаемый выигрыш: меньше ручных повторов и понятнее следующий шаг после похожих запросов.',
    nextStep: 'Попробуйте skill на следующей похожей сессии и сравните trace/cost/result.',
    used: 'Skill уже связан с текущим профилем пользователя по логам.',
    usedNextStep: 'Оставьте его как быстрый workflow для повторяющихся задач.',
  };
}

function summarizePayload(value: unknown): string {
  if (value == null) return '';
  try {
    const raw = typeof value === 'string' ? value : JSON.stringify(value);
    const text = raw
      .replace(/\s+/g, ' ')
      .replace(/[{}[\]"]/g, '')
      .trim();
    if (!text) return '';
    return text.length > 220 ? `${text.slice(0, 220)}...` : text;
  } catch {
    return '';
  }
}

function formatUsd(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
