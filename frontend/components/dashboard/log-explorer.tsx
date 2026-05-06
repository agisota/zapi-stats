import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownUp, BadgeDollarSign, Braces, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Database, FileSearch, Filter, GitBranch, Route, Search, Server, ShieldCheck, Sparkles, X, XCircle } from 'lucide-react';
import {
  getUserLogDetail,
  getUserLogFacets,
  getUserLogs,
  getUserSessions,
  type TraceStep,
  type UserLogDetail,
  type UserLogEntry,
  type UserLogQuery,
} from '../../lib/api.ts';
import { formatLatency, formatNumber, formatPercent, timeAgo } from '../../lib/format.ts';
import { modelLabel } from '../../lib/display.ts';

const LIMIT = 30;

export function LogExplorer({ apiKey }: { apiKey: string }) {
  const [query, setQuery] = useState<UserLogQuery>({ limit: LIMIT, offset: 0, sort: 'timestamp', order: 'desc' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const offset = query.offset ?? 0;

  const { data: logs, isFetching } = useQuery({
    queryKey: ['user-logs', apiKey, query],
    queryFn: () => getUserLogs(apiKey, query),
  });

  const { data: facets } = useQuery({
    queryKey: ['user-log-facets', apiKey],
    queryFn: () => getUserLogFacets(apiKey),
  });

  const { data: sessions } = useQuery({
    queryKey: ['user-sessions', apiKey],
    queryFn: () => getUserSessions(apiKey),
  });

  const { data: detail } = useQuery({
    queryKey: ['user-log-detail', apiKey, selectedId],
    queryFn: () => getUserLogDetail(apiKey, selectedId!),
    enabled: Boolean(selectedId),
  });

  const items = logs?.data.items ?? logs?.data.logs ?? [];
  const total = logs?.data.total ?? 0;
  const currentSession = sessions?.data?.[0];
  const maxOffset = Math.max(0, total - LIMIT);

  const sessionScore = useMemo(() => {
    if (!currentSession) return 0;
    return Math.round(currentSession.requests * currentSession.successRate);
  }, [currentSession]);

  const patchQuery = (patch: Partial<UserLogQuery>) => setQuery(prev => ({ ...prev, ...patch, offset: 0 }));

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 grid-flow-dense">
      <section className="xl:col-span-4 rounded-2xl border border-[#223049] bg-[#111827] p-5">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2 text-cyan-200">
              <Database className="w-4 h-4" />
              <span className="text-xs uppercase tracking-[0.18em] text-cyan-200/70">Сессии</span>
            </div>
            <h3 className="mt-1 text-lg font-semibold text-white">Последние сессии</h3>
          </div>
          <div className="rounded-full border border-cyan-300/15 px-3 py-1 text-xs font-mono text-cyan-100">очки {formatNumber(sessionScore)}</div>
        </div>

        <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
          {(sessions?.data ?? []).slice(0, 12).map(session => (
            <div key={session.id} className="rounded-xl border border-[#263044] bg-[#0b1220] p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white">{timeAgo(session.lastSeen)}</div>
                  <div className="mt-1 truncate text-xs text-gray-500">{modelLabel(session.topProvider, session.topModel)}</div>
                </div>
                <div className={session.successRate >= 0.9 ? 'text-emerald-300 text-xs font-mono' : 'text-amber-300 text-xs font-mono'}>
                  {formatPercent(session.successRate)}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                <MiniMetric label="запросы" value={formatNumber(session.requests)} />
                <MiniMetric label="задержка" value={formatLatency(session.avgLatency)} />
                <MiniMetric label="токены" value={formatNumber(session.tokensIn + session.tokensOut)} />
              </div>
              {session.lastSummary && <div className="mt-3 line-clamp-2 text-xs text-gray-400">{session.lastSummary}</div>}
            </div>
          ))}
        </div>
      </section>

      <section className="xl:col-span-8 rounded-2xl border border-[#223049] bg-[#111827] overflow-hidden">
        <div className="p-5 border-b border-[#223049]">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-cyan-200">
                <FileSearch className="w-4 h-4" />
                <span className="text-xs uppercase tracking-[0.18em] text-cyan-200/70">История запросов</span>
              </div>
              <h3 className="mt-1 text-lg font-semibold text-white">Все логи ключа</h3>
            </div>
            <div className="text-xs text-gray-500">
              {formatNumber(total)} записей
              {isFetching && <span className="ml-2 text-cyan-300">обновляем</span>}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-12 gap-3">
            <label className="md:col-span-4 flex items-center gap-2 rounded-lg border border-[#263044] bg-[#0a0e1a] px-3 py-2">
              <Search className="w-4 h-4 text-gray-500" />
              <input
                value={query.q ?? ''}
                onChange={event => patchQuery({ q: event.currentTarget.value })}
                placeholder="Поиск по модели, пути, описанию или ошибке"
                className="w-full bg-transparent text-sm text-white placeholder:text-gray-600 outline-none"
              />
            </label>
            <Select label="Провайдер" value={query.provider ?? ''} onChange={value => patchQuery({ provider: value })} options={facets?.data.providers ?? []} />
            <Select label="Модель" value={query.model ?? ''} onChange={value => patchQuery({ model: value })} options={facets?.data.models ?? []} wide />
            <select
              value={query.status ?? ''}
              onChange={event => patchQuery({ status: event.currentTarget.value as UserLogQuery['status'] })}
              className="md:col-span-2 rounded-lg border border-[#263044] bg-[#0a0e1a] px-3 py-2 text-sm text-gray-200 outline-none"
            >
              <option value="">Любой статус</option>
              <option value="success">Успешно</option>
              <option value="error">Ошибка</option>
            </select>
            <button
              onClick={() => setQuery({ limit: LIMIT, offset: 0, sort: 'timestamp', order: 'desc' })}
              className="md:col-span-1 inline-flex items-center justify-center rounded-lg border border-[#263044] text-gray-400 hover:text-white hover:border-cyan-300/30"
              title="Сбросить фильтры"
            >
              <Filter className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap">
            <thead className="text-xs uppercase tracking-wide text-gray-600">
              <tr>
                <SortHead label="Время" active={query.sort === 'timestamp'} onClick={() => setQuery(toggleSort(query, 'timestamp'))} />
                <SortHead label="Статус" active={query.sort === 'status'} onClick={() => setQuery(toggleSort(query, 'status'))} />
                <SortHead label="Модель" active={query.sort === 'model'} onClick={() => setQuery(toggleSort(query, 'model'))} />
                <SortHead label="Провайдер" active={query.sort === 'provider'} onClick={() => setQuery(toggleSort(query, 'provider'))} />
                <SortHead label="Задержка" active={query.sort === 'duration'} onClick={() => setQuery(toggleSort(query, 'duration'))} />
                <SortHead label="Токены" active={query.sort === 'tokens'} onClick={() => setQuery(toggleSort(query, 'tokens'))} />
                <th className="px-4 py-3 text-left">Описание</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e293b]">
              {items.map(item => <LogRow key={item.id} item={item} onClick={() => setSelectedId(item.id)} />)}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-[#223049] px-5 py-3">
          <button
            disabled={offset === 0}
            onClick={() => setQuery(prev => ({ ...prev, offset: Math.max(0, offset - LIMIT) }))}
            className="inline-flex items-center gap-2 rounded-lg border border-[#263044] px-3 py-1.5 text-sm text-gray-300 disabled:opacity-35"
          >
            <ChevronLeft className="w-4 h-4" />
            Назад
          </button>
          <div className="text-xs text-gray-500">{formatNumber(offset + 1)}-{formatNumber(Math.min(offset + LIMIT, total))} из {formatNumber(total)}</div>
          <button
            disabled={offset >= maxOffset}
            onClick={() => setQuery(prev => ({ ...prev, offset: Math.min(maxOffset, offset + LIMIT) }))}
            className="inline-flex items-center gap-2 rounded-lg border border-[#263044] px-3 py-1.5 text-sm text-gray-300 disabled:opacity-35"
          >
            Дальше
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </section>

      {selectedId && <DetailPanel detail={detail?.data} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

function LogRow({ item, onClick }: { item: UserLogEntry; onClick: () => void }) {
  const tokens = item.tokensIn + item.tokensOut + item.tokensCacheRead + item.tokensReasoning;
  return (
    <tr className="cursor-pointer hover:bg-[#1f2937]" onClick={onClick}>
      <td className="px-4 py-3 text-sm text-gray-400">{timeAgo(item.timestamp)}</td>
      <td className="px-4 py-3">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs ${item.success ? 'bg-emerald-300/10 text-emerald-200' : 'bg-red-300/10 text-red-200'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${item.success ? 'bg-emerald-300' : 'bg-red-400'}`} />
          {item.status ?? 'нет'}
        </span>
      </td>
      <td className="max-w-[220px] truncate px-4 py-3 text-sm text-gray-200">{modelLabel(item.provider, item.model)}</td>
      <td className="px-4 py-3 text-sm text-gray-400">{item.provider ?? 'нет данных'}</td>
      <td className="px-4 py-3 text-sm font-mono text-cyan-100">{formatLatency(item.duration)}</td>
      <td className="px-4 py-3 text-sm font-mono text-gray-300">{formatNumber(tokens)}</td>
      <td className="max-w-[320px] truncate px-4 py-3 text-sm text-gray-500">{item.error ?? item.requestSummary ?? item.path ?? item.id}</td>
    </tr>
  );
}

function DetailPanel({ detail, onClose }: { detail?: UserLogDetail; onClose: () => void }) {
  return (
    <aside className="fixed right-0 top-0 z-[70] h-screen w-full max-w-2xl border-l border-[#263044] bg-[#0a0e1a] shadow-2xl">
      <div className="flex h-14 items-center justify-between border-b border-[#263044] px-5">
        <div>
          <div className="text-sm font-semibold text-white">Детали запроса</div>
          <div className="text-xs text-gray-500">{detail?.id ?? 'загрузка'}</div>
        </div>
        <button onClick={onClose} className="rounded-lg p-2 text-gray-500 hover:bg-[#111827] hover:text-white">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="h-[calc(100vh-3.5rem)] overflow-y-auto p-5">
        {detail ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <MiniMetric label="модель" value={modelLabel(detail.provider, detail.model)} />
              <MiniMetric label="провайдер" value={detail.provider ?? 'нет данных'} />
              <MiniMetric label="статус" value={String(detail.status ?? 'нет')} />
              <MiniMetric label="задержка" value={formatLatency(detail.duration)} />
            </div>
            <TraceReplay detail={detail} />
            {detail.requestSummary && <InfoBlock title="Описание" value={detail.requestSummary} />}
            {detail.error && <InfoBlock title="Ошибка" value={detail.error} tone="error" />}
            <details className="rounded-xl border border-[#263044] bg-[#111827] p-4">
              <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-gray-300">
                <Braces className="h-4 w-4 text-cyan-200/70" />
                Очищенный JSON debug
              </summary>
              <pre className="mt-3 max-h-[420px] overflow-auto whitespace-pre-wrap break-words text-xs text-gray-400">
                {JSON.stringify({ detail: detail.detail, artifact: detail.artifact.preview }, null, 2)}
              </pre>
            </details>
          </div>
        ) : (
          <div className="text-sm text-gray-500">Загружаем детали...</div>
        )}
      </div>
    </aside>
  );
}

function TraceReplay({ detail }: { detail: UserLogDetail }) {
  const steps = detail.trace ?? [];
  const duration = detail.duration > 0 ? formatLatency(detail.duration) : 'нет данных';
  return (
    <section className="trace-panel rounded-xl border border-cyan-300/15 bg-[#101827] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-cyan-200">
            <Sparkles className="h-4 w-4" />
            <span className="text-xs uppercase tracking-[0.18em] text-cyan-200/70">Agent trace</span>
          </div>
          <h3 className="mt-1 text-base font-semibold text-white">Визуальный replay запроса</h3>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-white/10 bg-white/[0.035] px-2.5 py-1 text-gray-300">{steps.length} steps</span>
          <span className="rounded-full border border-cyan-300/15 bg-cyan-300/8 px-2.5 py-1 text-cyan-100">{duration}</span>
        </div>
      </div>

      <div className="trace-timeline mt-4">
        {steps.map((step, index) => (
          <TraceCard key={step.id} step={step} index={index} total={steps.length} />
        ))}
      </div>
    </section>
  );
}

function TraceCard({ step, index, total }: { step: TraceStep; index: number; total: number }) {
  const Icon = traceIcon(step);
  return (
    <article className={`trace-card trace-card-${step.status}`}>
      <div className="trace-node">
        <Icon className="h-4 w-4" />
      </div>
      {index < total - 1 && <div className="trace-connector" />}
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-white">{step.title}</div>
            <div className="mt-1 truncate text-xs text-gray-400" title={step.summary}>{step.summary}</div>
          </div>
          <div className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] text-gray-400">
            {step.durationMs == null ? `#${index + 1}` : formatLatency(step.durationMs)}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {step.meta.slice(0, 3).map(meta => (
            <span key={`${step.id}-${meta.label}`} className="rounded-full border border-white/10 bg-[#07111f] px-2 py-1 text-[10px] text-cyan-100">
              {meta.label}: <span className="text-gray-300">{meta.value}</span>
            </span>
          ))}
        </div>
        <div className="trace-hover-card">
          <div className="text-xs font-semibold text-white">Что произошло</div>
          <div className="mt-1 text-xs leading-5 text-gray-300">{step.detail}</div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {step.meta.map(meta => (
              <div key={`${step.id}-hover-${meta.label}`} className="rounded-lg border border-white/10 bg-[#07111f] px-2 py-1">
                <div className="text-[9px] uppercase tracking-wide text-gray-600">{meta.label}</div>
                <div className="mt-0.5 truncate text-[11px] text-cyan-100" title={meta.value}>{meta.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}

function traceIcon(step: TraceStep) {
  if (step.status === 'error') return XCircle;
  if (step.kind === 'request') return Route;
  if (step.kind === 'auth') return ShieldCheck;
  if (step.kind === 'routing') return GitBranch;
  if (step.kind === 'model_call') return Server;
  if (step.kind === 'billing') return BadgeDollarSign;
  if (step.kind === 'response') return step.status === 'success' ? CheckCircle2 : Clock3;
  return Clock3;
}

function Select({ label, value, onChange, options, wide = false }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; count: number }>;
  wide?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={event => onChange(event.currentTarget.value)}
      className={`${wide ? 'md:col-span-3' : 'md:col-span-2'} rounded-lg border border-[#263044] bg-[#0a0e1a] px-3 py-2 text-sm text-gray-200 outline-none`}
      title={label}
    >
      <option value="">{label}</option>
      {options.map(option => <option key={option.value} value={option.value}>{option.value} ({option.count})</option>)}
    </select>
  );
}

function SortHead({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <th className="px-4 py-3 text-left">
      <button onClick={onClick} className={active ? 'inline-flex items-center gap-1 text-cyan-200' : 'inline-flex items-center gap-1 hover:text-gray-300'}>
        {label}
        <ArrowDownUp className="w-3 h-3" />
      </button>
    </th>
  );
}

function toggleSort(query: UserLogQuery, sort: NonNullable<UserLogQuery['sort']>): UserLogQuery {
  const order = query.sort === sort && query.order === 'desc' ? 'asc' : 'desc';
  return { ...query, sort, order, offset: 0 };
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#263044] bg-[#0a0e1a] px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wide text-gray-600">{label}</div>
      <div className="mt-1 truncate font-mono text-xs text-cyan-100" title={value}>{value}</div>
    </div>
  );
}

function InfoBlock({ title, value, tone = 'neutral', pre = false }: { title: string; value: string; tone?: 'neutral' | 'error'; pre?: boolean }) {
  return (
    <div className="rounded-xl border border-[#263044] bg-[#111827] p-4">
      <div className={tone === 'error' ? 'text-sm font-semibold text-red-200' : 'text-sm font-semibold text-white'}>{title}</div>
      {pre ? (
        <pre className="mt-3 max-h-[420px] overflow-auto whitespace-pre-wrap break-words text-xs text-gray-400">{value}</pre>
      ) : (
        <div className="mt-2 text-sm text-gray-400">{value}</div>
      )}
    </div>
  );
}
