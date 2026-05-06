import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle, Clock, HelpCircle, Info, Loader2 } from 'lucide-react';

type StateKind = 'loading' | 'error' | 'empty' | 'partial' | 'info' | 'success';

const STATE_ICON: Record<StateKind, ReactNode> = {
  loading: <Loader2 className="h-4 w-4 animate-spin" />,
  error: <AlertTriangle className="h-4 w-4" />,
  empty: <Info className="h-4 w-4" />,
  partial: <AlertTriangle className="h-4 w-4" />,
  info: <Info className="h-4 w-4" />,
  success: <CheckCircle className="h-4 w-4" />,
};

export function StatePanel({
  state,
  title,
  children,
  compact = false,
}: {
  state: StateKind;
  title: string;
  children?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`state-panel state-panel-${state} ${compact ? 'state-panel-compact' : ''}`} role={state === 'error' ? 'alert' : 'status'}>
      <div className="state-panel-icon">{STATE_ICON[state]}</div>
      <div className="min-w-0">
        <div className="state-panel-title">{title}</div>
        {children && <div className="state-panel-copy">{children}</div>}
      </div>
    </div>
  );
}

export function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`skeleton-block ${className}`} aria-hidden="true" />;
}

export function MetricGuide({
  title = 'Как читать метрики',
  items,
}: {
  title?: string;
  items: Array<{ label: string; text: string }>;
}) {
  return (
    <aside className="metric-guide" aria-label={title}>
      <div className="metric-guide-title">
        <HelpCircle className="h-3.5 w-3.5 text-cyan-200" />
        {title}
      </div>
      <div className="metric-guide-grid">
        {items.map(item => (
          <div key={item.label} className="metric-guide-item">
            <span>{item.label}</span>
            <p>{item.text}</p>
          </div>
        ))}
      </div>
    </aside>
  );
}

export function UpdatedAt({ value }: { value: string | null | undefined }) {
  const label = formatUpdatedAt(value);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.035] px-2.5 py-1 text-[11px] text-gray-400">
      <Clock className="h-3 w-3 text-cyan-200/70" />
      {label}
    </span>
  );
}

export function formatUpdatedAt(value: string | null | undefined): string {
  if (!value) return 'обновление...';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'время проверки неизвестно';
  return `обновлено ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}
