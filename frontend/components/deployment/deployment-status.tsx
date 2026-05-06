import { useQuery } from '@tanstack/react-query';
import { Activity, Cpu, Database, GitBranch, RadioTower, Server, Zap } from 'lucide-react';
import { getDeploymentStatus } from '../../lib/api.ts';
import { formatNumber } from '../../lib/format.ts';
import { SkeletonBlock, StatePanel, UpdatedAt } from '../ui/feedback.tsx';

function formatUptime(seconds: number | null) {
  if (!seconds || seconds < 0) return 'нет данных';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} д ${hours} ч`;
  if (hours > 0) return `${hours} ч ${minutes} мин`;
  return `${minutes} мин`;
}

function formatMemory(bytes: number | null) {
  if (!bytes) return 'нет данных';
  return `${Math.round(bytes / 1024 / 1024)} МБ`;
}

export function DeploymentStatus() {
  const { data, isError, isLoading } = useQuery({
    queryKey: ['deployment-status'],
    queryFn: getDeploymentStatus,
    refetchInterval: 30_000,
  });

  const status = data?.data;
  const healthy = status?.status === 'healthy';
  const statusLabel = healthy ? 'стабильно' : status?.status ? 'проверить' : (isError ? 'недоступен' : 'проверка');
  const providerValue = status?.providerSummary.activeCount == null || status?.providerSummary.configuredCount == null
    ? 'загрузка'
    : `${status.providerSummary.activeCount}/${status.providerSummary.configuredCount}`;

  return (
    <section id="status" className="scroll-mt-28 border-b border-[#263044] bg-[#0d1322]/92" aria-label="Deployment health">
      <div className="max-w-[1700px] mx-auto px-4 py-3">
        <div className="mb-2 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-cyan-200/60">deployment health</div>
            <div className="mt-1 text-xs text-gray-500">Проверка живости API gateway, catalog и runtime без изменения backend-состояния.</div>
          </div>
          <UpdatedAt value={status?.checkedAt} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
          <Metric
            icon={<RadioTower className="w-4 h-4" />}
            label="Шлюз"
            value={isLoading && !status ? <SkeletonBlock className="h-4 w-20" /> : statusLabel}
            tone={healthy ? 'success' : 'warning'}
          />
          <Metric icon={<GitBranch className="w-4 h-4" />} label="Версия" value={status?.version ?? (isLoading ? <SkeletonBlock className="h-4 w-16" /> : 'нет ответа')} />
          <Metric icon={<Zap className="w-4 h-4" />} label="Модели" value={status?.modelCount == null ? (isLoading ? <SkeletonBlock className="h-4 w-14" /> : 'нет данных') : formatNumber(status.modelCount)} />
          <Metric icon={<Server className="w-4 h-4" />} label="Провайдеры" value={isLoading && !status ? <SkeletonBlock className="h-4 w-12" /> : providerValue} />
          <Metric icon={<Activity className="w-4 h-4" />} label="Подключения" value={status?.activeConnections == null ? (isLoading ? <SkeletonBlock className="h-4 w-10" /> : 'нет данных') : formatNumber(status.activeConnections)} />
          <Metric icon={<Database className="w-4 h-4" />} label="Каталог" value={status?.providerSummary.catalogCount == null ? (isLoading ? <SkeletonBlock className="h-4 w-12" /> : 'нет данных') : formatNumber(status.providerSummary.catalogCount)} />
          <Metric icon={<Cpu className="w-4 h-4" />} label="Память" value={isLoading && !status ? <SkeletonBlock className="h-4 w-14" /> : formatMemory(status?.memoryRss ?? null)} />
          <Metric icon={<Activity className="w-4 h-4" />} label="Время работы" value={isLoading && !status ? <SkeletonBlock className="h-4 w-16" /> : formatUptime(status?.uptime ?? null)} />
        </div>
        {isError && (
          <div className="mt-3">
            <StatePanel state="error" title="Статус deployment не загрузился" compact>
              Dashboard продолжает показывать уже загруженные публичные данные, но health-сигналы сейчас недоступны от `/api/deployment/status`.
            </StatePanel>
          </div>
        )}
        {status?.error && !isError && (
          <div className="mt-3">
            <StatePanel state="partial" title="Deployment status загружен частично" compact>
              Runtime вернул данные с предупреждением: {status.error}
            </StatePanel>
          </div>
        )}
      </div>
    </section>
  );
}

function Metric({
  icon,
  label,
  value,
  tone = 'neutral',
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  tone?: 'neutral' | 'success' | 'warning';
}) {
  const toneClass = tone === 'success'
    ? 'text-emerald-300'
    : tone === 'warning'
      ? 'text-amber-300'
      : 'text-cyan-200';

  return (
    <div className="status-strip-card rounded-lg border px-3 py-2 transition-colors">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-gray-500">
        <span className={toneClass}>{icon}</span>
        <span>{label}</span>
      </div>
      <div className={`mt-1 min-h-5 truncate font-mono text-sm font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}
