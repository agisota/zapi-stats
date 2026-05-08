import { useMemo, useState } from 'react';
import type React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BrainCircuit, CalendarDays, Coins, Download, Heart, MousePointerClick, Route, UserRound, Users, Zap } from 'lucide-react';
import { getGlobalSkillAnalytics, getGlobalUserExpenses, type SkillAnalyticsBreakdownItem, type SkillAnalyticsUserSkills, type UserCostSlice } from '../../lib/api.ts';
import { formatCost, formatNumber } from '../../lib/format.ts';
import { SkeletonBlock, StatePanel } from '../ui/feedback.tsx';

const COLORS = ['#22d3ee', '#f97316', '#c4b5fd', '#14b8a6', '#a855f7', '#ec4899', '#22c55e', '#f59e0b'];
const PERIODS = [
  { label: '7D', value: '7d', caption: 'короткий всплеск' },
  { label: '30D', value: '30d', caption: 'операционный месяц' },
  { label: '90D', value: '90d', caption: 'устойчивый тренд' },
] as const;
type Period = (typeof PERIODS)[number]['value'];

export function UsageAnalytics() {
  const [period, setPeriod] = useState<Period>('30d');
  const skills = useQuery({ queryKey: ['global-skill-analytics', period], queryFn: () => getGlobalSkillAnalytics(period) });
  const expenses = useQuery({ queryKey: ['global-user-expenses', period], queryFn: () => getGlobalUserExpenses(period) });
  const periodCaption = PERIODS.find(item => item.value === period)?.caption ?? '';

  const skillSeries = useMemo(() => {
    const top = (skills.data?.data.topSkills ?? []).slice(0, 7).map((item, index) => ({ ...item, key: `skill${index}` }));
    const rows = (skills.data?.data.daily ?? []).map(day => {
      const row: Record<string, string | number> = { date: formatShortDate(day.date), total: day.total };
      for (const item of top) {
        row[item.key] = day.skills.find(skill => skill.skillId === item.skillId)?.count ?? 0;
      }
      return row;
    });
    return { top, rows };
  }, [skills.data]);

  const expenseSeries = useMemo(() => {
    const top = (expenses.data?.data.topUsers ?? []).slice(0, 7).map((item, index) => ({ ...item, key: `user${index}` }));
    const rows = (expenses.data?.data.daily ?? []).map(day => {
      const row: Record<string, string | number> = { date: formatShortDate(day.date), total: day.totalCost };
      for (const item of top) {
        row[item.key] = day.users.find(user => user.displayName === item.displayName && user.apiKeyName === item.apiKeyName)?.cost ?? 0;
      }
      return row;
    });
    return { top, rows };
  }, [expenses.data]);

  return (
    <section id="analytics" className="scroll-mt-28 space-y-5">
      <div className="surface-card rounded-2xl border p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-cyan-200">
              <CalendarDays className="h-4 w-4" />
              <span className="text-xs uppercase text-cyan-200/70">Usage analytics</span>
            </div>
            <h2 className="mt-2 text-2xl font-semibold text-white">Skills и расходы по пользователям</h2>
            <div className="mt-1 text-sm text-gray-500">{periodCaption}; явные активации из кабинета объединены с inferred usage из логов gateway.</div>
          </div>
          <PeriodPicker value={period} onChange={setPeriod} />
        </div>
      </div>

      {(skills.isLoading || expenses.isLoading) && (
        <div className="grid gap-4 xl:grid-cols-2">
          <SkeletonBlock className="h-[24rem]" />
          <SkeletonBlock className="h-[24rem]" />
        </div>
      )}

      {(skills.isError || expenses.isError) && (
        <StatePanel state="partial" title="Аналитика skills/cost загружена частично">
          Новые `/api/stats/skills/analytics` или `/api/stats/expenses/users` сейчас не ответили; базовый рейтинг остаётся независимым.
        </StatePanel>
      )}

      {!skills.isLoading && !expenses.isLoading && !skills.isError && !expenses.isError && (
        <div className="grid gap-5 xl:grid-cols-2">
          <div className="surface-card rounded-2xl border p-5">
            <PanelHeader
              icon={<BrainCircuit className="h-4 w-4 text-cyan-200" />}
              eyebrow="Daily skill invocations"
              title="Навыки"
              metric={formatNumber(skills.data?.data.totalInvocations ?? 0)}
              caption={`${formatNumber(skills.data?.data.explicitActivations ?? 0)} явных активаций, ${formatNumber(skills.data?.data.inferredInvocations ?? 0)} из логов`}
            />
            <div className="mt-5 h-72">
              {skillSeries.rows.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={skillSeries.rows} barCategoryGap={10}>
                    <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#05070d', border: '1px solid #273244', borderRadius: 8 }}
                      labelStyle={{ color: '#f8fafc' }}
                    />
                    {skillSeries.top.map((skill, index) => (
                      <Bar key={skill.key} dataKey={skill.key} name={skill.skillSlug} stackId="skills" fill={COLORS[index % COLORS.length]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <Empty text="Skill invocations появятся после первых logged calls или активаций из каталога." />
              )}
            </div>
            <BreakdownChips title="Действия" items={skills.data?.data.actionBreakdown ?? []} iconFor={actionIcon} />
            <TopList
              title="Топ skills"
              items={(skills.data?.data.topSkills ?? []).slice(0, 6).map(item => ({
                label: item.skillSlug,
                value: formatNumber(item.count),
                detail: `${formatNumber(item.explicit)} direct / ${formatNumber(item.inferred)} inferred`,
              }))}
            />
            <UserSkillMatrix items={skills.data?.data.userSkillMatrix ?? []} />
          </div>

          <div className="surface-card rounded-2xl border p-5">
            <PanelHeader
              icon={<Coins className="h-4 w-4 text-amber-200" />}
              eyebrow="User cost distribution"
              title="Расходы по пользователям"
              metric={formatCost(expenses.data?.data.totalCost ?? 0)}
              caption={`${formatNumber(expenses.data?.data.totalRequests ?? 0)} запросов, ${formatNumber(expenses.data?.data.activeUsers ?? 0)} users`}
            />
            <div className="mt-5 h-72">
              {expenseSeries.rows.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={expenseSeries.rows} barCategoryGap={10}>
                    <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} tickFormatter={value => `$${Number(value).toFixed(0)}`} />
                    <Tooltip
                      formatter={value => formatCost(Number(value))}
                      contentStyle={{ backgroundColor: '#05070d', border: '1px solid #273244', borderRadius: 8 }}
                      labelStyle={{ color: '#f8fafc' }}
                    />
                    {expenseSeries.top.map((user, index) => (
                      <Bar key={user.key} dataKey={user.key} name={user.displayName} stackId="users" fill={COLORS[index % COLORS.length]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <Empty text="Расходы появятся после первых строк в usage_history за выбранный период." />
              )}
            </div>
            <TopList
              title="Топ расходов"
              items={(expenses.data?.data.topUsers ?? []).slice(0, 6).map(item => ({
                label: item.displayName,
                value: formatCost(item.cost),
                detail: `${formatNumber(item.requests)} запросов / ${formatNumber(item.tokensIn + item.tokensOut)} tokens`,
              }))}
            />
            <ExpenseUserTable items={expenses.data?.data.topUsers ?? []} />
          </div>
        </div>
      )}
    </section>
  );
}

function PeriodPicker({ value, onChange }: { value: Period; onChange: (period: Period) => void }) {
  return (
    <div className="inline-flex rounded-xl border border-white/10 bg-black/18 p-1">
      {PERIODS.map(period => (
        <button
          key={period.value}
          type="button"
          onClick={() => onChange(period.value)}
          className={`h-9 rounded-lg px-3 text-xs font-semibold transition-colors ${
            value === period.value ? 'bg-cyan-300/16 text-cyan-100' : 'text-gray-500 hover:bg-white/5 hover:text-gray-200'
          }`}
          aria-pressed={value === period.value}
        >
          {period.label}
        </button>
      ))}
    </div>
  );
}

function PanelHeader({
  icon,
  eyebrow,
  title,
  metric,
  caption,
}: {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  metric: string;
  caption: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="flex items-center gap-2 text-cyan-200">
          {icon}
          <span className="text-xs uppercase text-cyan-200/70">{eyebrow}</span>
        </div>
        <h2 className="mt-2 text-xl font-semibold text-white">{title}</h2>
      </div>
      <div className="text-right">
        <div className="font-mono text-2xl font-semibold text-white">{metric}</div>
        <div className="mt-1 max-w-52 text-xs leading-5 text-gray-500">{caption}</div>
      </div>
    </div>
  );
}

function BreakdownChips({ title, items, iconFor }: { title: string; items: SkillAnalyticsBreakdownItem[]; iconFor: (label: string) => React.ReactNode }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-5 rounded-xl border border-white/10 bg-black/12 p-3">
      <div className="mb-2 text-xs font-semibold uppercase text-gray-500">{title}</div>
      <div className="flex flex-wrap gap-2">
        {items.slice(0, 6).map(item => (
          <div key={item.label} className="inline-flex items-center gap-2 rounded-full border border-cyan-300/14 bg-cyan-300/8 px-3 py-1.5 text-xs text-cyan-50">
            {iconFor(item.label)}
            <span>{actionLabel(item.label)}</span>
            <span className="font-mono text-cyan-100">{formatNumber(item.count)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TopList({ title, items }: { title: string; items: Array<{ label: string; value: string; detail: string }> }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-5 rounded-xl border border-white/10 bg-[#07111f]/70 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-gray-500">
        <Users className="h-3.5 w-3.5" />
        {title}
      </div>
      <div className="grid gap-2">
        {items.map(item => (
          <div key={`${item.label}-${item.value}`} className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/10 px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-white">{item.label}</div>
              <div className="mt-0.5 text-[11px] text-gray-500">{item.detail}</div>
            </div>
            <div className="font-mono text-sm text-cyan-100">{item.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function UserSkillMatrix({ items }: { items: SkillAnalyticsUserSkills[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-5 overflow-hidden rounded-xl border border-white/10 bg-black/12">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2 text-xs font-semibold uppercase text-gray-500">
        <UserRound className="h-3.5 w-3.5" />
        Users x skills
      </div>
      <div className="divide-y divide-white/10">
        {items.slice(0, 8).map(item => (
          <div key={`${item.userId ?? item.displayName}-${item.total}`} className="grid gap-3 px-3 py-3 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.5fr)_auto] md:items-center">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-white">{item.displayName}</div>
              <div className="mt-0.5 text-[11px] text-gray-500">{formatNumber(item.explicit)} direct / {formatNumber(item.inferred)} inferred</div>
            </div>
            <div className="flex min-w-0 flex-wrap gap-1.5">
              {item.topSkills.slice(0, 4).map(skill => (
                <span key={skill.skillId} className="max-w-full truncate rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-gray-300">
                  {skill.skillSlug}: <span className="font-mono text-cyan-100">{formatNumber(skill.count)}</span>
                </span>
              ))}
            </div>
            <div className="font-mono text-sm text-cyan-100">{formatNumber(item.total)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ExpenseUserTable({ items }: { items: UserCostSlice[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-5 overflow-hidden rounded-xl border border-white/10 bg-black/12">
      <div className="grid grid-cols-[minmax(0,1fr)_7rem_7rem] gap-3 border-b border-white/10 px-3 py-2 text-xs font-semibold uppercase text-gray-500">
        <span>User</span>
        <span className="text-right">Requests</span>
        <span className="text-right">Cost</span>
      </div>
      <div className="divide-y divide-white/10">
        {items.slice(0, 8).map(item => (
          <div key={`${item.displayName}-${item.apiKeyName}`} className="grid grid-cols-[minmax(0,1fr)_7rem_7rem] gap-3 px-3 py-3 text-sm">
            <div className="min-w-0">
              <div className="truncate font-medium text-white">{item.displayName}</div>
              <div className="truncate text-[11px] text-gray-500">{item.apiKeyName}</div>
            </div>
            <div className="self-center text-right font-mono text-gray-300">{formatNumber(item.requests)}</div>
            <div className="self-center text-right font-mono text-amber-100">{formatCost(item.cost)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="grid h-full place-items-center rounded-xl border border-dashed border-white/10 bg-black/10 p-6 text-center text-sm leading-6 text-gray-500">
      <div>
        <Zap className="mx-auto mb-3 h-5 w-5 text-cyan-200/50" />
        {text}
      </div>
    </div>
  );
}

function actionIcon(label: string) {
  if (label === 'download') return <Download className="h-3.5 w-3.5" />;
  if (label === 'like') return <Heart className="h-3.5 w-3.5" />;
  if (label.includes('catalog')) return <Route className="h-3.5 w-3.5" />;
  return <MousePointerClick className="h-3.5 w-3.5" />;
}

function actionLabel(label: string): string {
  if (label === 'download') return 'downloads';
  if (label === 'like') return 'likes';
  if (label === 'activate') return 'activations';
  return label;
}

function formatShortDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
}
