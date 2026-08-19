import { useQuery } from '@tanstack/react-query';
import { getModelStats, getObservedActivity, getOverview, getProviderStats, getTimeline } from '../../lib/api.ts';
import { formatNumber, formatCost, formatLatency, formatPercent } from '../../lib/format.ts';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area } from 'recharts';
import { BarChart3, Globe, Clock } from 'lucide-react';

const COLORS = ['#06b6d4', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444', '#ec4899', '#6366f1', '#14b8a6'];

export function StatsPage() {
  const { data: overview } = useQuery({ queryKey: ['overview'], queryFn: getOverview });
  const { data: observed } = useQuery({ queryKey: ['observed-activity'], queryFn: getObservedActivity });
  const { data: models } = useQuery({ queryKey: ['models'], queryFn: getModelStats });
  const { data: providers } = useQuery({ queryKey: ['providers'], queryFn: getProviderStats });
  const { data: timeline } = useQuery({ queryKey: ['timeline', '7d'], queryFn: () => getTimeline('7d') });

  return (
    <div className="space-y-6">
      {overview?.data && (
        <div className="bg-[#111827] border border-cyan-900/60 rounded-xl p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="font-semibold text-white">Recovered API history</h3>
              <p className="text-xs text-gray-500 mt-1">
                Sanitized historical usage included in the API totals.
              </p>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wider text-gray-500">Recovered requests</div>
              <div className="text-2xl font-semibold text-cyan-300">{formatNumber(overview.data.recoveredHistory.rows)}</div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5 text-sm">
            <ObservedMetric label="API requests total" value={formatNumber(overview.data.totalRequests)} />
            <ObservedMetric label="API input tokens total" value={formatNumber(overview.data.totalTokensIn)} />
            <ObservedMetric
              label="Recovered period"
              value={`${formatObservedDate(overview.data.recoveredHistory.firstSeen)} — ${formatObservedDate(overview.data.recoveredHistory.lastSeen)}`}
            />
          </div>
        </div>
      )}
      {observed?.data && (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-6">
          <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
            <div>
              <h3 className="font-semibold text-white">Observed Activity</h3>
              <p className="text-xs text-gray-500 mt-1">{observed.data.note}</p>
              {(observed.data.telemetry.firstSeen || observed.data.telemetry.lastSeen) && (
                <p className="text-xs text-gray-500 mt-2">
                  Telemetry coverage: {formatObservedDate(observed.data.telemetry.firstSeen)} — {formatObservedDate(observed.data.telemetry.lastSeen)}
                </p>
              )}
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wider text-gray-500">Combined observed events</div>
              <div className="text-2xl font-semibold text-cyan-300">{formatNumber(observed.data.observedEventsTotal)}</div>
            </div>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 text-sm">
            <ObservedMetric label="OmniRoute API requests" value={formatNumber(observed.data.api.requests)} />
            <ObservedMetric label="Telemetry events" value={formatNumber(observed.data.telemetry.events)} />
            <ObservedMetric label="Observed tokens" value={formatNumber(observed.data.observedTokensTotal)} />
            <ObservedMetric label="API cost" value={formatCost(observed.data.api.cost)} />
            <ObservedMetric label="Recorded telemetry cost" value={formatCost(observed.data.telemetry.recordedCost)} />
          </div>
          {observed.data.telemetry.lanes.length > 0 && (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 uppercase tracking-wider">
                    <th className="py-2 text-left">Telemetry lane</th>
                    <th className="py-2 text-right">Events</th>
                    <th className="py-2 text-right">Tokens</th>
                    <th className="py-2 text-right">Recorded cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e293b]">
                  {observed.data.telemetry.lanes.map(lane => (
                    <tr key={lane.lane}>
                      <td className="py-2 text-gray-300">{lane.lane}</td>
                      <td className="py-2 text-right font-mono text-gray-300">{formatNumber(lane.events)}</td>
                      <td className="py-2 text-right font-mono text-gray-300">{formatNumber(lane.totalTokens)}</td>
                      <td className="py-2 text-right font-mono text-amber-400">{formatCost(lane.recordedCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Timeline */}
      {timeline?.data && timeline.data.length > 0 && (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-5 h-5 text-cyan-400" />
            <h3 className="font-semibold text-white">Request Timeline (7d)</h3>
          </div>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={timeline.data}>
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
              <Area type="monotone" dataKey="requests" stroke="#06b6d4" fill="url(#colorReq)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Model distribution */}
        {models?.data && (
          <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="w-5 h-5 text-purple-400" />
              <h3 className="font-semibold text-white">Models</h3>
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={models.data.slice(0, 10)} layout="vertical">
                <XAxis type="number" stroke="#64748b" fontSize={11} />
                <YAxis type="category" dataKey="model" width={180} stroke="#64748b" fontSize={10} tick={{ fill: '#94a3b8' }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                  formatter={(v: number) => formatNumber(v)}
                />
                <Bar dataKey="count" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Provider split */}
        {providers?.data && (
          <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <Globe className="w-5 h-5 text-emerald-400" />
              <h3 className="font-semibold text-white">Providers</h3>
            </div>
            <div className="flex items-center gap-8">
              <ResponsiveContainer width="50%" height={250}>
                <PieChart>
                  <Pie
                    data={providers.data}
                    dataKey="count"
                    nameKey="provider"
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={90}
                    paddingAngle={2}
                  >
                    {providers.data.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2 flex-1">
                {providers.data.map((p, i) => (
                  <div key={p.provider} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                      <span className="text-gray-300">{p.provider}</span>
                    </div>
                    <div className="flex items-center gap-4 text-gray-500">
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

      {/* Model details table */}
      {models?.data && (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-[#1e293b]">
            <h3 className="font-semibold text-white">Model Details</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-xs text-gray-500 uppercase tracking-wider">
                  <th className="px-6 py-3 text-left">Model</th>
                  <th className="px-6 py-3 text-right">Requests</th>
                  <th className="px-6 py-3 text-right">Input Tokens</th>
                  <th className="px-6 py-3 text-right">Output Tokens</th>
                  <th className="px-6 py-3 text-right">Avg Latency</th>
                  <th className="px-6 py-3 text-right">Est. Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e293b]">
                {models.data.map(m => (
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
function formatObservedDate(value: string | null): string {
  if (!value) return 'unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
}

function ObservedMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[#0a0e1a] border border-[#1e293b] p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 font-mono text-gray-200">{value}</div>
    </div>
  );
}
