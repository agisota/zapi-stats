import { useQuery } from '@tanstack/react-query';
import { Search, Lightbulb, Star, X, Wrench, Globe } from 'lucide-react';
import { getUserProfile, type LeaderboardEntry } from '../../lib/api.ts';
import { formatNumber, formatCost, formatLatency, formatPercent, formatDecimal } from '../../lib/format.ts';

interface ToolStats {
  totalToolCalls: number;
  uniqueTools: number;
  toolNames: string[];
  sampledRequests: number;
}

interface LanguageStats {
  englishPercent: number;
  russianPercent: number;
  otherPercent: number;
  sampledMessages: number;
  dominantLanguage: string;
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

interface UserProfileModalProps {
  name: string;
  entry?: LeaderboardEntry;
  onClose: () => void;
}

export function UserProfileModal({ name, entry, onClose }: UserProfileModalProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['userProfile', name],
    queryFn: () => getUserProfile(name),
  });

  const { data: toolsData } = useQuery({
    queryKey: ['tools', name],
    queryFn: () => fetchJson<{ data: ToolStats }>(`/api/stats/user/${encodeURIComponent(name)}/tools`),
  });

  const { data: langData } = useQuery({
    queryKey: ['language', name],
    queryFn: () => fetchJson<{ data: LanguageStats }>(`/api/stats/user/${encodeURIComponent(name)}/language`),
  });

  const profile = data?.data;
  const tools = toolsData?.data;
  const lang = langData?.data;

  const initial = profile?.displayName.startsWith('@')
    ? profile.displayName[1]?.toUpperCase()
    : profile?.displayName[0]?.toUpperCase();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative bg-[#111827] border border-[#1e293b] rounded-2xl shadow-2xl w-full max-w-[95vw] md:max-w-2xl mx-4 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors"
          onClick={onClose}
          aria-label="Закрыть"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-[#1e293b] flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white text-sm font-bold shrink-0">
            {initial ?? '?'}
          </div>
          <div>
            <p className="text-white font-semibold text-base">
              {profile?.displayName ?? name}
            </p>
            <p className="text-gray-500 text-xs">Профиль пользователя</p>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-6">
          {isLoading && (
            <p className="text-gray-500 text-sm text-center py-6">Загрузка...</p>
          )}

          {isError && (
            <p className="text-red-400 text-sm text-center py-6">Не удалось загрузить профиль.</p>
          )}

          {/* Stats grid from leaderboard entry */}
          {entry && <StatsGrid entry={entry} />}

          {profile && (
            <>
              {/* Patterns */}
              <Section
                icon={<Search className="w-4 h-4 text-cyan-400" />}
                title="Паттерны использования"
                items={profile.patterns}
                cardClass="bg-cyan-950/40 border border-cyan-900/50 text-cyan-200"
              />

              {/* Recommendations */}
              <Section
                icon={<Lightbulb className="w-4 h-4 text-amber-400" />}
                title="Рекомендации"
                items={profile.recommendations}
                cardClass="bg-amber-950/40 border border-amber-900/50 text-amber-200"
              />

              {/* Highlights */}
              <Section
                icon={<Star className="w-4 h-4 text-emerald-400" />}
                title="Достижения"
                items={profile.highlights}
                cardClass="bg-emerald-950/40 border border-emerald-900/50 text-emerald-200"
              />
            </>
          )}

          {/* Language section */}
          {lang && <LanguageSection lang={lang} />}

          {/* Tools section */}
          {tools && <ToolsSection tools={tools} />}
        </div>
      </div>
    </div>
  );
}

function StatsGrid({ entry }: { entry: LeaderboardEntry }) {
  const stats = [
    { label: 'запросов', value: formatNumber(entry.requests) },
    { label: 'стоимость', value: formatCost(entry.cost) },
    { label: 'req/day', value: formatDecimal(entry.requestsPerDay, 1) },
    { label: 'задержка', value: formatLatency(entry.avgLatency) },
    { label: 'успех', value: formatPercent(entry.successRate) },
    { label: 'активных дней', value: String(entry.activeDays) },
  ];

  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
      {stats.map((s) => (
        <div key={s.label} className="bg-[#0f172a] border border-[#1e293b] rounded-lg px-3 py-2 text-center">
          <p className="text-white font-bold text-sm font-mono">{s.value}</p>
          <p className="text-gray-500 text-[10px] mt-0.5">{s.label}</p>
        </div>
      ))}
    </div>
  );
}

function LanguageSection({ lang }: { lang: LanguageStats }) {
  const en = Math.round(lang.englishPercent);
  const ru = Math.round(lang.russianPercent);
  const other = Math.max(0, 100 - en - ru);

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Globe className="w-4 h-4 text-blue-400" />
        <h3 className="text-sm font-semibold text-white uppercase tracking-wider">Язык промптов</h3>
      </div>
      <div className="bg-[#0f172a] border border-[#1e293b] rounded-lg px-4 py-3 space-y-2">
        {/* Bar */}
        <div className="flex h-3 rounded-full overflow-hidden bg-[#1e293b]">
          {en > 0 && (
            <div style={{ width: `${en}%` }} className="bg-blue-500" />
          )}
          {ru > 0 && (
            <div style={{ width: `${ru}%` }} className="bg-purple-500" />
          )}
          {other > 0 && (
            <div style={{ width: `${other}%` }} className="bg-gray-600" />
          )}
        </div>
        {/* Labels */}
        <div className="flex items-center gap-4 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
            <span className="text-blue-300">EN {en}%</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-purple-500 inline-block" />
            <span className="text-purple-300">RU {ru}%</span>
          </span>
          {other > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-gray-500 inline-block" />
              <span className="text-gray-400">Другие {other}%</span>
            </span>
          )}
          <span className="ml-auto text-gray-600 text-[10px]">
            Доминирующий: {lang.dominantLanguage}
          </span>
        </div>
        <p className="text-gray-600 text-[10px]">
          Выборка: {formatNumber(lang.sampledMessages)} сообщений
        </p>
      </div>
    </div>
  );
}

function ToolsSection({ tools }: { tools: ToolStats }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Wrench className="w-4 h-4 text-violet-400" />
        <h3 className="text-sm font-semibold text-white uppercase tracking-wider">Инструменты</h3>
      </div>
      <div className="bg-[#0f172a] border border-[#1e293b] rounded-lg px-4 py-3 space-y-3">
        <div className="flex gap-4 text-sm">
          <span>
            <span className="text-white font-bold font-mono">{formatNumber(tools.totalToolCalls)}</span>
            <span className="text-gray-500 ml-1">вызовов</span>
          </span>
          <span className="text-gray-700">|</span>
          <span>
            <span className="text-white font-bold font-mono">{tools.uniqueTools}</span>
            <span className="text-gray-500 ml-1">уникальных</span>
          </span>
        </div>
        {tools.toolNames.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tools.toolNames.map((t) => (
              <span
                key={t}
                className="bg-violet-950/50 border border-violet-800/40 text-violet-300 text-[11px] px-2 py-0.5 rounded-md font-mono"
              >
                {t}
              </span>
            ))}
          </div>
        )}
        <p className="text-gray-600 text-[10px]">
          Выборка: {formatNumber(tools.sampledRequests)} запросов
        </p>
      </div>
    </div>
  );
}

interface SectionProps {
  icon: React.ReactNode;
  title: string;
  items: string[];
  cardClass: string;
}

function Section({ icon, title, items, cardClass }: SectionProps) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h3 className="text-sm font-semibold text-white uppercase tracking-wider">{title}</h3>
      </div>
      <ul className="space-y-2">
        {items.map((item, i) => (
          <li key={i} className={`rounded-lg px-3 py-2 text-sm ${cardClass}`}>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
