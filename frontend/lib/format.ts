export function formatNumber(n: number): string {
  return n.toLocaleString('ru-RU');
}

export function formatCost(cost: number): string {
  return `$${cost.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatLatency(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1).replace('.', ',')} с`;
  return `${Math.round(ms)} мс`;
}

export function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

export function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'только что';
  if (mins < 60) return `${mins} мин назад`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  return `${days} дн назад`;
}

export function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('ru', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function formatHour(h: number): string {
  return `${String(h).padStart(2, '0')}:00`;
}

export function formatDecimal(n: number, digits: number): string {
  return n.toFixed(digits);
}
