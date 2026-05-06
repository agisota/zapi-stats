import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Bell, ChevronDown, ChevronUp, Cpu, DollarSign, Eye, FileText, Gauge, Image as ImageIcon, Info, Radio, Route, SearchCheck, ShieldCheck, Signal, TimerReset } from 'lucide-react';
import { getModelAvailability, type AvailableModel, type ModelStat } from '../../lib/api.ts';
import { formatNumber, formatPercent } from '../../lib/format.ts';
import { MetricGuide, SkeletonBlock, StatePanel, UpdatedAt } from '../ui/feedback.tsx';

gsap.registerPlugin(ScrollTrigger);

const CLAUDE_FALLBACK: ModelStat[] = [
  fallbackModel('claude', 'Claude Opus'),
  fallbackModel('claude', 'Claude Sonnet'),
  fallbackModel('claude', 'Claude Haiku'),
];

const PREFERRED_STABLE = [
  /^gpt-5\.4$/i,
  /codex\/gpt-5\.4$/i,
  /cx\/gpt-5\.4$/i,
  /^gpt-5\.2$/i,
  /codex\/gpt-5\.2$/i,
  /cx\/gpt-5\.2$/i,
  /^glm-5-turbo$/i,
  /glm\/glm-5-turbo/i,
  /^grok-4\.20-reasoning$/i,
  /xai\/grok-4\.20-reasoning/i,
  /^gpt-5\.3-codex$/i,
  /codex\/gpt-5\.3-codex$/i,
  /^gpt-5\.3-codex-spark$/i,
  /codex\/gpt-5\.3-codex-spark$/i,
  /^deepseek-v4-pro$/i,
  /opencode-go\/deepseek-v4-pro/i,
  /^minimax-m2\.7$/i,
  /opencode-go\/minimax-m2\.7/i,
  /^qwen3\.6-plus$/i,
  /opencode-go\/qwen3\.6-plus/i,
  /^deepseek-v3p2$/i,
  /fireworks\/accounts\/fireworks\/models\/deepseek-v3p2/i,
];

export function ModelAvailability() {
  const rootRef = useRef<HTMLElement | null>(null);
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [showAllStable, setShowAllStable] = useState(false);
  const [showAllEndpoints, setShowAllEndpoints] = useState(false);
  const [inspectedEndpointAlias, setInspectedEndpointAlias] = useState<string | null>(null);
  const { data, isLoading, isError } = useQuery({ queryKey: ['model-availability'], queryFn: getModelAvailability, refetchInterval: 60_000 });
  const models = data?.data.available ?? [];
  const newModels = data?.data.newModels ?? [];
  const endpoints = data?.data.endpoints ?? [];
  const total = data?.data.total ?? 0;

  const { stable, unavailable } = useMemo(() => {
    const stableModels = dedupeByAlias([...models])
      .filter(model => !/claude-(opus|sonnet|haiku)/i.test(model.id))
      .sort((a, b) => preferredRank(a.alias) - preferredRank(b.alias) || Number(b.isNew) - Number(a.isNew) || (b.usageCount - a.usageCount))
      .slice(0, 12);

    const claudeModels = (data?.data.unavailable ?? []).slice(0, 3);

    return {
      stable: stableModels,
      unavailable: claudeModels.length > 0 ? claudeModels : CLAUDE_FALLBACK.map(toAvailableFallback),
    };
  }, [data?.data.unavailable, models]);

  const inspectedModel = useMemo(() => {
    const candidates = [...stable, ...newModels, ...unavailable];
    return candidates.find(model => model.id === inspectedId) ?? stable[0] ?? newModels[0] ?? unavailable[0] ?? null;
  }, [inspectedId, newModels, stable, unavailable]);

  useGSAP(() => {
    if (!rootRef.current) return;
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const cards = (rootRef.current as Element).querySelectorAll('[data-model-card]');
    gsap.fromTo(cards, { y: 14 }, {
      y: 0,
      duration: 0.42,
      stagger: 0.045,
      ease: 'power2.out',
      scrollTrigger: {
        trigger: rootRef.current,
        start: 'top 85%',
        once: true,
      },
    });
  }, { scope: rootRef });

  const visibleStable = showAllStable ? stable : stable.slice(0, 6);
  const hiddenStableCount = Math.max(0, stable.length - visibleStable.length);
  const visibleEndpoints = showAllEndpoints ? endpoints : endpoints.slice(0, 6);
  const hiddenEndpointCount = Math.max(0, endpoints.length - visibleEndpoints.length);
  const inspectedEndpoint = visibleEndpoints.find(endpoint => endpoint.alias === inspectedEndpointAlias)
    ?? endpoints.find(endpoint => endpoint.alias === inspectedEndpointAlias)
    ?? visibleEndpoints[0]
    ?? endpoints[0]
    ?? null;

  return (
    <section id="models" ref={rootRef} className="scroll-mt-28 border-b border-[#263044] bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.12),transparent_32%),#0a0e1a]">
      <div className="max-w-[1700px] mx-auto px-4 py-4">
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 grid-flow-dense items-start">
          <div className="availability-panel xl:col-span-8 rounded-2xl border p-5 shadow-[0_20px_80px_rgba(8,145,178,0.08)]">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 mb-4">
              <div>
                <div className="flex items-center gap-2 text-cyan-200">
                  <Signal className="w-4 h-4" />
                  <span className="text-xs uppercase tracking-[0.18em] text-cyan-200/70">Маршруты моделей</span>
                </div>
                <div className="mt-1 text-sm text-gray-500">
                  {isLoading && !data ? 'Проверяем `/v1/models` и последние успешные вызовы...' : `${formatNumber(total)} алиасов доступно через \`/v1/models\``}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <UpdatedAt value={data?.data.checkedAt} />
                <div className="rounded-full border border-emerald-300/20 bg-emerald-300/8 px-3 py-1.5 text-xs text-emerald-200">
                  зеленый = маршрут отвечал успешно
                </div>
              </div>
            </div>

            {isError && (
              <StatePanel state="error" title="Доступность моделей не загрузилась">
                Публичный dashboard остается доступен, но `/api/models/availability` сейчас не вернул список маршрутов.
              </StatePanel>
            )}

            {isLoading && !data ? (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3" aria-label="Загрузка маршрутов моделей">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="model-card rounded-xl border p-3">
                    <SkeletonBlock className="h-4 w-28" />
                    <SkeletonBlock className="mt-3 h-5 w-full" />
                    <div className="mt-4 grid grid-cols-3 gap-2">
                      <SkeletonBlock className="h-9" />
                      <SkeletonBlock className="h-9" />
                      <SkeletonBlock className="h-9" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {visibleStable.map(model => (
                <StableModelCard key={model.id} model={model} active={inspectedModel?.id === model.id} onInspect={() => setInspectedId(model.id)} />
                ))}
              </div>
            )}

            {hiddenStableCount > 0 && (
              <button
                type="button"
                onClick={() => setShowAllStable(value => !value)}
                className="mt-3 inline-flex items-center gap-2 rounded-full border border-cyan-200/16 bg-cyan-200/[0.055] px-3 py-2 text-xs font-semibold text-cyan-100 transition-colors hover:border-cyan-200/35 hover:bg-cyan-200/10"
              >
                {showAllStable ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                {showAllStable ? 'Свернуть стабильные маршруты' : `Показать еще ${hiddenStableCount} маршрутов`}
              </button>
            )}

            <div className="mt-4">
              <MetricGuide
                items={[
                  { label: 'Успех', text: 'Доля успешных вызовов по фактическим логам. Новые маршруты могут иметь мало данных.' },
                  { label: 'Контекст', text: 'Ориентир максимального окна модели из `/v1/models` или известной карточки.' },
                  { label: 'Запросы', text: 'Сколько раз модель реально использовалась через API gateway.' },
                  { label: 'Недоступно', text: '0% означает отсутствие успешного недавнего маршрута, а не удаление модели из истории.' },
                ]}
              />
            </div>

            <div className="mt-5 rounded-2xl border border-red-300/12 bg-red-300/[0.035] p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-red-200">
                    <TimerReset className="w-4 h-4" />
                    <span className="text-xs uppercase tracking-[0.18em] text-red-200/70">Временно недоступно</span>
                  </div>
                  <h3 className="mt-1 text-base font-semibold text-white">Claude недоступен</h3>
                  <p className="mt-1 text-xs leading-5 text-gray-500">Карточки оставлены видимыми, чтобы оператор видел, что маршрут проверяется, но сейчас не даёт успешных ответов.</p>
                </div>
                <div className="h-2.5 w-2.5 rounded-full bg-red-400 shadow-[0_0_18px_rgba(248,113,113,0.7)]" />
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                {unavailable.map(model => (
                  <UnavailableModelRow key={model.id} model={model} active={inspectedModel?.id === model.id} onInspect={() => setInspectedId(model.id)} />
                ))}
              </div>
            </div>
          </div>

          <div className="surface-card xl:col-span-4 rounded-2xl border border-cyan-300/15 p-5">
            {isLoading && !data ? (
              <div className="rounded-2xl border border-cyan-200/18 bg-[#07111f]/88 p-4">
                <SkeletonBlock className="h-4 w-24" />
                <SkeletonBlock className="mt-3 h-6 w-2/3" />
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <SkeletonBlock className="h-14" />
                  <SkeletonBlock className="h-14" />
                  <SkeletonBlock className="h-14" />
                  <SkeletonBlock className="h-14" />
                </div>
              </div>
            ) : inspectedModel ? <ModelInspector model={inspectedModel} /> : (
              <StatePanel state="empty" title="Нет выбранной модели">
                Когда появятся данные `/v1/models`, здесь будет карточка маршрута и его операторские параметры.
              </StatePanel>
            )}

            {newModels.length > 0 && (
              <div className="mt-4 mb-5 rounded-2xl border border-cyan-200/15 bg-cyan-200/6 p-4">
                <div className="flex items-center gap-2 text-cyan-100">
                  <Bell className="h-4 w-4" />
                  <span className="text-xs uppercase tracking-[0.18em] text-cyan-200/70">новые модели</span>
                </div>
                <div className="mt-3 space-y-2">
                  {newModels.slice(0, 8).map(model => (
                    <button
                      key={model.id}
                      type="button"
                      onMouseEnter={() => setInspectedId(model.id)}
                      onFocus={() => setInspectedId(model.id)}
                      onClick={() => setInspectedId(model.id)}
                      className={`w-full rounded-xl border px-3 py-2 text-left transition-colors ${inspectedModel?.id === model.id ? 'border-cyan-200/35 bg-cyan-200/10' : 'border-transparent bg-[#07111f]/70 hover:border-cyan-200/15 hover:bg-[#0a1728]'}`}
                    >
                      <div className="truncate text-sm text-white">{model.alias}</div>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-gray-500">
                        <Radio className="h-3 w-3 text-cyan-300" />
                        обращаться как <span className="text-cyan-200">{model.alias}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-emerald-200/15 bg-emerald-200/[0.045] p-4">
              <div className="flex items-center gap-2 text-emerald-100">
                <SearchCheck className="h-4 w-4" />
                <span className="text-xs uppercase tracking-[0.18em] text-emerald-200/70">новые endpoints</span>
              </div>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {visibleEndpoints.map(endpoint => (
                  <EndpointCard
                    key={endpoint.alias}
                    endpoint={endpoint}
                    active={inspectedEndpoint?.alias === endpoint.alias}
                    onInspect={() => setInspectedEndpointAlias(endpoint.alias)}
                  />
                ))}
                {endpoints.length === 0 && (
                  <div className="col-span-full text-xs leading-5 text-gray-500">Новые endpoints не опубликованы или еще загружаются.</div>
                )}
              </div>
              {inspectedEndpoint && <EndpointConnectionGuide endpoint={inspectedEndpoint} />}
              {hiddenEndpointCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAllEndpoints(value => !value)}
                  className="mt-3 inline-flex items-center gap-2 rounded-full border border-emerald-200/16 bg-emerald-200/[0.055] px-3 py-2 text-xs font-semibold text-emerald-100 transition-colors hover:border-emerald-200/35 hover:bg-emerald-200/10"
                >
                  {showAllEndpoints ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  {showAllEndpoints ? 'Свернуть endpoints' : `Показать еще ${hiddenEndpointCount}`}
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-gray-500">
          <span className="inline-flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 text-emerald-300" /> Стабильность считается по фактическим успешным запросам.</span>
        </div>
      </div>
    </section>
  );
}

function StableModelCard({ model, active, onInspect }: { model: AvailableModel; active: boolean; onInspect: () => void }) {
  return (
    <button
      type="button"
      data-model-card
      onMouseEnter={onInspect}
      onFocus={onInspect}
      onClick={onInspect}
      className={`model-card model-route-card group/model relative rounded-xl border p-3 text-left transition-all duration-300 ease-out hover:-translate-y-0.5 ${active ? 'border-cyan-200/45 bg-cyan-200/[0.055]' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-300 shadow-[0_0_16px_rgba(110,231,183,0.85)]" />
            <span className="text-[11px] uppercase tracking-[0.16em] text-emerald-200/70">работает</span>
          </div>
          <div className="mt-2 text-sm font-semibold text-white truncate" title={model.alias}>
            {model.alias}
          </div>
        </div>
        <Cpu className="w-4 h-4 text-cyan-300/80 shrink-0 transition-transform duration-700 group-hover:scale-110" />
      </div>

      <div className="model-metric-grid mt-4 grid grid-cols-3 gap-2 text-[11px]">
        <Metric label="Успех" value={model.successRate == null ? 'новая' : formatPercent(model.successRate)} />
        <Metric label="Контекст" value={model.contextLength ? compactTokens(model.contextLength) : 'n/a'} />
        <Metric label="Вызовы" value={formatNumber(model.usageCount)} />
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#1e293b]">
        <div className="h-full rounded-full bg-gradient-to-r from-emerald-300 to-cyan-300" style={{ width: `${Math.max(12, Math.min(100, (model.successRate ?? 0.96) * 100))}%` }} />
      </div>
      <div className="mt-2 truncate text-[11px] text-gray-500">модель: {model.alias}</div>
    </button>
  );
}

function UnavailableModelRow({ model, active, onInspect }: { model: AvailableModel; active: boolean; onInspect: () => void }) {
  return (
    <button
      type="button"
      data-model-card
      onMouseEnter={onInspect}
      onFocus={onInspect}
      onClick={onInspect}
      className={`unavailable-card group/model relative rounded-xl border px-3 py-2.5 text-left transition-colors ${active ? 'border-red-200/35 bg-red-300/[0.07]' : 'border-red-300/12'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-red-400 shadow-[0_0_16px_rgba(248,113,113,0.7)]" />
            <span className="text-xs text-red-200">временно недоступна</span>
          </div>
          <div className="mt-1 truncate text-sm text-gray-200" title={model.alias}>
            {model.alias}
          </div>
        </div>
        <span className="text-xs font-mono text-red-200" title="Нет успешных недавних вызовов по этому маршруту">{model.successRate == null ? '0.0%' : formatPercent(model.successRate)}</span>
      </div>
    </button>
  );
}

function ModelInspector({ model }: { model: AvailableModel }) {
  const meta = modelMeta(model);
  return (
    <div className="rounded-2xl border border-cyan-200/18 bg-[#07111f]/88 p-4 shadow-[0_24px_80px_rgba(0,0,0,0.24)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.18em] text-cyan-200/60">карточка модели</div>
          <div className="mt-1 truncate text-base font-semibold text-white">{meta.title}</div>
          <div className="mt-1 text-[11px] text-gray-500">{meta.route}</div>
        </div>
        <div className="rounded-full border border-emerald-300/20 bg-emerald-300/8 px-2 py-1 text-[10px] uppercase tracking-wide text-emerald-200">
          {model.successRate === 0 ? 'offline' : 'online'}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
        <HoverMetric icon={<FileText className="h-3.5 w-3.5" />} label="контекст" value={meta.context} />
        <HoverMetric icon={<Gauge className="h-3.5 w-3.5" />} label="скорость" value={meta.speed} />
        <HoverMetric icon={<DollarSign className="h-3.5 w-3.5" />} label="цена" value={meta.price} />
        <HoverMetric icon={<Cpu className="h-3.5 w-3.5" />} label="вывод" value={meta.output} />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {meta.badges.map(badge => (
          <span key={badge} className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.035] px-2 py-1 text-[10px] text-gray-300">
            {badge === 'image' ? <ImageIcon className="h-3 w-3 text-cyan-200" /> : badge === 'web' ? <SearchCheck className="h-3 w-3 text-emerald-200" /> : <Eye className="h-3 w-3 text-purple-200" />}
            {badgeLabel(badge)}
          </span>
        ))}
      </div>

      <div className="mt-3 text-[11px] leading-5 text-gray-500">
        Контекст, скорость и стоимость показываются как операторский ориентир. Выбор карточки не меняет маршрут, только показывает параметры выбранной модели.
      </div>
    </div>
  );
}

function EndpointCard({
  endpoint,
  active,
  onInspect,
}: {
  endpoint: EndpointInfo;
  active: boolean;
  onInspect: () => void;
}) {
  return (
    <button
      type="button"
      onMouseEnter={onInspect}
      onFocus={onInspect}
      onClick={onInspect}
      className={`endpoint-card group/endpoint rounded-xl border p-3 text-left transition-colors ${active ? 'endpoint-card-active' : ''}`}
      aria-label={`Endpoint ${endpoint.alias}. Base URL и model parameter показаны под списком endpoints.`}
      aria-pressed={active}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-white">{endpoint.alias}</div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-emerald-200/60">{endpoint.kind}</div>
        </div>
        <span className="mt-1 flex items-center gap-1 text-emerald-200">
          <Info className="h-3.5 w-3.5 opacity-70" />
          <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_14px_rgba(110,231,183,0.8)]" />
        </span>
      </div>
      <div className="mt-2 line-clamp-2 text-[11px] leading-4 text-gray-500">{endpoint.description}</div>
    </button>
  );
}

type EndpointInfo = {
  alias: string;
  kind: string;
  title: string;
  description: string;
  status: string;
  baseUrl?: string;
  modelParam?: string;
  usageHint?: string;
};

function EndpointConnectionGuide({ endpoint }: { endpoint: EndpointInfo }) {
  const baseUrl = endpoint.baseUrl ?? 'https://api.zed.md/v1';
  const modelParam = endpoint.modelParam ?? endpoint.alias;

  return (
    <div className="endpoint-guide-panel mt-3 rounded-xl border p-3">
      <div className="flex items-center gap-2 text-emerald-100">
        <Route className="h-4 w-4" />
        <div className="text-xs font-semibold">Как подключать `{endpoint.alias}`</div>
      </div>
      <div className="mt-3 grid gap-2 text-[11px]">
        <div className="rounded-lg border border-white/10 bg-white/[0.035] p-2">
          <div className="text-gray-500">base url</div>
          <code className="mt-1 block break-all text-emerald-100">{baseUrl}</code>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.035] p-2">
          <div className="text-gray-500">model</div>
          <code className="mt-1 block break-all text-cyan-100">{modelParam}</code>
        </div>
      </div>
      <p className="mt-3 text-[11px] leading-4 text-gray-300">
        {endpoint.usageHint ?? 'Это универсальный alias: клиент указывает короткое имя модели, а gateway сам ведет запрос по подходящему provider route. Так проще держать надежные pipelines, fallback и будущие замены без переписывания клиентского кода.'}
      </p>
    </div>
  );
}

function HoverMetric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#0b1626] p-2.5">
      <div className="flex items-center gap-1.5 text-cyan-200">{icon}<span className="text-[10px] uppercase tracking-wide text-gray-500">{label}</span></div>
      <div className="mt-1 font-mono text-[12px] text-white">{value}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="model-metric">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
    </div>
  );
}

function fallbackModel(provider: string, model: string): ModelStat {
  return {
    provider,
    model,
    count: 0,
    tokensIn: 0,
    tokensOut: 0,
    cost: 0,
    avgLatency: 0,
    successRate: 0,
    users: 0,
    lastSeen: '',
  };
}

function toAvailableFallback(model: ModelStat): AvailableModel {
  return {
    id: `${model.provider}/${model.model}`,
    alias: `${model.provider}/${model.model}`,
    root: model.model,
    parent: null,
    provider: model.provider,
    ownedBy: model.provider,
    contextLength: null,
    maxInputTokens: null,
    maxOutputTokens: null,
    capabilities: {},
    inputModalities: ['text'],
    outputModalities: ['text'],
    created: null,
    isNew: false,
    usageCount: 0,
    successRate: 0,
    avgLatency: null,
    lastSeen: null,
  };
}

function compactTokens(value: number): string {
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`;
  if (value >= 1000) return `${Math.round(value / 1000)}K`;
  return String(value);
}

function preferredRank(alias: string): number {
  const index = PREFERRED_STABLE.findIndex(pattern => pattern.test(alias));
  return index === -1 ? 100 : index;
}

function dedupeByAlias(models: AvailableModel[]): AvailableModel[] {
  const seen = new Set<string>();
  const result: AvailableModel[] = [];
  for (const model of models) {
    const key = model.alias.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(model);
  }
  return result;
}

function modelMeta(model: AvailableModel): { title: string; route: string; context: string; speed: string; price: string; output: string; badges: string[] } {
  const id = `${model.id} ${model.alias}`.toLowerCase();
  const actualLatency = model.avgLatency ? `~${Math.max(1, Math.round(1000 / Math.max(model.avgLatency, 1) * 20))} ток/с` : null;
  const fallback = {
    title: model.alias,
    route: `alias: ${model.alias}`,
    context: model.contextLength ? compactTokens(model.contextLength) : 'н/д',
    speed: actualLatency ?? 'нет данных от API',
    price: 'цена не передана',
    output: model.maxOutputTokens ? compactTokens(model.maxOutputTokens) : 'нет от API',
    badges: modalityBadges(model),
  };
  if (id.includes('gpt-5.5-xhigh')) return { ...fallback, title: 'GPT-5.5 xHigh', context: '1.05M', speed: actualLatency ?? '35-70 ток/с', price: '$5 / $30 за 1M', output: '128K', badges: ['text', 'image', 'file', 'web'] };
  if (id.includes('gpt-5.4')) return { ...fallback, title: 'GPT-5.4', context: '400K', speed: actualLatency ?? '45-85 ток/с', price: '$3 / $15 за 1M', output: '128K', badges: ['text', 'image', 'file', 'web'] };
  if (id.includes('gpt-5.3-codex-spark')) return { ...fallback, title: 'Codex Spark 5.3', context: '400K', speed: actualLatency ?? '90-160 ток/с', price: 'низкая', output: '64K', badges: ['text', 'code'] };
  if (id.includes('gpt-5.3-codex')) return { ...fallback, title: 'Codex 5.3', context: '400K', speed: actualLatency ?? '50-90 ток/с', price: 'средняя', output: '64K', badges: ['text', 'code'] };
  if (id.includes('deepseek-v4-pro')) return { ...fallback, title: 'DeepSeek V4 Pro', context: '1.05M', speed: actualLatency ?? '45-90 ток/с', price: '$0.44 / $0.87 за 1M', output: '384K', badges: ['text', 'code'] };
  if (id.includes('deepseek-v4-flash') || id.includes('deepseek-v3p2')) return { ...fallback, title: 'DeepSeek Flash', context: '1.05M', speed: actualLatency ?? '90-180 ток/с', price: 'низкая', output: '128K+', badges: ['text', 'code'] };
  if (id.includes('minimax-m2.7') || id.includes('minimax-m2p7')) return { ...fallback, title: 'MiniMax M2.7', context: '200K+', speed: actualLatency ?? '60-120 ток/с', price: 'низкая/средняя', output: '64K', badges: ['text', 'code'] };
  if (id.includes('qwen3.6-plus') || id.includes('qwen3p6-plus')) return { ...fallback, title: 'Qwen 3.6 Plus', context: '1M', speed: actualLatency ?? '70-140 ток/с', price: '$0.40 / $2.40 за 1M', output: '64K', badges: ['text', 'image', 'video'] };
  if (id.includes('qwen3.5-plus')) return { ...fallback, title: 'Qwen 3.5 Plus', context: '1M', speed: actualLatency ?? '70-130 ток/с', price: '$0.40 / $2.40 за 1M', output: '64K', badges: ['text', 'image', 'video'] };
  if (id.includes('claude-opus')) return { ...fallback, title: 'Claude Opus', context: '1M', speed: 'недоступна', price: '$15 / $75 за 1M', output: '128K', badges: ['text', 'image', 'web'] };
  if (id.includes('claude-sonnet')) return { ...fallback, title: 'Claude Sonnet', context: '1M', speed: 'недоступна', price: '$3 / $15 за 1M', output: '128K', badges: ['text', 'image', 'web'] };
  if (id.includes('claude-haiku')) return { ...fallback, title: 'Claude Haiku', context: '200K', speed: 'недоступна', price: '$1 / $5 за 1M', output: '64K', badges: ['text', 'image', 'web'] };
  return fallback;
}

function modalityBadges(model: AvailableModel): string[] {
  const values = new Set<string>(['text']);
  for (const item of [...(model.inputModalities ?? []), ...(model.outputModalities ?? [])]) {
    if (/image/i.test(item)) values.add('image');
    if (/video/i.test(item)) values.add('video');
    if (/file/i.test(item)) values.add('file');
  }
  if (model.capabilities?.web_search) values.add('web');
  return [...values];
}

function badgeLabel(badge: string): string {
  if (badge === 'image') return 'изображения';
  if (badge === 'video') return 'видео';
  if (badge === 'file') return 'файлы';
  if (badge === 'web') return 'web search';
  if (badge === 'code') return 'код';
  return 'текст';
}
