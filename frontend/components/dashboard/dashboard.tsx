import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../lib/auth-context.tsx';
import { getUserStats, getUserModels } from '../../lib/api.ts';
import { formatNumber, formatCost, formatPercent, formatLatency } from '../../lib/format.ts';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { User, Zap, Hash, Coins, Activity, Clock } from 'lucide-react';

const COLORS = ['#06b6d4', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444', '#ec4899'];

export function Dashboard() {
  const { apiKey, keyName } = useAuth();

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

  const user = stats?.data;
  const userModels = models?.data ?? [];

  return (
    <div className="space-y-6">
      {/* User header */}
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white text-xl font-bold">
          {keyName?.[0]?.toUpperCase()}
        </div>
        <div>
          <h2 className="text-2xl font-bold text-white">{keyName}</h2>
          <p className="text-sm text-gray-500">Personal Dashboard</p>
        </div>
      </div>

      {/* Stats cards */}
      {user && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <DashCard icon={<Zap className="w-4 h-4 text-cyan-400" />} label="Requests" value={formatNumber(user.requests)} />
          <DashCard icon={<Hash className="w-4 h-4 text-purple-400" />} label="Input Tokens" value={formatNumber(user.tokensIn)} />
          <DashCard icon={<Hash className="w-4 h-4 text-blue-400" />} label="Output Tokens" value={formatNumber(user.tokensOut)} />
          <DashCard icon={<Coins className="w-4 h-4 text-amber-400" />} label="Est. Cost" value={formatCost(user.cost)} />
          <DashCard icon={<Activity className="w-4 h-4 text-emerald-400" />} label="Success Rate" value={formatPercent(user.successRate)} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Models breakdown */}
        {userModels.length > 0 && (
          <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-6">
            <h3 className="font-semibold text-white mb-4">Your Models</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={userModels.slice(0, 8)} layout="vertical">
                <XAxis type="number" stroke="#64748b" fontSize={11} />
                <YAxis type="category" dataKey="model" width={160} stroke="#64748b" fontSize={10} tick={{ fill: '#94a3b8' }} />
                <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }} />
                <Bar dataKey="count" fill="#06b6d4" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Provider split */}
        {user?.providers && user.providers.length > 0 && (
          <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-6">
            <h3 className="font-semibold text-white mb-4">Your Providers</h3>
            <div className="flex items-center gap-6">
              <ResponsiveContainer width="50%" height={200}>
                <PieChart>
                  <Pie data={user.providers} dataKey="count" nameKey="provider" cx="50%" cy="50%" innerRadius={40} outerRadius={75} paddingAngle={2}>
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

      {/* Activity info */}
      {user && (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-6">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-4 h-4 text-gray-500" />
            <h3 className="font-semibold text-white text-sm">Activity</h3>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-gray-500">First seen</span>
              <p className="text-gray-300">{new Date(user.firstSeen).toLocaleDateString('ru')}</p>
            </div>
            <div>
              <span className="text-gray-500">Last seen</span>
              <p className="text-gray-300">{new Date(user.lastSeen).toLocaleDateString('ru')}</p>
            </div>
            <div>
              <span className="text-gray-500">Avg latency</span>
              <p className="text-gray-300">{formatLatency(user.avgLatency)}</p>
            </div>
            <div>
              <span className="text-gray-500">Models used</span>
              <p className="text-gray-300">{user.models.length}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DashCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4">
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <p className="text-xl font-bold text-white">{value}</p>
    </div>
  );
}
