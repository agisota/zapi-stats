import { useQuery } from '@tanstack/react-query';
import { getLeaderboard, getOverview } from '../../lib/api.ts';
import { formatNumber, formatCost, formatPercent, timeAgo } from '../../lib/format.ts';
import { Trophy, Zap, Coins, Users, Hash, TrendingUp } from 'lucide-react';

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
          <StatCard icon={<Coins className="w-5 h-5 text-amber-400" />} label="Est. Cost" value={formatCost(overview.totalCost)} />
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
          <table className="w-full">
            <thead>
              <tr className="text-xs text-gray-500 uppercase tracking-wider">
                <th className="px-6 py-3 text-left">#</th>
                <th className="px-6 py-3 text-left">User</th>
                <th className="px-6 py-3 text-right">Requests</th>
                <th className="px-6 py-3 text-right">Input Tokens</th>
                <th className="px-6 py-3 text-right">Output Tokens</th>
                <th className="px-6 py-3 text-right">Est. Cost</th>
                <th className="px-6 py-3 text-right">Success</th>
                <th className="px-6 py-3 text-left">Top Model</th>
                <th className="px-6 py-3 text-right">Last Seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e293b]">
              {entries.map((entry, i) => (
                <tr key={entry.name} className="hover:bg-[#1f2937] transition-colors">
                  <td className="px-6 py-3">
                    <span className={
                      i === 0 ? 'rank-gold font-bold text-lg' :
                      i === 1 ? 'rank-silver font-bold text-lg' :
                      i === 2 ? 'rank-bronze font-bold text-lg' :
                      'text-gray-500'
                    }>
                      {i + 1}
                    </span>
                  </td>
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white text-sm font-bold">
                        {entry.name[0]?.toUpperCase()}
                      </div>
                      <span className="font-medium text-white">{entry.name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-3 text-right font-mono text-sm text-gray-300">{formatNumber(entry.requests)}</td>
                  <td className="px-6 py-3 text-right font-mono text-sm text-gray-300">{formatNumber(entry.tokensIn)}</td>
                  <td className="px-6 py-3 text-right font-mono text-sm text-gray-300">{formatNumber(entry.tokensOut)}</td>
                  <td className="px-6 py-3 text-right font-mono text-sm text-amber-400">{formatCost(entry.cost)}</td>
                  <td className="px-6 py-3 text-right">
                    <span className={entry.successRate >= 0.95 ? 'text-emerald-400' : entry.successRate >= 0.8 ? 'text-amber-400' : 'text-red-400'}>
                      {formatPercent(entry.successRate)}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-sm text-gray-400 max-w-[200px] truncate">{entry.topModel}</td>
                  <td className="px-6 py-3 text-right text-sm text-gray-500">{timeAgo(entry.lastSeen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
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
