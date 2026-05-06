import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, ExternalLink, Heart, Search, BarChart3, Tag, LayoutGrid, List } from 'lucide-react';
import { getSkills, trackSkillAction, type SkillItem } from '../../lib/api.ts';
import { formatNumber } from '../../lib/format.ts';
import { MetricGuide, SkeletonBlock, StatePanel } from '../ui/feedback.tsx';

export function SkillsPage({ onOpenStats }: { onOpenStats: () => void }) {
  const [q, setQ] = useState('');
  const [source, setSource] = useState('');
  const [category, setCategory] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'cards'>('list');
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['skills', q, source, category],
    queryFn: () => getSkills({ q, source, category }),
  });
  const mutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'like' | 'download' }) => trackSkillAction(id, action),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['skills'] }),
  });

  const skills = data?.data.items ?? [];
  const topSkills = useMemo(() => [...skills].sort((a, b) => b.downloads - a.downloads).slice(0, 4), [skills]);
  const groupedSkills = useMemo(() => {
    const groups = new Map<string, SkillItem[]>();
    for (const skill of skills) {
      const list = groups.get(skill.category) ?? [];
      list.push(skill);
      groups.set(skill.category, list);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, 'ru'));
  }, [skills]);
  const categorySummary = useMemo(() => groupedSkills.map(([name, items]) => ({ name, count: items.length })).slice(0, 8), [groupedSkills]);

  async function copyInstall(skill: SkillItem) {
    await navigator.clipboard.writeText(skill.installCommand);
    setCopied(skill.id);
    mutation.mutate({ id: skill.id, action: 'download' });
    setTimeout(() => setCopied(null), 1200);
  }

  return (
    <div className="skills-page space-y-6">
      <section className="premium-shell">
        <div className="premium-core p-6 md:p-8">
          <div className="grid gap-8 xl:grid-cols-[1fr_34rem]">
            <div>
              <div className="eyebrow">skills.api.zed.md</div>
              <h1 className="mt-4 max-w-4xl text-3xl md:text-5xl font-semibold leading-tight text-white">
                Навыки агентов
              </h1>
              <p className="mt-4 max-w-3xl text-sm md:text-base leading-7 text-gray-400">
                Открытый каталог agent skills: команды установки, источники, лайки, загрузки и быстрый переход обратно в операционную статистику API ZED.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={onOpenStats}
                  className="group inline-flex items-center gap-3 rounded-full border border-cyan-200/20 bg-cyan-200/8 py-2 pl-5 pr-2 text-sm text-cyan-100 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:border-cyan-200/45 active:scale-[0.98]"
                >
                  <BarChart3 className="h-4 w-4" />
                  Статистика
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-cyan-200/12 transition-transform duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-1">
                    <ExternalLink className="h-4 w-4" />
                  </span>
                </button>
              </div>
            </div>

            <div className="grid gap-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                <div className="text-[10px] uppercase tracking-[0.18em] text-cyan-200/55">навигация по смыслу</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {categorySummary.map(item => (
                    <button
                      key={item.name}
                      type="button"
                      onClick={() => setCategory(item.name)}
                      className="rounded-full border border-white/10 bg-[#07111f]/70 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:border-cyan-200/25 hover:text-cyan-100"
                    >
                      {item.name} <span className="text-gray-500">{formatNumber(item.count)}</span>
                    </button>
                  ))}
                </div>
              </div>
              {topSkills.map(skill => (
                <div key={skill.id} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-white">{skill.slug}</div>
                      <div className="mt-1 text-xs text-gray-500">{skill.source}</div>
                    </div>
                    <div className="rounded-full bg-emerald-300/10 px-2.5 py-1 text-xs text-emerald-200">{formatNumber(skill.downloads)} установок</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="surface-card rounded-2xl border p-4 md:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Открыта библиотека</h2>
            <p className="mt-1 text-xs text-gray-500">
              Найдено {formatNumber(data?.data.returned ?? 0)} из {formatNumber(data?.data.total ?? 0)} навыков.
            </p>
          </div>
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <label className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
              <input
                value={q}
                onChange={event => setQ(event.target.value)}
                className="w-full md:w-80 rounded-full border border-white/10 bg-[#07111f] py-2.5 pl-10 pr-4 text-sm text-cyan-50 outline-none focus:border-cyan-200/40"
                placeholder="поиск по названию, описанию, тегам"
              />
            </label>
            <select
              value={source}
              onChange={event => setSource(event.target.value)}
              className="rounded-full border border-white/10 bg-[#07111f] px-4 py-2.5 text-sm text-cyan-50 outline-none focus:border-cyan-200/40"
            >
              <option value="">все источники</option>
              {data?.data.sources.map(item => <option key={item} value={item}>{item}</option>)}
            </select>
            <div className="inline-flex rounded-full border border-white/10 bg-[#07111f] p-1" aria-label="Режим отображения каталога">
              <ViewModeButton active={viewMode === 'list'} onClick={() => setViewMode('list')} icon={<List className="h-3.5 w-3.5" />} label="Список" />
              <ViewModeButton active={viewMode === 'cards'} onClick={() => setViewMode('cards')} icon={<LayoutGrid className="h-3.5 w-3.5" />} label="Карточки" />
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setCategory('')}
            className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${category === '' ? 'border-cyan-200/40 bg-cyan-200/12 text-cyan-100' : 'border-white/10 bg-white/[0.025] text-gray-400 hover:text-gray-200'}`}
          >
            все категории
          </button>
          {data?.data.categories.map(item => (
            <button
              key={item}
              type="button"
              onClick={() => setCategory(item)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${category === item ? 'border-cyan-200/40 bg-cyan-200/12 text-cyan-100' : 'border-white/10 bg-white/[0.025] text-gray-400 hover:text-gray-200'}`}
            >
              <Tag className="h-3 w-3" />
              {item}
            </button>
          ))}
        </div>
      </section>

      <MetricGuide
        title="Как читать каталог"
        items={[
          { label: 'Источник', text: 'Откуда установлен навык: локальный архив, plugin pack или curated bundle.' },
          { label: 'Установки', text: 'Счётчик копирования install command в этом UI, не глобальная телеметрия npm/GitHub.' },
          { label: 'Категории', text: 'Группировка нужна для поиска подходящего skill, а не для runtime-доступа.' },
        ]}
      />

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Загрузка каталога навыков">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="premium-shell">
              <div className="premium-core p-5">
                <SkeletonBlock className="h-4 w-32" />
                <SkeletonBlock className="mt-3 h-6 w-2/3" />
                <SkeletonBlock className="mt-5 h-24 w-full" />
                <SkeletonBlock className="mt-5 h-10 w-full" />
              </div>
            </div>
          ))}
        </div>
      ) : isError ? (
        <StatePanel state="error" title="Каталог навыков не загрузился">
          `/api/skills` не ответил. Страница статистики и health API не зависят от этого запроса.
        </StatePanel>
      ) : groupedSkills.length === 0 ? (
        <StatePanel state="empty" title="По фильтрам нет навыков">
          Очистите поиск, источник или категорию, чтобы вернуться к полному каталогу.
        </StatePanel>
      ) : viewMode === 'list' ? (
        <div className="space-y-5">
          {groupedSkills.map(([group, items]) => (
            <section key={group} className="surface-card skills-list-group rounded-xl border">
              <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                <div>
                  <h3 className="text-base font-semibold text-white">{group}</h3>
                  <p className="mt-1 text-xs text-gray-500">{formatNumber(items.length)} навыков в группе</p>
                </div>
                <span className="rounded-full border border-cyan-200/12 bg-cyan-200/[0.045] px-2.5 py-1 text-xs text-cyan-100">{formatNumber(items.reduce((sum, skill) => sum + skill.downloads, 0))} установок</span>
              </div>
              <div className="divide-y divide-[#1e293b]">
                {items.map(skill => (
                  <SkillListItem
                    key={skill.id}
                    skill={skill}
                    copied={copied === skill.id}
                    onCopy={() => copyInstall(skill)}
                    onLike={() => mutation.mutate({ id: skill.id, action: 'like' })}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="space-y-8">
          {groupedSkills.map(([group, items]) => (
            <section key={group} className="space-y-3">
              <div className="flex items-center justify-between border-b border-white/10 pb-2">
                <div>
                  <h3 className="text-base font-semibold text-white">{group}</h3>
                  <p className="mt-1 text-xs text-gray-500">{formatNumber(items.length)} навыков в группе</p>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {items.map(skill => (
                  <SkillCard
                    key={skill.id}
                    skill={skill}
                    copied={copied === skill.id}
                    onCopy={() => copyInstall(skill)}
                    onLike={() => mutation.mutate({ id: skill.id, action: 'like' })}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function ViewModeButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${active ? 'bg-cyan-200/12 text-cyan-100' : 'text-gray-500 hover:text-gray-200'}`}
      aria-pressed={active}
    >
      {icon}
      {label}
    </button>
  );
}

function SkillListItem({
  skill,
  copied,
  onCopy,
  onLike,
}: {
  skill: SkillItem;
  copied: boolean;
  onCopy: () => void;
  onLike: () => void;
}) {
  return (
    <article className="grid gap-3 px-4 py-3 transition-colors hover:bg-cyan-200/[0.035] lg:grid-cols-[minmax(14rem,1.1fr)_minmax(18rem,2fr)_22rem] lg:items-center">
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-white" title={skill.slug}>{skill.slug}</div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          <span className="rounded-full border border-white/10 bg-white/[0.025] px-2 py-0.5 text-[10px] uppercase tracking-wide text-cyan-200/70">{skill.source}</span>
          <span className="rounded-full border border-white/10 bg-white/[0.025] px-2 py-0.5 text-[10px] text-gray-400">{skill.category}</span>
        </div>
      </div>
      <p className="line-clamp-2 text-sm leading-5 text-gray-400">{skill.descriptionRu}</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid grid-cols-3 gap-2 text-[10px] text-gray-500 sm:min-w-44">
          <MiniCount label="likes" value={skill.likes} />
          <MiniCount label="installs" value={skill.downloads} />
          <MiniCount label="stars" value={skill.stars} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onLike}
            className="grid h-9 w-9 place-items-center rounded-full border border-rose-200/15 bg-rose-200/5 text-rose-200/80 transition-colors hover:bg-rose-200/10 hover:text-rose-100"
            title="Поставить лайк от себя"
            aria-label={`Поставить лайк навыку ${skill.slug}`}
          >
            <Heart className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex items-center gap-2 rounded-full border border-cyan-200/16 bg-[#0b1724] px-3 py-2 text-xs font-semibold text-cyan-100 transition-colors hover:border-cyan-200/35 hover:bg-[#0e2030]"
          >
            <Copy className="h-3.5 w-3.5" />
            {copied ? 'Скопировано' : 'Install'}
          </button>
        </div>
      </div>
    </article>
  );
}

function MiniCount({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.025] px-2 py-1">
      <div className="font-mono text-xs text-gray-200">{value == null ? 'н/д' : formatNumber(value)}</div>
      <div className="mt-0.5 uppercase tracking-wide">{label}</div>
    </div>
  );
}

function SkillCard({
  skill,
  copied,
  onCopy,
  onLike,
}: {
  skill: SkillItem;
  copied: boolean;
  onCopy: () => void;
  onLike: () => void;
}) {
  return (
    <article className="premium-shell transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-1">
      <div className="premium-core flex h-full flex-col p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.18em] text-cyan-200/55">{skill.source}</div>
            <h3 className="mt-2 truncate text-lg font-semibold text-white" title={skill.slug}>{skill.slug}</h3>
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.025] px-2.5 py-1 text-[11px] text-gray-400">
              <Tag className="h-3 w-3 text-cyan-200/70" />
              {skill.category}
            </div>
          </div>
          <div className="shrink-0 flex items-start gap-3">
            <button
              type="button"
              onClick={onLike}
              className="grid h-9 w-9 place-items-center rounded-full border border-rose-200/15 bg-rose-200/5 text-rose-200/80 transition-all hover:scale-105 hover:bg-rose-200/10 hover:text-rose-100"
              title="Поставить лайк от себя"
              aria-label={`Поставить лайк навыку ${skill.slug}`}
            >
              <Heart className="h-3.5 w-3.5" />
            </button>
            <div className="grid gap-1 text-right text-[10px] text-gray-500">
              <span><span className="font-mono text-gray-200">{formatNumber(skill.likes)}</span> лайков</span>
              <span><span className="font-mono text-gray-200">{formatNumber(skill.downloads)}</span> установок</span>
              <span><span className="font-mono text-gray-200">{skill.stars == null ? 'н/д' : formatNumber(skill.stars)}</span> звезд</span>
            </div>
          </div>
        </div>

        <p className="mt-4 line-clamp-5 min-h-[7.5rem] text-sm leading-6 text-gray-400">{skill.descriptionRu}</p>

        <div className="mt-5 flex flex-wrap gap-2">
          {skill.tags.slice(0, 3).map(tag => (
            <span key={tag} className="rounded-full border border-white/10 bg-white/[0.035] px-2.5 py-1 text-[11px] text-gray-400">{tag}</span>
          ))}
        </div>

        <button
          type="button"
          onClick={onCopy}
          className="group mt-5 inline-flex items-center justify-between rounded-full border border-cyan-200/16 bg-[#0b1724] py-2 pl-4 pr-2 text-sm font-semibold text-cyan-100 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:border-cyan-200/35 hover:bg-[#0e2030] active:scale-[0.98]"
        >
          {copied ? 'Команда скопирована' : 'Скопировать установку'}
          <span className="grid h-8 w-8 place-items-center rounded-full bg-cyan-200/10 transition-transform duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-1">
            <Copy className="h-4 w-4" />
          </span>
        </button>
      </div>
    </article>
  );
}
