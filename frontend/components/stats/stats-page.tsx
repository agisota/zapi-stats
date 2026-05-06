import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getModelStats, getProviderStats, getTimeline, type ModelStat, type ProviderStat } from '../../lib/api.ts';
import { formatNumber, formatCost, formatLatency, formatPercent } from '../../lib/format.ts';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area } from 'recharts';
import { BarChart3, Globe, Clock } from 'lucide-react';
import { MetricGuide, SkeletonBlock, StatePanel } from '../ui/feedback.tsx';

const COLORS = ['#06b6d4', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444', '#ec4899', '#6366f1', '#14b8a6'];

export function StatsPage() {
  const { data: models, isLoading: modelsLoading, isError: modelsError } = useQuery({ queryKey: ['models'], queryFn: getModelStats });
  const { data: providers, isLoading: providersLoading, isError: providersError } = useQuery({ queryKey: ['providers'], queryFn: getProviderStats });
  const { data: timeline, isLoading: timelineLoading, isError: timelineError } = useQuery({ queryKey: ['timeline', '7d'], queryFn: () => getTimeline('7d') });

  const modelRows = models?.data ?? [];
  const providerRows = providers?.data ?? [];
  const timelineRows = timeline?.data ?? [];
  const compactCharts = useCompactCharts();
  const modelChartRows = useMemo(() => modelRows.slice(0, compactCharts ? 6 : 10), [compactCharts, modelRows]);
  const providerChartRows = useMemo(() => compactProviders(providerRows, compactCharts ? 7 : 9), [compactCharts, providerRows]);
  const [showAllModels, setShowAllModels] = useState(false);
  const modelTableLimit = compactCharts ? 36 : 64;
  const visibleModelRows = showAllModels ? modelRows : modelRows.slice(0, modelTableLimit);
  const hiddenModelRows = Math.max(0, modelRows.length - visibleModelRows.length);

  return (
    <div className="space-y-6">
      <MetricGuide
        title="Пояснения к аналитике"
        items={[
          { label: 'Динамика', text: 'Показывает общий поток запросов за 7 дней, полезно для поиска всплесков и провалов.' },
          { label: 'Модели', text: 'Top моделей по фактическому количеству вызовов, не полный каталог `/v1/models`.' },
          { label: 'Провайдеры', text: 'Распределение трафика и success rate по backend-провайдерам.' },
          { label: 'Стоимость', text: 'Оценка по usage-тарифам; сравнивайте с токенами и моделью.' },
        ]}
      />

      {timelineLoading && !timeline && <ChartSkeleton title="Загрузка динамики запросов" />}
      {timelineError && (
        <StatePanel state="partial" title="Динамика запросов недоступна">
          `/api/stats/timeline` не ответил. Остальные блоки могут загрузиться независимо.
        </StatePanel>
      )}
      {!timelineLoading && !timelineError && timelineRows.length === 0 && (
        <StatePanel state="empty" title="Нет точек динамики">
          За выбранный период нет агрегированных точек или данные еще обновляются.
        </StatePanel>
      )}
      {timelineRows.length > 0 && (
        <div className="surface-card border rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-5 h-5 text-cyan-400" />
            <h3 className="font-semibold text-white">Динамика запросов за 7 дней</h3>
          </div>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={timelineRows}>
              <defs>
                <linearGradient id="colorReq" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="timestamp" tickFormatter={t => new Date(t).toLocaleDateString('ru', { day: '2-digit', month: '2-digit' })} stroke="#64748b" fontSize={11} />
              <YAxis stroke="#64748b" fontSize={11} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                labelStyle={{ color: '#94a3b8' }}
                itemStyle={{ color: '#06b6d4' }}
              />
              <Area type="monotone" dataKey="requests" name="Запросы" stroke="#06b6d4" fill="url(#colorReq)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {modelsLoading && !models && <ChartSkeleton title="Загрузка распределения моделей" />}
        {modelsError && (
          <StatePanel state="partial" title="Статистика моделей недоступна">
            `/api/stats/models` не ответил, поэтому top моделей и таблица временно скрыты.
          </StatePanel>
        )}
        {!modelsLoading && !modelsError && modelRows.length === 0 && (
          <StatePanel state="empty" title="Нет статистики моделей">
            Модельные строки появятся после успешных вызовов через API gateway.
          </StatePanel>
        )}
        {modelRows.length > 0 && (
          <div className="surface-card border rounded-xl p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-purple-400" />
                <h3 className="font-semibold text-white">Модели</h3>
              </div>
              <span className="text-xs text-gray-500">top {modelChartRows.length}</span>
            </div>
            <ResponsiveContainer width="100%" height={compactCharts ? 240 : 300}>
              <BarChart data={modelChartRows} layout="vertical" margin={{ left: 0, right: 12, top: 4, bottom: 4 }}>
                <XAxis type="number" stroke="#64748b" fontSize={11} />
                <YAxis
                  type="category"
                  dataKey="model"
                  width={compactCharts ? 112 : 180}
                  stroke="#64748b"
                  fontSize={10}
                  tick={{ fill: '#94a3b8' }}
                  tickFormatter={value => compactCharts ? shortModelLabel(String(value)) : String(value)}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                  formatter={(v) => formatNumber(Number(v ?? 0))}
                />
                <Bar dataKey="count" name="Запросы" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {providersLoading && !providers && <ChartSkeleton title="Загрузка провайдеров" />}
        {providersError && (
          <StatePanel state="partial" title="Статистика провайдеров недоступна">
            `/api/stats/providers` не ответил. Таблица пользователей может продолжать работать.
          </StatePanel>
        )}
        {!providersLoading && !providersError && providerRows.length === 0 && (
          <StatePanel state="empty" title="Нет статистики провайдеров">
            Провайдеры появятся после первых записей usage history.
          </StatePanel>
        )}
        {providerRows.length > 0 && (
          <div className="surface-card border rounded-xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <Globe className="w-5 h-5 text-emerald-400" />
              <h3 className="font-semibold text-white">Провайдеры</h3>
            </div>
            <div className="flex flex-col xl:flex-row xl:items-center gap-6">
              <div className="h-[250px] w-full xl:w-1/2">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={providerChartRows}
                      dataKey="count"
                      nameKey="provider"
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={90}
                      paddingAngle={2}
                    >
                      {providerChartRows.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-2 flex-1">
                {providerChartRows.map((p, i) => (
                  <div key={p.provider} className="flex items-center justify-between gap-3 text-sm">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                      <span className="truncate text-gray-300">{p.provider}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-4 text-gray-500">
                      <span>{formatNumber(p.count)}</span>
                      <span className={p.successRate >= 0.95 ? 'text-emerald-400' : 'text-amber-400'}>{formatPercent(p.successRate)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {modelRows.length > 0 && (
        <div className="surface-card data-table-shell border rounded-xl overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-[#263044] px-6 py-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="font-semibold text-white">Подробная таблица моделей</h3>
              <p className="mt-1 text-xs text-gray-500">
                Показано {formatNumber(visibleModelRows.length)} из {formatNumber(modelRows.length)} строк. Success rate и cost берутся из существующей публичной агрегированной статистики.
              </p>
            </div>
            {modelRows.length > modelTableLimit && (
              <button
                type="button"
                onClick={() => setShowAllModels(value => !value)}
                className="self-start rounded-full border border-cyan-200/16 bg-cyan-200/[0.055] px-3 py-2 text-xs font-semibold text-cyan-100 transition-colors hover:border-cyan-200/35 hover:bg-cyan-200/10 md:self-auto"
              >
                {showAllModels ? `Свернуть до ${modelTableLimit}` : `Показать еще ${formatNumber(hiddenModelRows)}`}
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="data-table w-full">
              <thead>
                <tr className="text-xs text-gray-500 uppercase tracking-wider">
                  <th className="px-6 py-3 text-left">Модель</th>
                  <th className="px-6 py-3 text-right">Запросы</th>
                  <th className="px-6 py-3 text-right">Входные токены</th>
                  <th className="px-6 py-3 text-right">Выходные токены</th>
                  <th className="px-6 py-3 text-right">Средняя задержка</th>
                  <th className="px-6 py-3 text-right">Расчетная стоимость</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e293b]">
                {visibleModelRows.map(m => (
                  <tr key={m.model} className="hover:bg-[#1f2937]">
                    <td className="px-6 py-3 font-mono text-sm text-gray-300">{m.model}</td>
                    <td className="px-6 py-3 text-right font-mono text-sm text-gray-300">{formatNumber(m.count)}</td>
                    <td className="px-6 py-3 text-right font-mono text-sm text-gray-300">{formatNumber(m.tokensIn)}</td>
                    <td className="px-6 py-3 text-right font-mono text-sm text-gray-300">{formatNumber(m.tokensOut)}</td>
                    <td className="px-6 py-3 text-right text-sm text-gray-400">{formatLatency(m.avgLatency)}</td>
                    <td className="px-6 py-3 text-right font-mono text-sm text-amber-400">{formatCost(m.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function useCompactCharts() {
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' ? window.matchMedia('(max-width: 720px)').matches : false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const query = window.matchMedia('(max-width: 720px)');
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return compact;
}

function compactProviders(rows: ProviderStat[], limit: number): ProviderStat[] {
  if (rows.length <= limit) return rows;
  const sorted = [...rows].sort((a, b) => b.count - a.count);
  const visible = sorted.slice(0, limit - 1);
  const other = sorted.slice(limit - 1).reduce<ProviderStat>((sum, row) => ({
    provider: 'other',
    count: sum.count + row.count,
    tokensIn: sum.tokensIn + row.tokensIn,
    tokensOut: sum.tokensOut + row.tokensOut,
    cost: sum.cost + row.cost,
    successRate: 0,
  }), { provider: 'other', count: 0, tokensIn: 0, tokensOut: 0, cost: 0, successRate: 0 });
  const weightedSuccess = other.count > 0
    ? sorted.slice(limit - 1).reduce((sum, row) => sum + row.successRate * row.count, 0) / other.count
    : 0;
  return [...visible, { ...other, successRate: weightedSuccess }];
}

function shortModelLabel(model: ModelStat['model']): string {
  const cleaned = model
    .replace(/^accounts\/[^/]+\/models\//, '')
    .replace(/^fireworks\//, '')
    .replace(/^opencode-go\//, '')
    .replace(/^codex\//, '')
    .replace(/^cx\//, '');
  if (cleaned.length <= 18) return cleaned;
  return `${cleaned.slice(0, 15)}...`;
}

function ChartSkeleton({ title }: { title: string }) {
  return (
    <div className="surface-card border rounded-xl p-6">
      <div className="mb-4 text-sm font-semibold text-white">{title}</div>
      <SkeletonBlock className="h-[250px] w-full" />
    </div>
  );
}
