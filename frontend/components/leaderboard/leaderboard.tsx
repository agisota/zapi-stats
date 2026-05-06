import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getLeaderboard, getOverview, type LeaderboardEntry } from '../../lib/api.ts';
import { formatNumber, formatLatency, formatPercent, timeAgo, formatDate, formatHour, formatDecimal } from '../../lib/format.ts';
import { Trophy, Zap, Coins, Users, Hash, ArrowUp, ArrowDown, AlertTriangle, Gauge, ShieldCheck, Target } from 'lucide-react';
import { UserProfileModal } from './user-profile-modal.tsx';
import { displayName } from '../../lib/display.ts';
import { StatsPage } from '../stats/stats-page.tsx';
import { MetricGuide, SkeletonBlock, StatePanel } from '../ui/feedback.tsx';

type SortKey = keyof LeaderboardEntry;
type SortDir = 'asc' | 'desc';

const TOOLTIPS: Record<string, string> = {
  requests: 'Общее количество API-запросов',
  tokensIn: 'Суммарное количество входных токенов (промпт + контекст)',
  tokensOut: 'Суммарное количество выходных токенов (ответ модели)',
  tokensCacheRead: 'Токены, прочитанные из кэша промптов (экономия)',
  tokensCacheCreation: 'Токены, записанные в кэш промптов',
  tokensReasoning: 'Токены, использованные моделью для внутреннего рассуждения',
  tokensPerRequest: 'Среднее количество токенов на один запрос: вход + выход',
  cost: 'Расчётная общая стоимость на основе тарифов моделей',
  costPerRequest: 'Средняя стоимость одного запроса',
  inputCost: 'Стоимость входных токенов',
  outputCost: 'Стоимость выходных токенов',
  avgLatency: 'Среднее время ответа от отправки запроса до получения полного ответа',
  avgTtft: 'Время до первого токена ответа',
  uniqueModels: 'Количество уникальных моделей, использованных пользователем',
  requestsPerDay: 'Среднее количество запросов в день (запросы / активные дни)',
  outputRatio: 'Отношение выходных токенов к входным — показатель продуктивности',
  activeDays: 'Количество дней с хотя бы одним запросом',
  avgSessionMessages: 'Среднее количество запросов в одной сессии (разделитель — 30 мин паузы)',
  longestSessionMessages: 'Максимальное количество запросов в одной непрерывной сессии',
  firstSeen: 'Дата первого запроса',
  lastSeen: 'Время с момента последнего запроса',
  activity: 'Распределение запросов по часам суток (24ч)',
  providers: 'Распределение запросов по ИИ-провайдерам',
  topModel: 'Наиболее часто используемая модель',
  successRate: 'Доля успешных запросов. Считается по фактическим логам вызовов',
  errorRate: 'Доля запросов с ошибкой',
};

const PROVIDER_COLORS: Record<string, string> = {
  claude: '#8b5cf6', antigravity: '#06b6d4', codex: '#f59e0b', xai: '#10b981',
  groq: '#ef4444', gemini: '#3b82f6', fireworks: '#ec4899', together: '#14b8a6', mistral: '#6366f1',
};

export function Leaderboard() {
  const { data: lb, isLoading: lbLoading, isError: lbError } = useQuery({ queryKey: ['leaderboard'], queryFn: getLeaderboard });
  const { data: ov, isLoading: ovLoading, isError: ovError } = useQuery({ queryKey: ['overview'], queryFn: getOverview });
  const [sortKey, setSortKey] = useState<SortKey>('requests');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [nameFilter, setNameFilter] = useState('');

  const overview = ov?.data;
  const entries = (lb?.data ?? []).filter(e => {
    if (!nameFilter.trim()) return true;
    const q = nameFilter.trim().toLowerCase();
    return (e.displayName || '').toLowerCase().includes(q) || e.name.toLowerCase().includes(q);
  });

  const sorted = useMemo(() => {
    const arr = [...entries];
    arr.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av;
      return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
    return arr;
  }, [entries, sortKey, sortDir]);

  const ranges = useMemo(() => {
    if (entries.length === 0) return {} as Record<string, { min: number; max: number }>;
      const numKeys: SortKey[] = [
        'requests', 'tokensIn', 'tokensOut', 'tokensCacheRead', 'tokensCacheCreation',
        'tokensReasoning', 'tokensPerRequest', 'cost', 'costPerRequest',
        'inputCost', 'outputCost', 'avgLatency', 'avgTtft', 'uniqueModels',
        'successRate', 'errorRate', 'requestsPerDay', 'outputRatio', 'activeDays', 'avgSessionMessages', 'longestSessionMessages',
      ];
    const r: Record<string, { min: number; max: number }> = {};
    for (const k of numKeys) {
      const vals = entries.map(e => e[k] as number).filter(v => typeof v === 'number');
      r[k] = { min: Math.min(...vals), max: Math.max(...vals) };
    }
    return r;
  }, [entries]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  function tc(key: string, value: number, inverse = false): string {
    const range = ranges[key];
    if (!range || range.max === range.min) return 'text-gray-300';
    const ratio = (value - range.min) / (range.max - range.min);
    const r = inverse ? 1 - ratio : ratio;
    if (r >= 0.8) return 'text-emerald-400';
    if (r >= 0.6) return 'text-green-300';
    if (r >= 0.4) return 'text-gray-300';
    if (r >= 0.2) return 'text-amber-400';
    return 'text-red-400';
  }

  return (
    <div id="ranking" className="scroll-mt-28 space-y-6">
      {overview && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard icon={<Zap className="w-5 h-5 text-cyan-400" />} label="Запросы" value={formatNumber(overview.totalRequests)} />
          <StatCard icon={<Hash className="w-5 h-5 text-purple-400" />} label="Входные токены" value={formatNumber(overview.totalTokensIn)} />
          <StatCard icon={<Coins className="w-5 h-5 text-amber-400" />} label="Общая стоимость" value={<CostVal n={overview.totalCost} />} />
          <StatCard icon={<Users className="w-5 h-5 text-emerald-400" />} label="Активные ключи" value={String(overview.activeKeys)} />
        </div>
      )}
      {!overview && ovLoading && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4" aria-label="Загрузка сводных метрик">
          {Array.from({ length: 4 }).map((_, index) => <StatSkeleton key={index} />)}
        </div>
      )}
      {ovError && (
        <StatePanel state="partial" title="Сводные метрики загружены частично">
          Таблица рейтинга может быть доступна отдельно, но `/api/stats/overview` сейчас не ответил.
        </StatePanel>
      )}

      {entries.length > 0 && <OperationalSummary entries={entries} />}

      <MetricGuide
        items={[
          { label: 'Success rate', text: 'Процент запросов без ошибки. Сравнивайте рядом с задержкой, а не как единственный показатель качества.' },
          { label: 'Cost', text: 'Расчетная стоимость по тарифам моделей; это операционный ориентир, а не бухгалтерский инвойс.' },
          { label: 'Providers', text: 'Показывает распределение трафика по backend-провайдерам и помогает видеть зависимость от одного маршрута.' },
          { label: 'Leaderboard', text: 'Рейтинг сортируется по клику на заголовок. В mobile сначала показаны top users, затем полная таблица.' },
        ]}
      />

      {!lbLoading && !lbError && sorted.length > 0 && (
        <section className="grid gap-3 md:hidden" aria-label="Топ пользователей на mobile">
          {sorted.slice(0, 5).map((entry, index) => (
            <button
              key={entry.name}
              type="button"
              onClick={() => setSelectedUser(entry.name)}
              className="surface-card border rounded-xl p-4 text-left"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs text-gray-500">#{index + 1}</div>
                  <div className="mt-1 truncate text-base font-semibold text-white">{displayName(entry.displayName)}</div>
                  <div className="mt-1 truncate text-xs text-gray-500">{entry.topModel}</div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-lg font-bold text-cyan-100">{formatNumber(entry.requests)}</div>
                  <div className="text-[11px] text-gray-500">запросов</div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <CompactMetric label="успех" value={formatPercent(entry.successRate)} tone={entry.successRate >= 0.95 ? 'success' : 'warning'} />
                <CompactMetric label="стоимость" value={`$${entry.cost.toLocaleString('ru-RU', { maximumFractionDigits: 0 })}`} />
                <CompactMetric label="задержка" value={formatLatency(entry.avgLatency)} />
              </div>
            </button>
          ))}
        </section>
      )}

      <div id="rating" className="surface-card data-table-shell scroll-mt-28 border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#263044] flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
          <div className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-amber-400" />
            <h2 className="text-lg font-semibold text-white">Рейтинг пользователей</h2>
            <span className="text-xs text-gray-500">нажмите заголовок для сортировки</span>
          </div>
          <label className="relative flex-1 max-w-xs">
            <input
              value={nameFilter}
              onChange={e => setNameFilter(e.target.value)}
              className="w-full rounded-full border border-white/10 bg-[#07111f] py-1.5 pl-3 pr-3 text-xs text-cyan-50 outline-none focus:border-cyan-200/40"
              placeholder="поиск по имени..."
            />
          </label>
        </div>

        {lbLoading && !lb && (
          <div className="grid gap-3 p-5" aria-label="Загрузка рейтинга">
            {Array.from({ length: 6 }).map((_, index) => <SkeletonBlock key={index} className="h-10" />)}
          </div>
        )}

        {lbError && (
          <div className="p-5">
            <StatePanel state="error" title="Рейтинг пользователей не загрузился">
              `/api/leaderboard` не ответил. Проверьте health API и повторите обновление страницы.
            </StatePanel>
          </div>
        )}

        {!lbLoading && !lbError && sorted.length === 0 && (
          <div className="p-5">
            <StatePanel state="empty" title={nameFilter.trim() ? 'По фильтру ничего не найдено' : 'В рейтинге пока нет данных'}>
              Очистите поиск или дождитесь новых вызовов API, чтобы строки появились в таблице.
            </StatePanel>
          </div>
        )}

        {!lbLoading && !lbError && sorted.length > 0 && (
        <div className="overflow-x-auto">
          <table className="data-table w-full whitespace-nowrap">
            <thead>
              <tr className="text-xs text-gray-500 uppercase tracking-wider">
                <ThSticky left="left-0" tip="Позиция в рейтинге">#</ThSticky>
                <ThSticky left="left-10" tip="Имя пользователя API-ключа">Пользователь</ThSticky>
                <STh k="requests" s={sortKey} d={sortDir} t={toggleSort} label="Запросы" />
                <STh k="tokensIn" s={sortKey} d={sortDir} t={toggleSort} label="Вход" />
                <STh k="tokensOut" s={sortKey} d={sortDir} t={toggleSort} label="Выход" />
                <STh k="tokensCacheRead" s={sortKey} d={sortDir} t={toggleSort} label="Кэш чт." />
                <STh k="tokensCacheCreation" s={sortKey} d={sortDir} t={toggleSort} label="Кэш зап." />
                <STh k="tokensReasoning" s={sortKey} d={sortDir} t={toggleSort} label="Размышл." />
                <STh k="tokensPerRequest" s={sortKey} d={sortDir} t={toggleSort} label="Ток/запр." />
                <STh k="cost" s={sortKey} d={sortDir} t={toggleSort} label="Стоимость" />
                <STh k="costPerRequest" s={sortKey} d={sortDir} t={toggleSort} label="$/запр." />
                <STh k="inputCost" s={sortKey} d={sortDir} t={toggleSort} label="$ вход" />
                <STh k="outputCost" s={sortKey} d={sortDir} t={toggleSort} label="$ выход" />
                <STh k="successRate" s={sortKey} d={sortDir} t={toggleSort} label="Успех" bold />
                {/* Activity + Providers after costs */}
                <th className="px-3 py-2 text-center resizable-th" title={TOOLTIPS.activity}>Активность</th>
                <th className="px-3 py-2 text-center resizable-th" title="Активность по дням за весь период">По дням</th>
                <th className="px-3 py-2 text-center resizable-th" style={{ minWidth: 160 }} title={TOOLTIPS.providers}>Провайдеры</th>
                {/* Latency block */}
                <STh k="avgLatency" s={sortKey} d={sortDir} t={toggleSort} label="Задержка" bold />
                <STh k="avgTtft" s={sortKey} d={sortDir} t={toggleSort} label="Первый токен" />
                {/* Remaining */}
                <STh k="uniqueModels" s={sortKey} d={sortDir} t={toggleSort} label="Модели" />
                <STh k="requestsPerDay" s={sortKey} d={sortDir} t={toggleSort} label="Запр/день" />
                <STh k="outputRatio" s={sortKey} d={sortDir} t={toggleSort} label="Выход %" />
                <STh k="activeDays" s={sortKey} d={sortDir} t={toggleSort} label="Дни" />
                <STh k="avgSessionMessages" s={sortKey} d={sortDir} t={toggleSort} label="Запр/сес." />
                <STh k="longestSessionMessages" s={sortKey} d={sortDir} t={toggleSort} label="Макс. сес." />
                <th className="px-3 py-2 text-left resizable-th" title={TOOLTIPS.topModel}>Топ-модель</th>
                <STh k="firstSeen" s={sortKey} d={sortDir} t={toggleSort} label="Первый" />
                <STh k="lastSeen" s={sortKey} d={sortDir} t={toggleSort} label="Последний" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e293b]">
              {sorted.map((e, i) => {
                const cleanName = displayName(e.displayName);
                const initial = cleanName[0]?.toUpperCase();
                return (
                  <tr key={e.name} className="hover:bg-[#1f2937] transition-colors cursor-pointer" onClick={() => setSelectedUser(e.name)}>
                    <td className="px-3 py-2 sticky left-0 bg-[#111827]/95 z-10">
                      <span className={i === 0 ? 'rank-gold font-bold text-lg' : i === 1 ? 'rank-silver font-bold text-lg' : i === 2 ? 'rank-bronze font-bold text-lg' : 'text-gray-500'}>{i + 1}</span>
                    </td>
                    <td className="px-3 py-2 sticky left-10 bg-[#111827]/95 z-10">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white text-xs font-bold shrink-0">{initial}</div>
                        <span className="font-medium text-white text-sm"><UserName name={cleanName} /></span>
                      </div>
                    </td>
                    <Td c={tc('requests', e.requests)}>{formatNumber(e.requests)}</Td>
                    <Td c={tc('tokensIn', e.tokensIn, true)}>{formatNumber(e.tokensIn)}</Td>
                    <Td c={tc('tokensOut', e.tokensOut)}>{formatNumber(e.tokensOut)}</Td>
                    <Td c={tc('tokensCacheRead', e.tokensCacheRead)}>{formatNumber(e.tokensCacheRead)}</Td>
                    <Td c={tc('tokensCacheCreation', e.tokensCacheCreation)}>{formatNumber(e.tokensCacheCreation)}</Td>
                    <Td c={tc('tokensReasoning', e.tokensReasoning)}>{formatNumber(e.tokensReasoning)}</Td>
                    <Td c={tc('tokensPerRequest', e.tokensPerRequest, true)}>{formatNumber(e.tokensPerRequest)}</Td>
                    <Td c={tc('cost', e.cost, true)}><CostVal n={e.cost} /></Td>
                    <Td c={tc('costPerRequest', e.costPerRequest, true)}><CostVal n={e.costPerRequest} /></Td>
                    <Td c={tc('inputCost', e.inputCost, true)}><CostVal n={e.inputCost} /></Td>
                    <Td c={tc('outputCost', e.outputCost)}><CostVal n={e.outputCost} /></Td>
                    <Td c={tc('successRate', e.successRate)}>{formatPercent(e.successRate)}</Td>
                    {/* Activity sparkline */}
                    <td className="px-4 py-2 text-center">
                      {e.hourlyActivity ? (
                        <>
                          <MiniSparkline data={e.hourlyActivity} width={120} height={24} />
                          <div className="text-[10px] text-gray-600 mt-0.5">пик {formatHour(e.peakHour)}</div>
                        </>
                      ) : <span className="text-gray-500 text-sm">{formatHour(e.peakHour)}</span>}
                    </td>
                    {/* Daily sparkline */}
                    <td className="px-4 py-2 text-center">
                      {e.dailyActivity && e.dailyActivity.length > 0
                        ? <MiniSparkline data={e.dailyActivity} width={100} height={20} />
                        : <span className="text-gray-600 text-xs">—</span>}
                    </td>
                    {/* Provider bar — wider */}
                    <td className="px-4 py-2">
                      <ProviderBar breakdown={e.providerBreakdown ?? []} />
                    </td>
                    {/* Latency — bold, inverse */}
                    <td className={`px-3 py-2 text-right font-mono text-sm font-bold ${tc('avgLatency', e.avgLatency, true)}`}>{formatLatency(e.avgLatency)}</td>
                    <Td c={tc('avgTtft', e.avgTtft, true)}>{formatLatency(e.avgTtft)}</Td>
                    <Td c={tc('uniqueModels', e.uniqueModels)}>{e.uniqueModels}</Td>
                    <Td c={tc('requestsPerDay', e.requestsPerDay)}>{formatDecimal(e.requestsPerDay, 1)}</Td>
                    <Td c={tc('outputRatio', e.outputRatio)}>{formatPercent(e.outputRatio)}</Td>
                    <Td c={tc('activeDays', e.activeDays)}>{e.activeDays}</Td>
                    <Td c={tc('avgSessionMessages', e.avgSessionMessages)}>{formatDecimal(e.avgSessionMessages, 1)}</Td>
                    <Td c={tc('longestSessionMessages', e.longestSessionMessages)}>{e.longestSessionMessages}</Td>
                    <td className="px-3 py-2 text-sm text-gray-400 max-w-[180px] truncate">{e.topModel}</td>
                    <Td c="text-gray-500">{formatDate(e.firstSeen)}</Td>
                    <Td c="text-gray-500">{timeAgo(e.lastSeen)}</Td>
                  </tr>
                );
              })}
            </tbody>
            {sorted.length > 0 && (
              <tfoot>
                <tr className="bg-[#0f172a]/95 border-t-2 border-[#263044]">
                  <td className="px-3 py-2 sticky left-0 bg-[#0f172a]/95 z-10 font-bold text-white" colSpan={2}>ИТОГО</td>
                  <Td c="text-white font-bold">{formatNumber(sorted.reduce((s,e)=>s+e.requests,0))}</Td>
                  <Td c="text-white font-bold">{formatNumber(sorted.reduce((s,e)=>s+e.tokensIn,0))}</Td>
                  <Td c="text-white font-bold">{formatNumber(sorted.reduce((s,e)=>s+e.tokensOut,0))}</Td>
                  <Td c="text-white font-bold">{formatNumber(sorted.reduce((s,e)=>s+e.tokensCacheRead,0))}</Td>
                  <Td c="text-white font-bold">{formatNumber(sorted.reduce((s,e)=>s+e.tokensCacheCreation,0))}</Td>
                  <Td c="text-white font-bold">{formatNumber(sorted.reduce((s,e)=>s+e.tokensReasoning,0))}</Td>
                  <Td c="text-white font-bold">{formatNumber(Math.round(sorted.reduce((s,e)=>s+e.tokensPerRequest,0)/sorted.length))}</Td>
                  <Td c="text-white font-bold"><CostVal n={sorted.reduce((s,e)=>s+e.cost,0)} /></Td>
                  <td className="px-3 py-2 text-right font-mono text-sm text-gray-500">—</td>
                  <Td c="text-white font-bold"><CostVal n={sorted.reduce((s,e)=>s+e.inputCost,0)} /></Td>
                  <Td c="text-white font-bold"><CostVal n={sorted.reduce((s,e)=>s+e.outputCost,0)} /></Td>
                  <Td c="text-gray-500">{formatPercent(sorted.reduce((s,e)=>s+e.successRate,0)/sorted.length)}</Td>
                  <td className="px-3 py-2 text-center text-gray-500" colSpan={2}>—</td>
                  <td className="px-4 py-2 text-gray-500">—</td>
                  <Td c="text-gray-500">{formatLatency(sorted.reduce((s,e)=>s+e.avgLatency,0)/sorted.length)}</Td>
                  <Td c="text-gray-500">{formatLatency(sorted.reduce((s,e)=>s+e.avgTtft,0)/sorted.length)}</Td>
                  <Td c="text-white font-bold">{formatNumber(sorted.reduce((s,e)=>s+e.uniqueModels,0))}</Td>
                  <td className="px-3 py-2 text-right font-mono text-sm text-gray-500">—</td>
                  <td className="px-3 py-2 text-right font-mono text-sm text-gray-500">—</td>
                  <Td c="text-white font-bold">{formatNumber(sorted.reduce((s,e)=>s+e.activeDays,0))}</Td>
                  <td className="px-3 py-2 text-right font-mono text-sm text-gray-500">—</td>
                  <td className="px-3 py-2 text-right font-mono text-sm text-gray-500">—</td>
                  <td className="px-3 py-2 text-sm text-gray-500">—</td>
                  <td className="px-3 py-2 text-sm text-gray-500">—</td>
                  <td className="px-3 py-2 text-sm text-gray-500">—</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        )}
      </div>
      {selectedUser && (
        <UserProfileModal name={selectedUser} entry={entries.find(e => e.name === selectedUser)} onClose={() => setSelectedUser(null)} />
      )}
      <section id="analytics" className="scroll-mt-28 space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-cyan-200/60">общая аналитика</div>
            <h2 className="mt-1 text-xl font-semibold text-white">Сводка по всем запросам</h2>
          </div>
          <div className="hidden md:block text-xs text-gray-500">модели, провайдеры и динамика теперь в одном экране рейтинга</div>
        </div>
        <StatsPage />
      </section>
    </div>
  );
}

// --- Helper Components ---

function UserName({ name }: { name: string }) {
  return <>{name}</>;
}

function CostVal({ n }: { n: number }) {
  const formatted = n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return <><span className="text-gray-500">$</span>{formatted}</>;
}

function OperationalSummary({ entries }: { entries: LeaderboardEntry[] }) {
  const totalRequests = entries.reduce((sum, entry) => sum + entry.requests, 0);
  const totalCost = entries.reduce((sum, entry) => sum + entry.cost, 0);
  const weightedSuccess = totalRequests > 0
    ? entries.reduce((sum, entry) => sum + entry.successRate * entry.requests, 0) / totalRequests
    : 0;
  const weightedLatency = totalRequests > 0
    ? entries.reduce((sum, entry) => sum + entry.avgLatency * entry.requests, 0) / totalRequests
    : 0;
  const weakQuality = entries.filter(entry => entry.requests >= 10 && entry.successRate < 0.95).length;
  const topCost = entries.reduce<LeaderboardEntry | null>((top, entry) => !top || entry.cost > top.cost ? entry : top, null);
  const topCostShare = topCost && totalCost > 0 ? topCost.cost / totalCost : 0;

  return (
    <section className="ops-summary grid gap-3 md:grid-cols-4" aria-label="Оперативные сигналы">
      <SignalCard
        icon={<ShieldCheck className="h-4 w-4" />}
        label="Качество"
        value={formatPercent(weightedSuccess)}
        detail="взвешенный success rate"
        tone={weightedSuccess >= 0.98 ? 'success' : weightedSuccess >= 0.94 ? 'warning' : 'danger'}
      />
      <SignalCard
        icon={<Gauge className="h-4 w-4" />}
        label="Latency"
        value={formatLatency(weightedLatency)}
        detail="среднее по трафику"
        tone={weightedLatency <= 4500 ? 'success' : weightedLatency <= 12000 ? 'warning' : 'danger'}
      />
      <SignalCard
        icon={<Coins className="h-4 w-4" />}
        label="Cost focus"
        value={formatPercent(topCostShare)}
        detail={topCost ? `у ${displayName(topCost.displayName)}` : 'нет данных'}
        tone={topCostShare <= 0.35 ? 'neutral' : topCostShare <= 0.55 ? 'warning' : 'danger'}
      />
      <SignalCard
        icon={weakQuality > 0 ? <AlertTriangle className="h-4 w-4" /> : <Target className="h-4 w-4" />}
        label="Проверить"
        value={String(weakQuality)}
        detail="ключей с success < 95%"
        tone={weakQuality === 0 ? 'success' : weakQuality <= 3 ? 'warning' : 'danger'}
      />
    </section>
  );
}

function SignalCard({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  tone: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  const toneClass = {
    neutral: 'border-cyan-200/12 text-cyan-200',
    success: 'border-emerald-200/18 text-emerald-200',
    warning: 'border-amber-200/22 text-amber-200',
    danger: 'border-red-200/25 text-red-200',
  }[tone];

  return (
    <div className={`rounded-xl border bg-white/[0.025] p-4 ${toneClass}`}>
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-current/70">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-2 font-mono text-xl font-bold text-white">{value}</div>
      <div className="mt-1 truncate text-xs text-gray-500">{detail}</div>
    </div>
  );
}

function MiniSparkline({ data, width, height }: { data: number[]; width: number; height: number }) {
  const max = Math.max(...data, 1);
  const barW = width / data.length;
  return (
    <svg width={width} height={height} className="inline-block">
      {data.map((v, i) => (
        <rect key={i} x={i * barW} y={height - (v / max) * height} width={Math.max(barW - 1, 1)} height={(v / max) * height} fill="#06b6d4" opacity={Math.max(0.15, v / max)} />
      ))}
    </svg>
  );
}

function ProviderBar({ breakdown }: { breakdown: Array<{ provider: string; percent: number }> }) {
  return (
    <div className="flex flex-col gap-0.5" style={{ width: 160 }}>
      <div className="flex h-3 rounded-full overflow-hidden bg-[#1e293b]">
        {breakdown.map((p, i) => (
          <div key={i} style={{ width: `${p.percent}%`, backgroundColor: PROVIDER_COLORS[p.provider] ?? '#64748b' }} title={`${p.provider}: ${Math.round(p.percent)}%`} />
        ))}
      </div>
      <div className="text-[9px] text-gray-500 truncate">
        {breakdown.slice(0, 3).map(p => `${p.provider} ${Math.round(p.percent)}%`).join(' · ')}
      </div>
    </div>
  );
}

function ThSticky({ children, left, tip }: { children: React.ReactNode; left: string; tip?: string }) {
  return <th className={`px-3 py-2 text-left sticky ${left} bg-[#0f172a] z-10 resizable-th`} title={tip}>{children}</th>;
}

function STh({ k, s, d, t, label, bold }: { k: SortKey; s: SortKey; d: SortDir; t: (k: SortKey) => void; label?: string; bold?: boolean }) {
  const isActive = s === k;
  const displayLabel = label ?? k.charAt(0).toUpperCase() + k.slice(1);
  return (
    <th
      className={`px-3 py-2 text-right select-none resizable-th ${isActive ? 'text-cyan-400' : ''} ${bold ? 'font-bold text-yellow-400' : ''}`}
      title={TOOLTIPS[k] ?? ''}
      aria-sort={isActive ? (d === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => t(k)}
        className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 transition-colors hover:text-cyan-400"
        aria-label={`Сортировать по колонке ${displayLabel}`}
      >
        {displayLabel}
        {isActive && (d === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
      </button>
    </th>
  );
}

function Td({ children, c }: { children: React.ReactNode; c: string }) {
  return <td className={`px-3 py-2 text-right font-mono text-sm ${c}`}>{children}</td>;
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="surface-card border rounded-xl p-4 card-glow transition-colors">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs text-gray-500 uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-xl md:text-2xl font-bold text-white">{value}</p>
    </div>
  );
}

function StatSkeleton() {
  return (
    <div className="surface-card border rounded-xl p-4">
      <SkeletonBlock className="h-4 w-24" />
      <SkeletonBlock className="mt-3 h-7 w-32" />
    </div>
  );
}

function CompactMetric({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'success' | 'warning' }) {
  const toneClass = tone === 'success' ? 'text-emerald-200' : tone === 'warning' ? 'text-amber-200' : 'text-cyan-100';
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.035] p-2">
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`mt-1 font-mono text-sm font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}
