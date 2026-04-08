import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getLeaderboard, getOverview, type LeaderboardEntry } from '../../lib/api.ts';
import { formatNumber, formatCost, formatPercent, formatLatency, timeAgo, formatDate, formatHour, formatDecimal } from '../../lib/format.ts';
import { Trophy, Zap, Coins, Users, Hash, ArrowUp, ArrowDown } from 'lucide-react';

type SortKey = keyof LeaderboardEntry;
type SortDir = 'asc' | 'desc';

export function Leaderboard() {
  const { data: lb } = useQuery({ queryKey: ['leaderboard'], queryFn: getLeaderboard });
  const { data: ov } = useQuery({ queryKey: ['overview'], queryFn: getOverview });
  const [sortKey, setSortKey] = useState<SortKey>('requests');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const overview = ov?.data;
  const entries = lb?.data ?? [];

  // Sort
  const sorted = useMemo(() => {
    const arr = [...entries];
    arr.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      const sa = String(av), sb = String(bv);
      return sortDir === 'asc' ? sa.localeCompare(sb) : sb.localeCompare(sa);
    });
    return arr;
  }, [entries, sortKey, sortDir]);

  // Compute min/max per numeric column for traffic light
  const ranges = useMemo(() => {
    if (entries.length === 0) return {} as Record<string, { min: number; max: number }>;
    const numKeys: SortKey[] = [
      'requests', 'tokensIn', 'tokensOut', 'tokensCacheRead', 'tokensCacheCreation',
      'tokensReasoning', 'totalTokens', 'tokensPerRequest', 'cost', 'costPerRequest',
      'inputCost', 'outputCost', 'avgLatency', 'avgTtft', 'uniqueModels', 'uniqueProviders',
      'requestsPerDay', 'outputRatio', 'peakHour', 'providerDiversity', 'activeDays',
      'avgSessionMessages', 'longestSessionMessages',
    ];
    const r: Record<string, { min: number; max: number }> = {};
    for (const k of numKeys) {
      const vals = entries.map(e => e[k] as number).filter(v => typeof v === 'number');
      r[k] = { min: Math.min(...vals), max: Math.max(...vals) };
    }
    return r;
  }, [entries]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  // Traffic light: low=blue, mid=white, high=green for "good" metrics; inverse for latency
  function trafficColor(key: string, value: number, inverse = false): string {
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
      {/* Overview cards */}
      {overview && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard icon={<Zap className="w-5 h-5 text-cyan-400" />} label="Requests" value={formatNumber(overview.totalRequests)} />
          <StatCard icon={<Hash className="w-5 h-5 text-purple-400" />} label="Input Tokens" value={formatNumber(overview.totalTokensIn)} />
          <StatCard icon={<Coins className="w-5 h-5 text-amber-400" />} label="Total Cost" value={formatCost(overview.totalCost)} />
          <StatCard icon={<Users className="w-5 h-5 text-emerald-400" />} label="Active Users" value={String(overview.activeKeys)} />
        </div>
      )}

      {/* Leaderboard table */}
      <div className="bg-[#111827] border border-[#1e293b] rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#1e293b] flex items-center gap-2">
          <Trophy className="w-5 h-5 text-amber-400" />
          <h2 className="text-lg font-semibold text-white">Leaderboard</h2>
          <span className="text-xs text-gray-500 ml-2">click headers to sort</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap">
            <thead>
              <tr className="text-xs text-gray-500 uppercase tracking-wider">
                <Th>#</Th>
                <Th>User</Th>
                <SortTh k="requests" label="Requests" current={sortKey} dir={sortDir} toggle={toggleSort} />
                <SortTh k="tokensIn" label="Input Tok" current={sortKey} dir={sortDir} toggle={toggleSort} />
                <SortTh k="tokensOut" label="Output Tok" current={sortKey} dir={sortDir} toggle={toggleSort} />
                <SortTh k="tokensCacheRead" label="Cache Read" current={sortKey} dir={sortDir} toggle={toggleSort} />
                <SortTh k="tokensCacheCreation" label="Cache Write" current={sortKey} dir={sortDir} toggle={toggleSort} />
                <SortTh k="tokensReasoning" label="Reasoning" current={sortKey} dir={sortDir} toggle={toggleSort} />
                <SortTh k="totalTokens" label="Total Tok" current={sortKey} dir={sortDir} toggle={toggleSort} />
                <SortTh k="tokensPerRequest" label="Tok/Req" current={sortKey} dir={sortDir} toggle={toggleSort} />
                <SortTh k="cost" label="Cost" current={sortKey} dir={sortDir} toggle={toggleSort} />
                <SortTh k="costPerRequest" label="$/Req" current={sortKey} dir={sortDir} toggle={toggleSort} />
                <SortTh k="inputCost" label="Input $" current={sortKey} dir={sortDir} toggle={toggleSort} />
                <SortTh k="outputCost" label="Output $" current={sortKey} dir={sortDir} toggle={toggleSort} />
                <SortTh k="avgLatency" label="Latency" current={sortKey} dir={sortDir} toggle={toggleSort} bold />
                <SortTh k="avgTtft" label="TTFT" current={sortKey} dir={sortDir} toggle={toggleSort} />
                <SortTh k="uniqueModels" label="Models" current={sortKey} dir={sortDir} toggle={toggleSort} />
                <SortTh k="uniqueProviders" label="Providers" current={sortKey} dir={sortDir} toggle={toggleSort} />
                <SortTh k="requestsPerDay" label="Req/Day" current={sortKey} dir={sortDir} toggle={toggleSort} />
                <SortTh k="outputRatio" label="Output %" current={sortKey} dir={sortDir} toggle={toggleSort} />
                <SortTh k="peakHour" label="Peak Hr" current={sortKey} dir={sortDir} toggle={toggleSort} />
                <SortTh k="providerDiversity" label="Diversity" current={sortKey} dir={sortDir} toggle={toggleSort} />
                <SortTh k="activeDays" label="Active Days" current={sortKey} dir={sortDir} toggle={toggleSort} />
                <SortTh k="avgSessionMessages" label="Msg/Session" current={sortKey} dir={sortDir} toggle={toggleSort} />
                <SortTh k="longestSessionMessages" label="Max Session" current={sortKey} dir={sortDir} toggle={toggleSort} />
                <Th>Top Model</Th>
                <SortTh k="firstSeen" label="First Seen" current={sortKey} dir={sortDir} toggle={toggleSort} />
                <SortTh k="lastSeen" label="Last Seen" current={sortKey} dir={sortDir} toggle={toggleSort} />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e293b]">
              {sorted.map((e, i) => {
                const initial = e.displayName.startsWith('@')
                  ? e.displayName[1]?.toUpperCase()
                  : e.displayName[0]?.toUpperCase();

                return (
                  <tr key={e.name} className="hover:bg-[#1f2937] transition-colors">
                    <td className="px-4 py-3">
                      <span className={
                        i === 0 ? 'rank-gold font-bold text-lg' :
                        i === 1 ? 'rank-silver font-bold text-lg' :
                        i === 2 ? 'rank-bronze font-bold text-lg' :
                        'text-gray-500'
                      }>
                        {i + 1}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                          {initial}
                        </div>
                        <span className="font-medium text-white text-sm">{e.displayName}</span>
                      </div>
                    </td>
                    <Td c={trafficColor('requests', e.requests)}>{formatNumber(e.requests)}</Td>
                    <Td c={trafficColor('tokensIn', e.tokensIn)}>{formatNumber(e.tokensIn)}</Td>
                    <Td c={trafficColor('tokensOut', e.tokensOut)}>{formatNumber(e.tokensOut)}</Td>
                    <Td c={trafficColor('tokensCacheRead', e.tokensCacheRead)}>{formatNumber(e.tokensCacheRead)}</Td>
                    <Td c={trafficColor('tokensCacheCreation', e.tokensCacheCreation)}>{formatNumber(e.tokensCacheCreation)}</Td>
                    <Td c={trafficColor('tokensReasoning', e.tokensReasoning)}>{formatNumber(e.tokensReasoning)}</Td>
                    <Td c={trafficColor('totalTokens', e.totalTokens)}>{formatNumber(e.totalTokens)}</Td>
                    <Td c={trafficColor('tokensPerRequest', e.tokensPerRequest)}>{formatNumber(e.tokensPerRequest)}</Td>
                    <Td c={trafficColor('cost', e.cost)}>{formatCost(e.cost)}</Td>
                    <Td c={trafficColor('costPerRequest', e.costPerRequest)}>{formatCost(e.costPerRequest)}</Td>
                    <Td c={trafficColor('inputCost', e.inputCost)}>{formatCost(e.inputCost)}</Td>
                    <Td c={trafficColor('outputCost', e.outputCost)}>{formatCost(e.outputCost)}</Td>
                    {/* Latency — bold, inverse traffic light (lower=better=green) */}
                    <td className={`px-4 py-3 text-right font-mono text-sm font-bold ${trafficColor('avgLatency', e.avgLatency, true)}`}>
                      {formatLatency(e.avgLatency)}
                    </td>
                    <Td c={trafficColor('avgTtft', e.avgTtft, true)}>{formatLatency(e.avgTtft)}</Td>
                    <Td c={trafficColor('uniqueModels', e.uniqueModels)}>{e.uniqueModels}</Td>
                    <Td c={trafficColor('uniqueProviders', e.uniqueProviders)}>{e.uniqueProviders}</Td>
                    <Td c={trafficColor('requestsPerDay', e.requestsPerDay)}>{formatDecimal(e.requestsPerDay, 1)}</Td>
                    <Td c={trafficColor('outputRatio', e.outputRatio)}>{formatPercent(e.outputRatio)}</Td>
                    <Td c={trafficColor('peakHour', e.peakHour)}>{formatHour(e.peakHour)}</Td>
                    <Td c={trafficColor('providerDiversity', e.providerDiversity)}>{formatDecimal(e.providerDiversity, 2)}</Td>
                    <Td c={trafficColor('activeDays', e.activeDays)}>{e.activeDays}</Td>
                    <Td c={trafficColor('avgSessionMessages', e.avgSessionMessages)}>{formatDecimal(e.avgSessionMessages, 1)}</Td>
                    <Td c={trafficColor('longestSessionMessages', e.longestSessionMessages)}>{e.longestSessionMessages}</Td>
                    <td className="px-4 py-3 text-sm text-gray-400 max-w-[180px] truncate">{e.topModel}</td>
                    <Td c="text-gray-500">{formatDate(e.firstSeen)}</Td>
                    <Td c="text-gray-500">{timeAgo(e.lastSeen)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-3 text-left">{children}</th>;
}

function SortTh({ k, label, current, dir, toggle, bold }: {
  k: SortKey; label: string; current: SortKey; dir: SortDir;
  toggle: (k: SortKey) => void; bold?: boolean;
}) {
  const isActive = current === k;
  return (
    <th
      className={`px-4 py-3 text-right cursor-pointer select-none hover:text-cyan-400 transition-colors ${isActive ? 'text-cyan-400' : ''} ${bold ? 'font-bold text-yellow-400' : ''}`}
      onClick={() => toggle(k)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {isActive && (dir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
      </span>
    </th>
  );
}

function Td({ children, c }: { children: React.ReactNode; c: string }) {
  return <td className={`px-4 py-3 text-right font-mono text-sm ${c}`}>{children}</td>;
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4 card-glow transition-shadow">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs text-gray-500 uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
    </div>
  );
}
