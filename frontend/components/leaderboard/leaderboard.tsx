import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getLeaderboard, getOverview, type LeaderboardEntry } from '../../lib/api.ts';
import { formatNumber, formatLatency, formatPercent, timeAgo, formatDate, formatHour, formatDecimal } from '../../lib/format.ts';
import { Trophy, Zap, Coins, Users, Hash, ArrowUp, ArrowDown } from 'lucide-react';
import { UserProfileModal } from './user-profile-modal.tsx';

type SortKey = keyof LeaderboardEntry;
type SortDir = 'asc' | 'desc';

const TOOLTIPS: Record<string, string> = {
  requests: 'Общее количество API-запросов',
  tokensIn: 'Суммарное количество входных токенов (промпт + контекст)',
  tokensOut: 'Суммарное количество выходных токенов (ответ модели)',
  tokensCacheRead: 'Токены, прочитанные из кэша промптов (экономия)',
  tokensCacheCreation: 'Токены, записанные в кэш промптов',
  tokensReasoning: 'Токены, использованные моделью для внутреннего reasoning (chain-of-thought)',
  tokensPerRequest: 'Среднее количество токенов (in+out) на один запрос',
  cost: 'Расчётная общая стоимость на основе тарифов моделей',
  costPerRequest: 'Средняя стоимость одного запроса',
  inputCost: 'Стоимость входных токенов',
  outputCost: 'Стоимость выходных токенов',
  avgLatency: 'Среднее время ответа от отправки запроса до получения полного ответа',
  avgTtft: 'Time To First Token — время до первого токена ответа',
  uniqueModels: 'Количество уникальных моделей, использованных пользователем',
  requestsPerDay: 'Среднее количество запросов в день (запросы / активные дни)',
  outputRatio: 'Отношение выходных токенов к входным — показатель продуктивности',
  activeDays: 'Количество дней с хотя бы одним запросом',
  avgSessionMessages: 'Среднее количество запросов в одной сессии (разделитель — 30 мин паузы)',
  longestSessionMessages: 'Максимальное количество запросов в одной непрерывной сессии',
  firstSeen: 'Дата первого запроса',
  lastSeen: 'Время с момента последнего запроса',
  activity: 'Распределение запросов по часам суток (24ч)',
  providers: 'Распределение запросов по AI-провайдерам',
  topModel: 'Наиболее часто используемая модель',
};

const PROVIDER_COLORS: Record<string, string> = {
  claude: '#8b5cf6', antigravity: '#06b6d4', codex: '#f59e0b', xai: '#10b981',
  groq: '#ef4444', gemini: '#3b82f6', fireworks: '#ec4899', together: '#14b8a6', mistral: '#6366f1',
};

export function Leaderboard() {
  const { data: lb } = useQuery({ queryKey: ['leaderboard'], queryFn: getLeaderboard });
  const { data: ov } = useQuery({ queryKey: ['overview'], queryFn: getOverview });
  const [sortKey, setSortKey] = useState<SortKey>('requests');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [selectedUser, setSelectedUser] = useState<string | null>(null);

  const overview = ov?.data;
  const entries = lb?.data ?? [];

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
      'requestsPerDay', 'outputRatio', 'activeDays', 'avgSessionMessages', 'longestSessionMessages',
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
    <div className="space-y-6">
      {overview && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard icon={<Zap className="w-5 h-5 text-cyan-400" />} label="Requests" value={formatNumber(overview.totalRequests)} />
          <StatCard icon={<Hash className="w-5 h-5 text-purple-400" />} label="Input Tokens" value={formatNumber(overview.totalTokensIn)} />
          <StatCard icon={<Coins className="w-5 h-5 text-amber-400" />} label="Total Cost" value={<CostVal n={overview.totalCost} />} />
          <StatCard icon={<Users className="w-5 h-5 text-emerald-400" />} label="Active Users" value={String(overview.activeKeys)} />
        </div>
      )}

      <div className="bg-[#111827] border border-[#1e293b] rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#1e293b] flex items-center gap-2">
          <Trophy className="w-5 h-5 text-amber-400" />
          <h2 className="text-lg font-semibold text-white">Leaderboard</h2>
          <span className="text-xs text-gray-500 ml-2">click headers to sort</span>
          <span className="text-xs text-gray-600 ml-2 md:hidden">scroll &rarr;</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap">
            <thead>
              <tr className="text-xs text-gray-500 uppercase tracking-wider">
                <ThSticky left="left-0" tip="Позиция в рейтинге">#</ThSticky>
                <ThSticky left="left-10" tip="Имя пользователя API-ключа">User</ThSticky>
                <STh k="requests" s={sortKey} d={sortDir} t={toggleSort} />
                <STh k="tokensIn" s={sortKey} d={sortDir} t={toggleSort} label="Input Tok" />
                <STh k="tokensOut" s={sortKey} d={sortDir} t={toggleSort} label="Output Tok" />
                <STh k="tokensCacheRead" s={sortKey} d={sortDir} t={toggleSort} label="Cache Read" />
                <STh k="tokensCacheCreation" s={sortKey} d={sortDir} t={toggleSort} label="Cache Write" />
                <STh k="tokensReasoning" s={sortKey} d={sortDir} t={toggleSort} label="Reasoning" />
                <STh k="tokensPerRequest" s={sortKey} d={sortDir} t={toggleSort} label="Tok/Req" />
                <STh k="cost" s={sortKey} d={sortDir} t={toggleSort} label="Cost" />
                <STh k="costPerRequest" s={sortKey} d={sortDir} t={toggleSort} label="$/Req" />
                <STh k="inputCost" s={sortKey} d={sortDir} t={toggleSort} label="Input $" />
                <STh k="outputCost" s={sortKey} d={sortDir} t={toggleSort} label="Output $" />
                {/* Activity + Providers after costs */}
                <th className="px-3 py-2 text-center resizable-th" title={TOOLTIPS.activity}>Activity</th>
                <th className="px-3 py-2 text-center resizable-th" title="Активность по дням за весь период">Daily</th>
                <th className="px-3 py-2 text-center resizable-th" style={{ minWidth: 160 }} title={TOOLTIPS.providers}>Providers</th>
                {/* Latency block */}
                <STh k="avgLatency" s={sortKey} d={sortDir} t={toggleSort} label="Latency" bold />
                <STh k="avgTtft" s={sortKey} d={sortDir} t={toggleSort} label="TTFT" />
                {/* Remaining */}
                <STh k="uniqueModels" s={sortKey} d={sortDir} t={toggleSort} label="Models" />
                <STh k="requestsPerDay" s={sortKey} d={sortDir} t={toggleSort} label="Req/Day" />
                <STh k="outputRatio" s={sortKey} d={sortDir} t={toggleSort} label="Output %" />
                <STh k="activeDays" s={sortKey} d={sortDir} t={toggleSort} label="Days" />
                <STh k="avgSessionMessages" s={sortKey} d={sortDir} t={toggleSort} label="Msg/Sess" />
                <STh k="longestSessionMessages" s={sortKey} d={sortDir} t={toggleSort} label="Max Sess" />
                <th className="px-3 py-2 text-left resizable-th" title={TOOLTIPS.topModel}>Top Model</th>
                <STh k="firstSeen" s={sortKey} d={sortDir} t={toggleSort} label="First" />
                <STh k="lastSeen" s={sortKey} d={sortDir} t={toggleSort} label="Last" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e293b]">
              {sorted.map((e, i) => {
                const initial = e.displayName.startsWith('@') ? e.displayName[1]?.toUpperCase() : e.displayName[0]?.toUpperCase();
                return (
                  <tr key={e.name} className="hover:bg-[#1f2937] transition-colors cursor-pointer" onClick={() => setSelectedUser(e.name)}>
                    <td className="px-3 py-2 sticky left-0 bg-[#111827] z-10">
                      <span className={i === 0 ? 'rank-gold font-bold text-lg' : i === 1 ? 'rank-silver font-bold text-lg' : i === 2 ? 'rank-bronze font-bold text-lg' : 'text-gray-500'}>{i + 1}</span>
                    </td>
                    <td className="px-3 py-2 sticky left-10 bg-[#111827] z-10">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white text-xs font-bold shrink-0">{initial}</div>
                        <span className="font-medium text-white text-sm"><UserName name={e.displayName} /></span>
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
                    {/* Activity sparkline */}
                    <td className="px-4 py-2 text-center">
                      {e.hourlyActivity ? (
                        <>
                          <MiniSparkline data={e.hourlyActivity} width={120} height={24} />
                          <div className="text-[10px] text-gray-600 mt-0.5">peak {formatHour(e.peakHour)}</div>
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
          </table>
        </div>
      </div>
      {selectedUser && (
        <UserProfileModal name={selectedUser} entry={entries.find(e => e.name === selectedUser)} onClose={() => setSelectedUser(null)} />
      )}
    </div>
  );
}

// --- Helper Components ---

function UserName({ name }: { name: string }) {
  if (name.startsWith('@')) return <><span className="text-gray-500">@</span>{name.slice(1)}</>;
  return <>{name}</>;
}

function CostVal({ n }: { n: number }) {
  const formatted = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return <><span className="text-gray-500">$</span>{formatted}</>;
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
  return <th className={`px-3 py-2 text-left sticky ${left} bg-[#111827] z-10 resizable-th`} title={tip}>{children}</th>;
}

function STh({ k, s, d, t, label, bold }: { k: SortKey; s: SortKey; d: SortDir; t: (k: SortKey) => void; label?: string; bold?: boolean }) {
  const isActive = s === k;
  const displayLabel = label ?? k.charAt(0).toUpperCase() + k.slice(1);
  return (
    <th
      className={`px-3 py-2 text-right cursor-pointer select-none hover:text-cyan-400 transition-colors resizable-th ${isActive ? 'text-cyan-400' : ''} ${bold ? 'font-bold text-yellow-400' : ''}`}
      onClick={() => t(k)}
      title={TOOLTIPS[k] ?? ''}
    >
      <span className="inline-flex items-center gap-1">
        {displayLabel}
        {isActive && (d === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
      </span>
    </th>
  );
}

function Td({ children, c }: { children: React.ReactNode; c: string }) {
  return <td className={`px-3 py-2 text-right font-mono text-sm ${c}`}>{children}</td>;
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4 card-glow transition-shadow">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs text-gray-500 uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-xl md:text-2xl font-bold text-white">{value}</p>
    </div>
  );
}
