import { useMemo } from 'react';
import type React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BrainCircuit, Coins, Users, Zap } from 'lucide-react';
import { getGlobalSkillAnalytics, getGlobalUserExpenses } from '../../lib/api.ts';
import { formatCost, formatNumber } from '../../lib/format.ts';
import { SkeletonBlock, StatePanel } from '../ui/feedback.tsx';

const COLORS = ['#3b82f6', '#f97316', '#c4b5fd', '#06b6d4', '#a855f7', '#ec4899', '#22c55e', '#f59e0b'];

export function UsageAnalytics() {
  const skills = useQuery({ queryKey: ['global-skill-analytics', '30d'], queryFn: () => getGlobalSkillAnalytics('30d') });
  const expenses = useQuery({ queryKey: ['global-user-expenses', '30d'], queryFn: () => getGlobalUserExpenses('30d') });

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

  if (skills.isLoading || expenses.isLoading) {
    return (
      <section id="analytics" className="grid gap-4 xl:grid-cols-2 scroll-mt-28">
        <SkeletonBlock className="h-[24rem]" />
        <SkeletonBlock className="h-[24rem]" />
      </section>
    );
  }

  if (skills.isError || expenses.isError) {
    return (
      <section id="analytics" className="scroll-mt-28">
        <StatePanel state="partial" title="Аналитика skills/cost загружена частично">
          Новые `/api/stats/skills/analytics` или `/api/stats/expenses/users` сейчас не ответили; базовый рейтинг остаётся независимым.
        </StatePanel>
      </section>
    );
  }

  return (
    <section id="analytics" className="grid gap-5 xl:grid-cols-2 scroll-mt-28">
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
        <TopList
          title="Топ skills"
          items={(skills.data?.data.topSkills ?? []).slice(0, 6).map(item => ({
            label: item.skillSlug,
            value: formatNumber(item.count),
            detail: `${formatNumber(item.explicit)} direct / ${formatNumber(item.inferred)} inferred`,
          }))}
        />
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
            detail: `${formatNumber(item.requests)} запросов`,
          }))}
        />
      </div>
    </section>
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
          <span className="text-xs uppercase tracking-[0.18em] text-cyan-200/70">{eyebrow}</span>
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

function TopList({ title, items }: { title: string; items: Array<{ label: string; value: string; detail: string }> }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-5 rounded-xl border border-white/10 bg-[#07111f]/70 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">
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

function formatShortDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
}
