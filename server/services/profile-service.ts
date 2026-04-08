import type { LeaderboardEntry } from './stats-service.ts';

export interface UserProfile {
  displayName: string;
  summary: string;
  patterns: string[];
  antiPatterns: string[];
  pros: string[];
  cons: string[];
  recommendations: string[];
  highlights: string[];
}

export function generateUserProfile(entry: LeaderboardEntry, allEntries: LeaderboardEntry[]): UserProfile {
  const patterns: string[] = [];
  const antiPatterns: string[] = [];
  const pros: string[] = [];
  const cons: string[] = [];
  const recommendations: string[] = [];
  const highlights: string[] = [];

  const rank = allEntries.findIndex(e => e.name === entry.name) + 1;
  const total = allEntries.length;

  // --- SUMMARY ---

  let summary = '';
  if (entry.requestsPerDay > 500 && entry.uniqueModels > 30) {
    summary = 'Мультимодельный энергопользователь с широким покрытием провайдеров';
  } else if (entry.requestsPerDay > 500) {
    summary = 'Энергопользователь с высокой интенсивностью запросов';
  } else if (entry.costPerRequest > 1.5 && entry.uniqueModels < 5) {
    summary = 'Специалист по premium-моделям с фокусом на качество';
  } else if (entry.avgLatency < 500 && entry.successRate > 0.95) {
    summary = 'Эффективный пользователь с быстрыми и стабильными запросами';
  } else if (entry.outputRatio < 0.005) {
    summary = 'Агентный пользователь — преимущественно инструментальное использование';
  } else if (entry.avgSessionMessages > 100) {
    summary = 'Марафонец — длинные глубокие сессии с высокой вовлечённостью';
  } else if (entry.successRate < 0.7) {
    summary = 'Экспериментатор — высокая частота ошибок, возможно тестирует лимиты';
  } else {
    summary = 'Стабильный пользователь с умеренной активностью';
  }

  // --- PATTERNS ---

  // Activity classification
  if (entry.requestsPerDay > 500) patterns.push(`Энергопользователь — ${Math.round(entry.requestsPerDay)} запросов/день`);
  else if (entry.requestsPerDay > 100) patterns.push(`Активный — ${Math.round(entry.requestsPerDay)} запросов/день`);
  else if (entry.requestsPerDay > 10) patterns.push(`Умеренный — ${Math.round(entry.requestsPerDay)} запросов/день`);
  else patterns.push(`Лёгкое использование — ${entry.requestsPerDay.toFixed(1)} запросов/день`);

  // Model preference
  patterns.push(`Основная модель: ${entry.topModel} через ${entry.topProvider}`);

  // Session behavior
  if (entry.avgSessionMessages > 100) patterns.push(`Марафонные сессии — в среднем ${entry.avgSessionMessages.toFixed(0)} сообщений за сессию`);
  else if (entry.avgSessionMessages > 30) patterns.push(`Длинные сессии — в среднем ${entry.avgSessionMessages.toFixed(0)} сообщений`);
  else patterns.push(`Короткие сессии — ${entry.avgSessionMessages.toFixed(0)} сообщений`);

  // Output ratio analysis
  if (entry.outputRatio > 0.05) patterns.push(`Высокий output ratio (${(entry.outputRatio * 100).toFixed(1)}%) — генерирует много контента`);
  else if (entry.outputRatio < 0.005) patterns.push(`Минимальный output (${(entry.outputRatio * 100).toFixed(2)}%) — агентный/инструментальный режим`);
  else patterns.push(`Стандартный output ratio (${(entry.outputRatio * 100).toFixed(2)}%)`);

  // Cost efficiency
  const avgCostStr = entry.costPerRequest > 1 ? `$${entry.costPerRequest.toFixed(2)}` : `$${entry.costPerRequest.toFixed(4)}`;
  patterns.push(`Стоимость запроса: ${avgCostStr}`);

  // Peak hours
  const peakLabel = entry.peakHour >= 9 && entry.peakHour <= 17 ? 'рабочие часы' :
    entry.peakHour >= 18 && entry.peakHour <= 23 ? 'вечер' :
    entry.peakHour >= 0 && entry.peakHour <= 5 ? 'ночь' : 'утро';
  patterns.push(`Пик активности: ${String(entry.peakHour).padStart(2, '0')}:00 (${peakLabel})`);

  // Token efficiency
  if (entry.tokensPerRequest > 100000) patterns.push(`Крупные запросы — ${(entry.tokensPerRequest / 1000).toFixed(0)}K токенов/запрос`);
  else if (entry.tokensPerRequest > 10000) patterns.push(`Средние запросы — ${(entry.tokensPerRequest / 1000).toFixed(1)}K токенов/запрос`);
  else patterns.push(`Компактные запросы — ${entry.tokensPerRequest.toLocaleString()} токенов/запрос`);

  // Cache usage
  if (entry.tokensCacheRead > 0) {
    const cacheRatio = entry.tokensCacheRead / (entry.tokensIn || 1);
    patterns.push(`Использует кэш промптов — ${(cacheRatio * 100).toFixed(1)}% cache hit`);
  } else if (entry.requests > 100) {
    patterns.push(`Кэш промптов не используется`);
  }

  // Reasoning tokens
  if (entry.tokensReasoning > 0) {
    patterns.push(`Использует reasoning-модели — ${entry.tokensReasoning.toLocaleString()} reasoning токенов`);
  }

  // Provider diversity
  if (entry.uniqueProviders >= 5) patterns.push(`Диверсифицированный — ${entry.uniqueProviders} провайдеров`);
  else if (entry.uniqueProviders === 1) patterns.push(`Один провайдер — нет резервирования`);

  // Model diversity analysis
  if (entry.uniqueModels > 40) patterns.push(`Полиглот моделей — ${entry.uniqueModels} разных моделей, использует практически весь каталог`);
  else if (entry.uniqueModels > 20) patterns.push(`Разнообразие моделей — ${entry.uniqueModels} моделей, широкий выбор под задачи`);
  else if (entry.uniqueModels < 5) patterns.push(`Узкий фокус — только ${entry.uniqueModels} модели, предпочитает проверенные решения`);

  // Cost structure
  const inputCostRatio = entry.inputCost / (entry.cost || 1);
  if (inputCostRatio > 0.9) patterns.push(`Затраты на input — ${(inputCostRatio * 100).toFixed(0)}% стоимости приходится на входные токены (большие промпты)`);
  else if (inputCostRatio < 0.5) patterns.push(`Затраты на output — ${((1 - inputCostRatio) * 100).toFixed(0)}% стоимости приходится на генерацию ответов`);

  // Efficiency metrics
  const efficiency = entry.tokensOut > 0 ? entry.cost / entry.tokensOut * 1000 : 0;
  if (efficiency > 0 && efficiency < 5) patterns.push(`Высокая эффективность — $${efficiency.toFixed(2)} за 1K выходных токенов`);
  else if (efficiency > 20) patterns.push(`Низкая эффективность — $${efficiency.toFixed(2)} за 1K выходных токенов`);

  // Session patterns
  if (entry.longestSessionMessages > 1000) patterns.push(`Рекордные сессии — до ${entry.longestSessionMessages.toLocaleString()} сообщений в одной сессии`);

  // Error pattern
  if (entry.errorRate > 0.3 && entry.errorRate < 0.6) patterns.push(`Экспериментальный подход — ${(entry.errorRate * 100).toFixed(0)}% запросов с ошибками, возможно тестирование границ`);

  // --- ANTI-PATTERNS ---

  if (entry.successRate < 0.5) antiPatterns.push(`Критически низкий success rate (${(entry.successRate * 100).toFixed(1)}%) — больше половины запросов неудачны`);
  if (entry.costPerRequest > 2) antiPatterns.push(`Расточительность — $${entry.costPerRequest.toFixed(2)}/запрос, возможна оптимизация через лёгкие модели`);
  if (entry.errorCount > entry.requests * 0.3) antiPatterns.push(`Высокий уровень ошибок — ${entry.errorCount.toLocaleString()} из ${entry.requests.toLocaleString()}`);
  if (entry.uniqueProviders === 1 && entry.requests > 100) antiPatterns.push(`Vendor lock-in — все запросы через одного провайдера`);
  if (entry.avgLatency > 5000) antiPatterns.push(`Очень высокая latency (${(entry.avgLatency / 1000).toFixed(1)}s) — снижает продуктивность`);
  if (entry.tokensCacheRead === 0 && entry.tokensIn > 10_000_000) antiPatterns.push(`Упущенная экономия — ${(entry.tokensIn / 1_000_000).toFixed(0)}M input токенов без кэширования`);
  if (entry.avgSessionMessages < 5 && entry.requests > 100) antiPatterns.push(`Фрагментированное использование — очень короткие сессии, мало контекста между запросами`);
  if (entry.tokensPerRequest > 200000) antiPatterns.push(`Избыточные промпты — ${(entry.tokensPerRequest / 1000).toFixed(0)}K токенов/запрос, рассмотрите сжатие контекста`);

  // --- PROS ---

  if (entry.successRate > 0.95) pros.push(`Стабильность — ${(entry.successRate * 100).toFixed(1)}% успешных запросов`);
  if (entry.avgLatency < 500 && entry.requests > 50) pros.push(`Быстрые ответы — ${entry.avgLatency}ms средняя latency`);
  if (entry.uniqueModels > 15) pros.push(`Гибкость — ${entry.uniqueModels} разных моделей, адаптация под задачу`);
  if (entry.providerDiversity > 1.2) pros.push(`Отличная диверсификация провайдеров`);
  if (entry.tokensCacheRead > 0) pros.push(`Использует prompt caching — экономит на повторных запросах`);
  if (entry.requestsPerDay > 200) pros.push(`Высокая продуктивность — ${Math.round(entry.requestsPerDay)} запросов/день`);
  if (entry.activeDays >= 14) pros.push(`Стабильная активность — ${entry.activeDays} дней подряд`);
  if (entry.costPerRequest < 0.5) pros.push(`Экономичность — $${entry.costPerRequest.toFixed(3)}/запрос`);
  if (entry.tokensReasoning > 0) pros.push(`Использует reasoning-модели — глубокий анализ через chain-of-thought`);
  if (entry.longestSessionMessages > 500 && entry.successRate > 0.9) pros.push(`Устойчивые длинные сессии — высокий success rate даже при марафонном использовании`);

  // --- CONS ---

  if (entry.successRate < 0.9) cons.push(`Высокий процент ошибок (${((1 - entry.successRate) * 100).toFixed(1)}%)`);
  if (entry.avgLatency > 2000) cons.push(`Высокая latency — ${(entry.avgLatency / 1000).toFixed(1)}s в среднем`);
  if (entry.costPerRequest > 1) cons.push(`Дорогие запросы — $${entry.costPerRequest.toFixed(2)} за запрос`);
  if (entry.uniqueProviders <= 2 && entry.requests > 500) cons.push(`Низкая диверсификация — только ${entry.uniqueProviders} провайдер(а)`);
  if (entry.outputRatio < 0.003) cons.push(`Крайне низкий output — возможно, не получает полезных ответов`);
  if (entry.avgTtft > 5000) cons.push(`Долгое ожидание первого токена (${(entry.avgTtft / 1000).toFixed(1)}s) — снижает интерактивность`);
  if (entry.activeDays < 5) cons.push(`Нестабильная активность — всего ${entry.activeDays} активных дней`);

  // --- RECOMMENDATIONS ---

  if (entry.costPerRequest > 1.5) recommendations.push(`Оптимизируйте стоимость: используйте Haiku/Groq для простых задач, Opus только для сложных`);
  if (entry.successRate < 0.8) recommendations.push(`Проверьте rate limits: ${entry.errorCount} ошибок могут быть из-за лимитов API-провайдера`);
  if (entry.avgLatency > 3000) recommendations.push(`Снизьте latency: попробуйте Groq или Cerebras для задач, не требующих глубокого reasoning`);
  if (entry.uniqueProviders === 1) recommendations.push(`Добавьте резервного провайдера для отказоустойчивости`);
  if (entry.tokensPerRequest > 100000) recommendations.push(`Оптимизируйте промпты: ${(entry.tokensPerRequest / 1000).toFixed(0)}K токенов/запрос — рассмотрите суммаризацию контекста`);
  if (entry.tokensCacheRead === 0 && entry.requests > 100) recommendations.push(`Включите prompt caching — сэкономит до 90% на повторных запросах`);
  if (entry.outputRatio < 0.003) recommendations.push(`Проверьте output: крайне низкий выход может указывать на проблемы с промптами`);
  if (recommendations.length === 0) recommendations.push(`Всё в порядке — паттерны использования выглядят здоровыми`);

  // --- HIGHLIGHTS ---

  const maxRequests = Math.max(...allEntries.map(e => e.requests));
  const maxCost = Math.max(...allEntries.map(e => e.cost));
  const maxDiversity = Math.max(...allEntries.map(e => e.providerDiversity));
  const maxModels = Math.max(...allEntries.map(e => e.uniqueModels));
  const bestSuccessRate = Math.max(...allEntries.map(e => e.successRate));
  const lowestLatency = Math.min(...allEntries.filter(e => e.avgLatency > 0).map(e => e.avgLatency));

  if (entry.requests === maxRequests) highlights.push('Самый активный пользователь');
  if (entry.cost === maxCost) highlights.push('Наибольшие затраты на API');
  if (entry.providerDiversity === maxDiversity) highlights.push('Самое разнообразное использование провайдеров');
  if (entry.uniqueModels === maxModels) highlights.push('Использует больше всего моделей');
  if (entry.successRate === bestSuccessRate && entry.requests > 50) highlights.push('Наивысший success rate');
  if (entry.avgLatency === lowestLatency && entry.requests > 50) highlights.push('Самое быстрое среднее время ответа');
  if (rank <= 3) highlights.push(`Рейтинг #${rank} из ${total} пользователей`);
  if (entry.longestSessionMessages > 500) highlights.push(`Рекорд сессии: ${entry.longestSessionMessages.toLocaleString()} сообщений`);
  if (entry.activeDays >= 14) highlights.push(`Активен ${entry.activeDays} дней — стабильное ежедневное использование`);

  return { displayName: entry.displayName, summary, patterns, antiPatterns, pros, cons, recommendations, highlights };
}
