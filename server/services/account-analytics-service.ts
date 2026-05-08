import type { Database } from 'bun:sqlite';
import { calculateCost } from './pricing.ts';
import { getDisplayName } from './display-names.ts';
import { getSkillsCatalog, type SkillItemWithCategory } from './skills-catalog.ts';
import { AccountError, id } from './account-service.ts';

export type SkillEventAction = 'activate' | 'download' | 'like';

export interface SkillEventRecord {
  id: string;
  userId: string;
  displayName: string;
  skillId: string;
  skillSlug: string;
  action: SkillEventAction;
  source: string;
  createdAt: string;
}

export interface SkillAnalyticsItem {
  skillId: string;
  skillSlug: string;
  count: number;
  explicit: number;
  inferred: number;
}

export interface SkillAnalyticsUser {
  userId: string | null;
  displayName: string;
  count: number;
}

export interface SkillAnalyticsDay {
  date: string;
  total: number;
  skills: SkillAnalyticsItem[];
  users: SkillAnalyticsUser[];
}

export interface SkillAnalytics {
  totalInvocations: number;
  explicitActivations: number;
  inferredInvocations: number;
  activeUsers: number;
  topSkills: SkillAnalyticsItem[];
  topUsers: SkillAnalyticsUser[];
  daily: SkillAnalyticsDay[];
  recent: SkillEventRecord[];
}

export interface UserCostSlice {
  userId: string | null;
  displayName: string;
  apiKeyName: string;
  cost: number;
  requests: number;
  tokensIn: number;
  tokensOut: number;
}

export interface ExpenseDay {
  date: string;
  totalCost: number;
  totalRequests: number;
  users: UserCostSlice[];
}

export interface ExpenseAnalytics {
  totalCost: number;
  totalRequests: number;
  activeUsers: number;
  topUsers: UserCostSlice[];
  daily: ExpenseDay[];
}

interface Owner {
  userId: string | null;
  displayName: string;
  apiKeyName: string;
}

interface EventRow {
  id: string;
  user_id: string;
  display_name: string;
  skill_id: string;
  skill_slug: string;
  action: string;
  source: string;
  created_at: string;
}

interface SkillLogRow {
  timestamp: string;
  apiKeyName: string | null;
  model: string | null;
  provider: string | null;
  path: string | null;
  requestSummary: string | null;
  errorSummary: string | null;
}

export class AccountAnalyticsService {
  private skills = getSkillsCatalog();
  private callLogColumns: Set<string>;

  constructor(private usageDb: Database, private accountDb: Database) {
    this.callLogColumns = this.tableExists('call_logs')
      ? new Set((this.usageDb.prepare('PRAGMA table_info(call_logs)').all() as Array<{ name: string }>).map(c => c.name))
      : new Set();
  }

  recordSkillEvent(input: {
    userId: string;
    skillId: string;
    action?: SkillEventAction;
    source?: string;
    accountKeyId?: string | null;
    metadata?: unknown;
  }): SkillEventRecord {
    const skill = this.skills.find(item => item.id === input.skillId || item.slug === input.skillId);
    if (!skill) throw new AccountError('SKILL_NOT_FOUND', 'Skill not found', 404);
    const user = this.accountDb.prepare('SELECT display_name FROM users WHERE id = ?').get(input.userId) as { display_name: string } | null;
    if (!user) throw new AccountError('ACCOUNT_NOT_FOUND', 'Account not found', 404);

    const now = new Date().toISOString();
    const event: SkillEventRecord = {
      id: id('sev'),
      userId: input.userId,
      displayName: user.display_name,
      skillId: skill.id,
      skillSlug: skill.slug,
      action: input.action ?? 'activate',
      source: cleanSource(input.source),
      createdAt: now,
    };

    this.accountDb.prepare(`
      INSERT INTO skill_events
      (id, user_id, account_key_id, skill_id, skill_slug, action, source, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.userId,
      input.accountKeyId ?? null,
      event.skillId,
      event.skillSlug,
      event.action,
      event.source,
      JSON.stringify(input.metadata ?? {}),
      event.createdAt,
    );

    return event;
  }

  getGlobalSkillAnalytics(days = 30): SkillAnalytics {
    return this.buildSkillAnalytics({ days });
  }

  getUserSkillAnalytics(userId: string, days = 30): SkillAnalytics {
    return this.buildSkillAnalytics({ days, userId, gatewayNames: this.gatewayNamesForUser(userId) });
  }

  getGlobalExpenseAnalytics(days = 30): ExpenseAnalytics {
    return this.buildExpenseAnalytics({ days });
  }

  getUserExpenseAnalytics(userId: string, days = 30): ExpenseAnalytics {
    return this.buildExpenseAnalytics({ days, gatewayNames: this.gatewayNamesForUser(userId) });
  }

  private buildSkillAnalytics(input: { days: number; userId?: string; gatewayNames?: string[] }): SkillAnalytics {
    const since = sinceIso(input.days);
    const owners = this.ownersByGatewayName();
    const topSkills = new Map<string, SkillAnalyticsItem>();
    const topUsers = new Map<string, SkillAnalyticsUser>();
    const daily = new Map<string, { date: string; total: number; skills: Map<string, SkillAnalyticsItem>; users: Map<string, SkillAnalyticsUser> }>();
    let explicitActivations = 0;
    let inferredInvocations = 0;

    const add = (date: string, skillId: string, skillSlug: string, owner: Owner, kind: 'explicit' | 'inferred') => {
      const userKey = owner.userId ?? `legacy:${owner.apiKeyName}`;
      const dailyRow = daily.get(date) ?? { date, total: 0, skills: new Map(), users: new Map() };
      dailyRow.total += 1;
      daily.set(date, dailyRow);

      const daySkill = dailyRow.skills.get(skillId) ?? { skillId, skillSlug, count: 0, explicit: 0, inferred: 0 };
      daySkill.count += 1;
      daySkill[kind] += 1;
      dailyRow.skills.set(skillId, daySkill);

      const dayUser = dailyRow.users.get(userKey) ?? { userId: owner.userId, displayName: owner.displayName, count: 0 };
      dayUser.count += 1;
      dailyRow.users.set(userKey, dayUser);

      const aggregateSkill = topSkills.get(skillId) ?? { skillId, skillSlug, count: 0, explicit: 0, inferred: 0 };
      aggregateSkill.count += 1;
      aggregateSkill[kind] += 1;
      topSkills.set(skillId, aggregateSkill);

      const aggregateUser = topUsers.get(userKey) ?? { userId: owner.userId, displayName: owner.displayName, count: 0 };
      aggregateUser.count += 1;
      topUsers.set(userKey, aggregateUser);

      if (kind === 'explicit') explicitActivations += 1;
      else inferredInvocations += 1;
    };

    for (const event of this.skillEventsSince(since, input.userId)) {
      add(event.created_at.slice(0, 10), event.skill_id, event.skill_slug, {
        userId: event.user_id,
        displayName: event.display_name,
        apiKeyName: event.user_id,
      }, 'explicit');
    }

    for (const row of this.skillLogRowsSince(since, input.gatewayNames)) {
      const text = `${row.model ?? ''} ${row.provider ?? ''} ${row.path ?? ''} ${row.requestSummary ?? ''} ${row.errorSummary ?? ''}`;
      const matches = matchSkills(this.skills, text).slice(0, 4);
      if (matches.length === 0) continue;
      const apiKeyName = row.apiKeyName ?? 'unknown';
      const owner = owners.get(apiKeyName) ?? {
        userId: null,
        displayName: getDisplayName(apiKeyName),
        apiKeyName,
      };
      const date = row.timestamp.slice(0, 10);
      for (const skill of matches) add(date, skill.id, skill.slug, owner, 'inferred');
    }

    const recent = this.skillEventsSince(since, input.userId)
      .slice(0, 25)
      .map(row => ({
        id: row.id,
        userId: row.user_id,
        displayName: row.display_name,
        skillId: row.skill_id,
        skillSlug: row.skill_slug,
        action: normalizeAction(row.action),
        source: row.source,
        createdAt: row.created_at,
      }));

    return {
      totalInvocations: explicitActivations + inferredInvocations,
      explicitActivations,
      inferredInvocations,
      activeUsers: topUsers.size,
      topSkills: sortedValues(topSkills),
      topUsers: [...topUsers.values()].sort((a, b) => b.count - a.count || a.displayName.localeCompare(b.displayName, 'ru')),
      daily: [...daily.values()]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map(row => ({
          date: row.date,
          total: row.total,
          skills: sortedValues(row.skills),
          users: [...row.users.values()].sort((a, b) => b.count - a.count),
        })),
      recent,
    };
  }

  private buildExpenseAnalytics(input: { days: number; gatewayNames?: string[] }): ExpenseAnalytics {
    const owners = this.ownersByGatewayName();
    const rows = this.expenseRowsSince(sinceIso(input.days), input.gatewayNames);
    const daily = new Map<string, { date: string; totalCost: number; totalRequests: number; users: Map<string, UserCostSlice> }>();
    const topUsers = new Map<string, UserCostSlice>();

    for (const row of rows) {
      const apiKeyName = row.apiKeyName ?? 'unknown';
      const owner = owners.get(apiKeyName) ?? {
        userId: null,
        displayName: getDisplayName(apiKeyName),
        apiKeyName,
      };
      const userKey = owner.userId ?? `legacy:${apiKeyName}`;
      const cost = calculateCost(row.model ?? 'unknown', row.tokensIn ?? 0, row.tokensOut ?? 0);

      const day = daily.get(row.date) ?? { date: row.date, totalCost: 0, totalRequests: 0, users: new Map() };
      day.totalCost += cost;
      day.totalRequests += row.requests;
      daily.set(row.date, day);

      const dayUser = day.users.get(userKey) ?? {
        userId: owner.userId,
        displayName: owner.displayName,
        apiKeyName,
        cost: 0,
        requests: 0,
        tokensIn: 0,
        tokensOut: 0,
      };
      dayUser.cost += cost;
      dayUser.requests += row.requests;
      dayUser.tokensIn += row.tokensIn ?? 0;
      dayUser.tokensOut += row.tokensOut ?? 0;
      day.users.set(userKey, dayUser);

      const aggregate = topUsers.get(userKey) ?? {
        userId: owner.userId,
        displayName: owner.displayName,
        apiKeyName,
        cost: 0,
        requests: 0,
        tokensIn: 0,
        tokensOut: 0,
      };
      aggregate.cost += cost;
      aggregate.requests += row.requests;
      aggregate.tokensIn += row.tokensIn ?? 0;
      aggregate.tokensOut += row.tokensOut ?? 0;
      topUsers.set(userKey, aggregate);
    }

    const top = [...topUsers.values()].sort((a, b) => b.cost - a.cost || b.requests - a.requests);
    return {
      totalCost: top.reduce((sum, user) => sum + user.cost, 0),
      totalRequests: top.reduce((sum, user) => sum + user.requests, 0),
      activeUsers: topUsers.size,
      topUsers: top,
      daily: [...daily.values()]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map(day => ({
          date: day.date,
          totalCost: day.totalCost,
          totalRequests: day.totalRequests,
          users: [...day.users.values()].sort((a, b) => b.cost - a.cost),
        })),
    };
  }

  private skillEventsSince(since: string, userId?: string): EventRow[] {
    const where = userId ? 'WHERE e.created_at >= ? AND e.user_id = ?' : 'WHERE e.created_at >= ?';
    const params = userId ? [since, userId] : [since];
    return this.accountDb.prepare(`
      SELECT e.id, e.user_id, u.display_name, e.skill_id, e.skill_slug, e.action, e.source, e.created_at
      FROM skill_events e
      JOIN users u ON u.id = e.user_id
      ${where}
      ORDER BY e.created_at DESC
    `).all(...params) as EventRow[];
  }

  private skillLogRowsSince(since: string, gatewayNames?: string[]): SkillLogRow[] {
    if (!this.tableExists('call_logs')) return [];
    if (gatewayNames && gatewayNames.length === 0) return [];
    const params: string[] = [since];
    const nameFilter = this.inFilter('api_key_name', gatewayNames, params);
    const sql = `
      SELECT
        timestamp,
        ${this.callCol('api_key_name')} as apiKeyName,
        ${this.callCol('model')} as model,
        ${this.callCol('provider')} as provider,
        ${this.callCol('path')} as path,
        ${this.callCol('request_summary')} as requestSummary,
        ${this.callCol('error_summary', this.callCol('error'))} as errorSummary
      FROM call_logs
      WHERE timestamp >= ?${nameFilter}
      ORDER BY timestamp DESC
      LIMIT 20000
    `;
    return this.usageDb.prepare(sql).all(...params) as SkillLogRow[];
  }

  private expenseRowsSince(since: string, gatewayNames?: string[]): Array<{ date: string; apiKeyName: string | null; model: string | null; requests: number; tokensIn: number; tokensOut: number }> {
    if (gatewayNames && gatewayNames.length === 0) return [];
    const params: string[] = [since];
    const nameFilter = this.inFilter('api_key_name', gatewayNames, params);
    return this.usageDb.prepare(`
      SELECT
        substr(timestamp, 1, 10) as date,
        api_key_name as apiKeyName,
        model,
        COUNT(*) as requests,
        SUM(COALESCE(tokens_input, 0)) as tokensIn,
        SUM(COALESCE(tokens_output, 0)) as tokensOut
      FROM usage_history
      WHERE timestamp >= ? AND api_key_name IS NOT NULL AND api_key_name != ''${nameFilter}
      GROUP BY date, api_key_name, model
      ORDER BY date ASC
    `).all(...params) as Array<{ date: string; apiKeyName: string | null; model: string | null; requests: number; tokensIn: number; tokensOut: number }>;
  }

  private gatewayNamesForUser(userId: string): string[] {
    return (this.accountDb.prepare('SELECT gateway_name FROM account_keys WHERE user_id = ?').all(userId) as Array<{ gateway_name: string }>)
      .map(row => row.gateway_name)
      .filter(Boolean);
  }

  private ownersByGatewayName(): Map<string, Owner> {
    const rows = this.accountDb.prepare(`
      SELECT k.gateway_name, u.id as user_id, u.display_name
      FROM account_keys k
      JOIN users u ON u.id = k.user_id
    `).all() as Array<{ gateway_name: string; user_id: string; display_name: string }>;
    return new Map(rows.map(row => [row.gateway_name, {
      userId: row.user_id,
      displayName: row.display_name,
      apiKeyName: row.gateway_name,
    }]));
  }

  private inFilter(column: string, values: string[] | undefined, params: string[]): string {
    if (!values) return '';
    if (values.length === 0) return ' AND 1 = 0';
    params.push(...values);
    return ` AND ${column} IN (${values.map(() => '?').join(', ')})`;
  }

  private callCol(column: string, fallback = 'NULL'): string {
    return this.callLogColumns.has(column) ? column : fallback;
  }

  private tableExists(name: string): boolean {
    const row = this.usageDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
    return Boolean(row);
  }
}

function sinceIso(days: number): string {
  const safeDays = Math.max(1, Math.min(365, Math.round(days || 30)));
  return new Date(Date.now() - safeDays * 86_400_000).toISOString();
}

function cleanSource(source: string | undefined): string {
  const clean = String(source ?? 'account_console').trim().replace(/[^a-z0-9_.:-]+/gi, '_').slice(0, 80);
  return clean || 'account_console';
}

function normalizeAction(action: string): SkillEventAction {
  return action === 'download' || action === 'like' ? action : 'activate';
}

function sortedValues(map: Map<string, SkillAnalyticsItem>): SkillAnalyticsItem[] {
  return [...map.values()].sort((a, b) => b.count - a.count || a.skillSlug.localeCompare(b.skillSlug, 'ru'));
}

function matchSkills(skills: SkillItemWithCategory[], raw: string): SkillItemWithCategory[] {
  const text = raw.toLowerCase();
  if (!text.trim()) return [];
  return skills
    .map(skill => ({ skill, score: skillScore(skill, text) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || b.skill.downloads - a.skill.downloads)
    .map(item => item.skill);
}

function skillScore(skill: SkillItemWithCategory, text: string): number {
  const slug = skill.slug.toLowerCase();
  let score = 0;
  if (text.includes(slug)) score += 10;
  if (text.includes(slug.replaceAll('-', ' '))) score += 8;
  for (const tag of skill.tags) {
    const clean = tag.toLowerCase().trim();
    if (clean.length >= 4 && text.includes(clean)) score += 3;
  }
  const tokens = skill.title.toLowerCase().split(/[^a-zа-я0-9]+/i).filter(token => token.length >= 5);
  const hits = tokens.filter(token => text.includes(token)).length;
  if (hits >= 2) score += hits;
  return score;
}
