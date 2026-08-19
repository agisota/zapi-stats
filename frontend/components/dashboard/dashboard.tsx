import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../lib/auth-context.tsx';
import { AccountConsole } from '../account/account-console.tsx';
import {
  getUserActivity,
  getUserBalance,
  getUserModels,
  getUserSkillsMapping,
  getUserStats,
  type ActivityDay,
  type SkillMappingItem,
  type UserActivityAnalytics,
  type UserBalance,
  type UserSkillsMapping,
} from '../../lib/api.ts';
import { formatNumber, formatCost, formatPercent, formatLatency } from '../../lib/format.ts';
import { displayName, modelLabel } from '../../lib/display.ts';
import { LogExplorer } from './log-explorer.tsx';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Activity, BadgeCheck, BrainCircuit, CalendarDays, Coins, Gauge, Hash, Lightbulb, RefreshCw, Shield, Sparkles, Trophy, WalletCards, Zap } from 'lucide-react';

const COLORS = ['#06b6d4', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444', '#ec4899'];

export function Dashboard() {
  const { apiKey, keyName, accountSession, account } = useAuth();
  const cleanName = displayName(keyName ?? account?.displayName ?? null);

  const { data: stats } = useQuery({
    queryKey: ['user-stats', apiKey],
    queryFn: () => getUserStats(apiKey!),
    enabled: !!apiKey,
  });

  const { data: models } = useQuery({
    queryKey: ['user-models', apiKey],
    queryFn: () => getUserModels(apiKey!),
    enabled: !!apiKey,
  });

  const { data: balance } = useQuery({
    queryKey: ['user-balance', apiKey],
    queryFn: () => getUserBalance(apiKey!),
    enabled: !!apiKey,
  });

  const { data: activity } = useQuery({
    queryKey: ['user-activity', apiKey],
    queryFn: () => getUserActivity(apiKey!),
    enabled: !!apiKey,
  });

  const { data: skillsMapping } = useQuery({
    queryKey: ['user-skills-mapping', apiKey],
    queryFn: () => getUserSkillsMapping(apiKey!),
    enabled: !!apiKey,
  });

  const user = stats?.data;
  const userModels = models?.data ?? [];
  const balanceData = balance?.data;
  const activityData = activity?.data;
  const skillsData = skillsMapping?.data;

  const xp = user ? Math.round(user.requests + user.tokensOut / 10 + user.models.length * 250) : 0;
  const rank = user ? getRank(user.successRate, user.requests, user.models.length) : 'Новичок';
  const topModel = userModels[0] ? modelLabel(userModels[0].provider, userModels[0].model) : 'ожидаем трафик';
  const badges = useMemo(() => buildBadges(user?.requests ?? 0, user?.successRate ?? 0, userModels.length), [user, userModels.length]);

  return (
    <div className="space-y-7 overflow-x-hidden">
      {accountSession && account && <AccountConsole sessionToken={accountSession} account={account} />}

      <section className="surface-card dashboard-hero rounded-2xl border p-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 grid-flow-dense">
          <div className="lg:col-span-7">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center text-white text-2xl font-bold shadow-[0_20px_60px_rgba(6,182,212,0.22)]">
                {cleanName?.[0]?.toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-cyan-200">
                  <Sparkles className="w-4 h-4" />
                  <span className="text-xs uppercase tracking-[0.18em] text-cyan-200/70">Личный кабинет API</span>
                </div>
                <h2 className="mt-1 truncate text-3xl font-semibold text-white">{cleanName}</h2>
                <div className="mt-2 flex flex-wrap gap-2">
                  {badges.map(badge => (
                    <span key={badge} className="inline-flex items-center gap-1.5 rounded-full border border-cyan-300/15 bg-cyan-300/8 px-2.5 py-1 text-xs text-cyan-100">
                      <BadgeCheck className="w-3.5 h-3.5" />
                      {badge}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3">
              <DashCard icon={<Trophy className="w-4 h-4 text-amber-300" />} label="Ранг" value={rank} />
              <DashCard icon={<Zap className="w-4 h-4 text-cyan-300" />} label="Опыт" value={formatNumber(xp)} />
              <DashCard icon={<Shield className="w-4 h-4 text-emerald-300" />} label="Успешность" value={user ? formatPercent(user.successRate) : '...'} />
              <DashCard icon={<Gauge className="w-4 h-4 text-purple-300" />} label="Задержка" value={user ? formatLatency(user.avgLatency) : '...'} />
            </div>
          </div>

          <div className="balance-stack lg:col-span-5">
            <div className="balance-card rounded-2xl border p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-gray-500">Баланс месяца</div>
                  <div className="mt-2 text-2xl font-semibold text-white">
                    {balanceData ? formatCost(balanceData.remaining) : '...'}
                  </div>
                </div>
                <WalletCards className="h-10 w-10 text-cyan-200/60" />
              </div>
              <div className="mt-3 h-2 rounded-full bg-white/7">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-emerald-300 transition-all duration-700"
                  style={{ width: `${balanceData ? Math.max(2, Math.min(100, (1 - balanceData.usagePercent) * 100)) : 16}%` }}
                />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <Mini label="лимит" value={balanceData ? formatCost(balanceData.monthlyLimit) : '$10 000,00'} />
                <Mini label="потрачено" value={balanceData ? formatCost(balanceData.currentSpend) : '...'} />
                <Mini label="модель" value={topModel} />
              </div>

              <div className="mt-5 border-t border-cyan-200/12 pt-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-cyan-200">
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span className="text-xs uppercase tracking-[0.18em] text-cyan-200/70">История refill и списаний</span>
                </div>
                <div className="rounded-full border border-emerald-300/18 bg-emerald-300/10 px-3 py-1 text-xs text-emerald-100">след. {balanceData ? formatDateTime(balanceData.nextRefillAt) : '...'}</div>
              </div>
              <div className="mt-4 space-y-2 max-h-[14rem] overflow-y-auto pr-1 scrollbar-thin">
                {(balanceData?.ledger ?? []).length === 0 && (
                  <p className="text-xs text-gray-600 py-4 text-center">Нет операций за текущий период</p>
                )}
                {(balanceData?.ledger ?? []).map(entry => (
                  <div key={entry.id} className="ledger-entry rounded-xl border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-white">{entry.label}</div>
                        <div className="mt-0.5 text-[11px] text-gray-600">{formatDateTime(entry.timestamp)}</div>
                      </div>
                      <div className={`font-mono text-sm font-semibold ${entry.amount >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                        {entry.amount >= 0 ? '+' : ''}{formatCost(entry.amount)}
                      </div>
                    </div>
                    <div className="mt-1.5 text-[11px] leading-4 text-gray-600 line-clamp-2">{entry.detail}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <CabinetInsights activity={activityData} skills={skillsData} />

      {user && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <DashCard icon={<Zap className="w-4 h-4 text-cyan-400" />} label="Запросы" value={formatNumber(user.requests)} />
          <DashCard icon={<Hash className="w-4 h-4 text-purple-400" />} label="Входные токены" value={formatNumber(user.tokensIn)} />
          <DashCard icon={<Hash className="w-4 h-4 text-blue-400" />} label="Выходные токены" value={formatNumber(user.tokensOut)} />
          <DashCard icon={<Coins className="w-4 h-4 text-amber-400" />} label="Стоимость" value={formatCost(user.cost)} />
          <DashCard icon={<Activity className="w-4 h-4 text-emerald-400" />} label="Успешность" value={formatPercent(user.successRate)} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {userModels.length > 0 && (
          <div className="surface-card border rounded-2xl p-6">
            <h3 className="font-semibold text-white mb-4">Использование моделей</h3>
            <ResponsiveContainer width="100%" height={270}>
              <BarChart data={userModels.slice(0, 10)} layout="vertical">
                <XAxis type="number" stroke="#64748b" fontSize={11} />
                <YAxis type="category" dataKey="model" width={170} stroke="#64748b" fontSize={10} tick={{ fill: '#94a3b8' }} />
                <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }} />
                <Bar dataKey="count" name="Запросы" fill="#06b6d4" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {user?.providers && user.providers.length > 0 && (
          <div className="surface-card border rounded-2xl p-6">
            <h3 className="font-semibold text-white mb-4">Провайдеры</h3>
            <div className="flex items-center gap-6">
              <ResponsiveContainer width="50%" height={220}>
                <PieChart>
                  <Pie data={user.providers} dataKey="count" nameKey="provider" cx="50%" cy="50%" innerRadius={48} outerRadius={86} paddingAngle={2}>
                    {user.providers.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-3 flex-1">
                {user.providers.map((p, i) => (
                  <div key={p.provider} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                      <span className="text-gray-300">{p.provider}</span>
                    </div>
                    <span className="text-gray-500 font-mono">{formatNumber(p.count)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {apiKey && <LogExplorer apiKey={apiKey} />}
    </div>
  );
}

function CabinetInsights({
  activity,
  skills,
}: {
  activity?: UserActivityAnalytics;
  skills?: UserSkillsMapping;
}) {
  return (
    <section className="grid grid-cols-1 xl:grid-cols-12 gap-5">
      <ActivityPanel activity={activity} />
      <SkillsMappingPanel skills={skills} />
    </section>
  );
}

function ActivityPanel({ activity }: { activity?: UserActivityAnalytics }) {
  const heatmapDays = useMemo(() => buildHeatmapDays(activity?.days ?? []), [activity]);
  const maxRequests = Math.max(1, ...heatmapDays.map(day => day.requests));
  const recommendations = activity?.recommendations ?? [];

  return (
    <div className="xl:col-span-7 surface-card rounded-2xl border p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-cyan-200">
            <CalendarDays className="h-4 w-4" />
            <span className="text-xs uppercase tracking-[0.18em] text-cyan-200/70">Activity heatmap</span>
          </div>
          <h3 className="mt-2 text-lg font-semibold text-white">Дни, сессии и рекомендации</h3>
        </div>
        <div className="text-xs text-gray-500">{formatNumber(activity?.days.length ?? 0)} активных дней</div>
      </div>

      <div className="mt-5 heatmap-grid" aria-label="Календарная активность API key">
        {heatmapDays.map(day => (
          <div
            key={day.date}
            className="heatmap-cell"
            style={{ '--heat': Math.max(0.06, day.requests / maxRequests).toString() } as React.CSSProperties}
            title={`${day.date}: ${formatNumber(day.requests)} запросов, ${formatNumber(day.sessions)} сессий, ${formatCost(day.cost)}`}
          >
            <span className="heatmap-tooltip">
              <strong>{day.date}</strong>
              <span>{formatNumber(day.requests)} запросов</span>
              <span>{formatNumber(day.sessions)} сессий</span>
              <span>{formatCost(day.cost)} cost</span>
              <span>{day.firstSeen && day.lastSeen ? `${formatTime(day.firstSeen)} - ${formatTime(day.lastSeen)}` : 'нет окна'}</span>
            </span>
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-3">
        {recommendations.slice(0, 3).map(item => (
          <div key={item.id} className={`rounded-xl border p-3 ${item.severity === 'critical' ? 'border-rose-300/20 bg-rose-300/8' : item.severity === 'attention' ? 'border-amber-300/20 bg-amber-300/8' : 'border-cyan-300/16 bg-cyan-300/7'}`}>
            <div className="flex items-start gap-3">
              <Lightbulb className="mt-0.5 h-4 w-4 text-cyan-200" />
              <div>
                <div className="text-sm font-semibold text-white">{item.title}</div>
                <div className="mt-1 text-xs leading-5 text-gray-400">{item.body}</div>
                <div className="mt-2 text-xs text-cyan-100">{item.action}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SkillsMappingPanel({ skills }: { skills?: UserSkillsMapping }) {
  const used = (skills?.items ?? []).filter(item => item.status === 'used').slice(0, 4);
  const recommended = (skills?.items ?? []).filter(item => item.status === 'recommended').slice(0, 5);
  const unused = (skills?.items ?? []).filter(item => item.status === 'unused').slice(0, 3);

  return (
    <div className="xl:col-span-5 surface-card rounded-2xl border p-5">
      <div className="flex items-center gap-2 text-cyan-200">
        <BrainCircuit className="h-4 w-4" />
        <span className="text-xs uppercase tracking-[0.18em] text-cyan-200/70">Skills mapping</span>
      </div>
      <h3 className="mt-2 text-lg font-semibold text-white">Навыки агентов</h3>
      <p className="mt-2 text-xs leading-5 text-gray-500">Сопоставляем ваши логи с каталогом skills.api.zed.md и предлагаем недостающие workflow.</p>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <MiniMetricBig label="used" value={formatNumber(skills?.usedCount ?? 0)} tone="success" />
        <MiniMetricBig label="rec" value={formatNumber(skills?.recommendedCount ?? 0)} />
        <MiniMetricBig label="all" value={formatNumber(skills?.totalSkills ?? 0)} />
      </div>

      <SkillBucket title="Используются" items={used} />
      <SkillBucket title="Рекомендуем" items={recommended} />
      <SkillBucket title="Не используются" items={unused} muted />
    </div>
  );
}

function SkillBucket({ title, items, muted = false }: { title: string; items: SkillMappingItem[]; muted?: boolean }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-4">
      <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500">{title}</div>
      <div className="mt-2 space-y-2">
        {items.map(item => {
          const matchedSignals = item.matchedSignals ?? [];
          return (
            <div key={`${title}-${item.id}`} className={`skill-intel-card rounded-lg border px-3 py-3 ${muted ? 'skill-intel-muted' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-white" title={item.slug}>{item.slug}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <span className="skill-pill">{item.category}</span>
                    <span className="skill-pill">{item.source}</span>
                    <span className="skill-pill">{Math.round(item.confidence * 100)}% match</span>
                  </div>
                </div>
              </div>
              <div className="mt-2 text-[11px] leading-4 text-cyan-100/80">{item.evidence}</div>
              <div className="mt-1.5 line-clamp-3 text-[11px] leading-4 text-gray-400">{item.reason}</div>
              {item.insight && (
                <div className="mt-2 rounded-lg border border-emerald-300/12 bg-emerald-300/[0.045] px-2.5 py-2 text-[11px] leading-4 text-emerald-100/85">
                  {item.insight}
                </div>
              )}
              {item.nextStep && (
                <div className="mt-2 text-[11px] leading-4 text-cyan-100">
                  <span className="text-gray-500">Следующий шаг: </span>{item.nextStep}
                </div>
              )}
              {matchedSignals.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {matchedSignals.slice(0, 4).map(signal => (
                    <span key={`${item.id}-${signal}`} className="rounded-full bg-white/[0.045] px-2 py-0.5 text-[10px] text-gray-400">{signal}</span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MiniMetricBig({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'success' }) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#07111f]/70 p-3">
      <div className="text-[10px] uppercase tracking-wide text-gray-600">{label}</div>
      <div className={`mt-1 truncate font-mono text-sm font-semibold ${tone === 'success' ? 'text-emerald-200' : 'text-cyan-100'}`} title={value}>{value}</div>
    </div>
  );
}

function DashCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="surface-card card-glow border rounded-2xl p-4 transition-transform duration-300 ease-out hover:-translate-y-0.5">
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <p className="text-xl font-bold text-white truncate">{value}</p>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-gray-600">{label}</div>
      <div className="mt-1 font-mono text-sm text-cyan-100 truncate">{value}</div>
    </div>
  );
}

function getRank(successRate: number, requests: number, modelCount: number): string {
  if (requests > 5_000 && successRate >= 0.95 && modelCount >= 20) return 'S-класс';
  if (requests > 1_000 && successRate >= 0.9) return 'Продвинутый';
  if (requests > 100) return 'Активный';
  return 'Новичок';
}

function buildBadges(requests: number, successRate: number, modelCount: number): string[] {
  const badges = ['Живые логи'];
  if (requests > 1_000) badges.push('Высокий объем');
  if (successRate >= 0.95) badges.push('Чистые ответы');
  if (modelCount >= 10) badges.push('Много моделей');
  return badges;
}

function buildHeatmapDays(days: ActivityDay[]): ActivityDay[] {
  const byDate = new Map(days.map(day => [day.date, day]));
  const endDate = days.at(-1)?.date ?? new Date().toISOString().slice(0, 10);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  const out: ActivityDay[] = [];
  for (let i = 41; i >= 0; i -= 1) {
    const date = new Date(end);
    date.setUTCDate(end.getUTCDate() - i);
    const key = date.toISOString().slice(0, 10);
    out.push(byDate.get(key) ?? {
      date: key,
      requests: 0,
      sessions: 0,
      tokens: 0,
      cost: 0,
      successRate: 0,
      firstSeen: null,
      lastSeen: null,
      topModel: null,
      topProvider: null,
    });
  }
  return out;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}
