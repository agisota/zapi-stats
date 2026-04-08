import { useQuery } from '@tanstack/react-query';
import { getLeaderboard, getOverview } from '../../lib/api.ts';
import { formatNumber, formatCost, formatPercent, formatLatency, timeAgo, formatDate } from '../../lib/format.ts';
import { Trophy, Zap, Coins, Users, Hash } from 'lucide-react';

export function Leaderboard() {
  const { data: lb } = useQuery({ queryKey: ['leaderboard'], queryFn: getLeaderboard });
  const { data: ov } = useQuery({ queryKey: ['overview'], queryFn: getOverview });

  const overview = ov?.data;
  const entries = lb?.data ?? [];

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
        </div>

        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap">
            <thead>
              <tr className="text-xs text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-3 text-left sticky left-0 bg-[#111827] z-10">#</th>
                <th className="px-4 py-3 text-left sticky left-10 bg-[#111827] z-10">User</th>
                <th className="px-4 py-3 text-right">Requests</th>
                <th className="px-4 py-3 text-right">Input Tok</th>
                <th className="px-4 py-3 text-right">Output Tok</th>
                <th className="px-4 py-3 text-right">Cache Read</th>
                <th className="px-4 py-3 text-right">Cache Write</th>
                <th className="px-4 py-3 text-right">Reasoning</th>
                <th className="px-4 py-3 text-right">Total Tok</th>
                <th className="px-4 py-3 text-right">Tok/Req</th>
                <th className="px-4 py-3 text-right">Cost</th>
                <th className="px-4 py-3 text-right">Cost/Req</th>
                <th className="px-4 py-3 text-right">Input $</th>
                <th className="px-4 py-3 text-right">Output $</th>
                <th className="px-4 py-3 text-right">Avg Latency</th>
                <th className="px-4 py-3 text-right">Avg TTFT</th>
                <th className="px-4 py-3 text-right">Success</th>
                <th className="px-4 py-3 text-right">Errors</th>
                <th className="px-4 py-3 text-right">Models</th>
                <th className="px-4 py-3 text-right">Providers</th>
                <th className="px-4 py-3 text-left">Top Model</th>
                <th className="px-4 py-3 text-right">First Seen</th>
                <th className="px-4 py-3 text-right">Last Seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e293b]">
              {entries.map((e, i) => {
                const initial = e.displayName.startsWith('@')
                  ? e.displayName[1]?.toUpperCase()
                  : e.displayName[0]?.toUpperCase();

                return (
                  <tr key={e.name} className="hover:bg-[#1f2937] transition-colors">
                    <td className="px-4 py-3 sticky left-0 bg-[#111827] group-hover:bg-[#1f2937]">
                      <span className={
                        i === 0 ? 'rank-gold font-bold text-lg' :
                        i === 1 ? 'rank-silver font-bold text-lg' :
                        i === 2 ? 'rank-bronze font-bold text-lg' :
                        'text-gray-500'
                      }>
                        {i + 1}
                      </span>
                    </td>
                    <td className="px-4 py-3 sticky left-10 bg-[#111827]">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                          {initial}
                        </div>
                        <span className="font-medium text-white text-sm">{e.displayName}</span>
                      </div>
                    </td>
                    <Cell>{formatNumber(e.requests)}</Cell>
                    <Cell>{formatNumber(e.tokensIn)}</Cell>
                    <Cell>{formatNumber(e.tokensOut)}</Cell>
                    <Cell dim>{formatNumber(e.tokensCacheRead)}</Cell>
                    <Cell dim>{formatNumber(e.tokensCacheCreation)}</Cell>
                    <Cell dim>{formatNumber(e.tokensReasoning)}</Cell>
                    <Cell>{formatNumber(e.totalTokens)}</Cell>
                    <Cell dim>{formatNumber(e.tokensPerRequest)}</Cell>
                    <Cell color="amber">{formatCost(e.cost)}</Cell>
                    <Cell dim>{formatCost(e.costPerRequest)}</Cell>
                    <Cell dim>{formatCost(e.inputCost)}</Cell>
                    <Cell dim>{formatCost(e.outputCost)}</Cell>
                    <Cell>{formatLatency(e.avgLatency)}</Cell>
                    <Cell dim>{formatLatency(e.avgTtft)}</Cell>
                    <td className="px-4 py-3 text-right">
                      <span className={e.successRate >= 0.95 ? 'text-emerald-400' : e.successRate >= 0.8 ? 'text-amber-400' : 'text-red-400'}>
                        {formatPercent(e.successRate)}
                      </span>
                    </td>
                    <Cell color={e.errorCount > 0 ? 'red' : undefined}>{formatNumber(e.errorCount)}</Cell>
                    <Cell>{e.uniqueModels}</Cell>
                    <Cell>{e.uniqueProviders}</Cell>
                    <td className="px-4 py-3 text-sm text-gray-400 max-w-[180px] truncate">{e.topModel}</td>
                    <Cell dim>{formatDate(e.firstSeen)}</Cell>
                    <Cell dim>{timeAgo(e.lastSeen)}</Cell>
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

function Cell({ children, dim, color }: { children: React.ReactNode; dim?: boolean; color?: 'amber' | 'red' }) {
  const textColor = color === 'amber' ? 'text-amber-400' : color === 'red' ? 'text-red-400' : dim ? 'text-gray-500' : 'text-gray-300';
  return (
    <td className={`px-4 py-3 text-right font-mono text-sm ${textColor}`}>
      {children}
    </td>
  );
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
