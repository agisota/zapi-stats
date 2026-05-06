import { Hono } from 'hono';
import type { StatsService } from '../services/stats-service.ts';
import { generateUserProfile } from '../services/profile-service.ts';
import type { LanguageAnalyzer } from '../services/language-analyzer.ts';
import type { ToolAnalyzer } from '../services/tool-analyzer.ts';

interface UpstreamModel {
  id?: string;
  root?: string | null;
  parent?: string | null;
  owned_by?: string | null;
  created?: number | null;
  context_length?: number | null;
  max_input_tokens?: number | null;
  max_output_tokens?: number | null;
  capabilities?: Record<string, boolean>;
  input_modalities?: string[];
  output_modalities?: string[];
}

const CURATED_NEW_MODEL_ALIASES = [
  'cx/codex-auto-review',
  'codex/codex-auto-review',
  'cx/gpt-5.5-xhigh',
  'codex/gpt-5.3-codex-spark',
  'cx/gpt-5.3-codex-spark',
  'opencode-go/deepseek-v4-pro',
  'opencode-go/deepseek-v4-flash',
  'fireworks/accounts/fireworks/models/deepseek-v3p2',
  'opencode-go/minimax-m2.7',
  'fireworks/accounts/fireworks/models/minimax-m2p7',
  'opencode-go/qwen3.6-plus',
  'fireworks/accounts/fireworks/models/qwen3p6-plus',
  'opencode-go/qwen3.5-plus',
  'together/Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8',
];

const CUSTOM_ENDPOINT_BASE_URL = 'https://api.zed.md/v1';
const LEGACY_UPSTREAM_PREFIX = ['OMNI', 'ROUTE'].join('');

function upstreamModelsUrl(): string {
  return process.env.API_ZED_MODELS_URL
    ?? process.env.UPSTREAM_MODELS_URL
    ?? process.env[`${LEGACY_UPSTREAM_PREFIX}_MODELS_URL`]
    ?? 'http://127.0.0.1:20130/v1/models';
}

const CUSTOM_ENDPOINTS = [
  { alias: 'dugin400', kind: 'chat', title: 'Dugin 400', description: 'длинный контекст для сложных русскоязычных разборов', status: 'active' },
  { alias: 'faster200', kind: 'chat', title: 'Faster 200', description: 'быстрый универсальный маршрут до 200K контекста', status: 'active' },
  { alias: 'code200', kind: 'code', title: 'Code 200', description: 'кодовые задачи, рефакторинг, patch-планирование', status: 'active' },
  { alias: 'spark', kind: 'code', title: 'Spark', description: 'дешевый быстрый Codex Spark для коротких задач', status: 'active' },
  { alias: 'batch', kind: 'batch', title: 'Batch', description: 'пакетные запросы и массовая обработка', status: 'active' },
  { alias: 'kimi', kind: 'chat', title: 'Kimi', description: 'альтернативный coding/chat маршрут', status: 'active' },
  { alias: 'gpt', kind: 'chat', title: 'GPT', description: 'короткий вход в основной GPT маршрут', status: 'active' },
  { alias: 'mini', kind: 'chat', title: 'Mini', description: 'легкий быстрый маршрут для простых задач', status: 'active' },
  { alias: 'embed', kind: 'embedding', title: 'Embed', description: 'эмбеддинги для поиска, памяти и семантики', status: 'active' },
  { alias: 'image', kind: 'image', title: 'Image', description: 'генерация и обработка изображений', status: 'active' },
  { alias: 'rerank', kind: 'rerank', title: 'Rerank', description: 'ранжирование результатов поиска и retrieval пайплайнов', status: 'active' },
].map(endpoint => ({
  ...endpoint,
  baseUrl: CUSTOM_ENDPOINT_BASE_URL,
  modelParam: endpoint.alias,
  usageHint: 'Укажите этот alias как model: API gateway автоматически выберет provider route/fallback для стабильного pipeline.',
}));
const CURATED_UNAVAILABLE_CLAUDE = [
  { alias: 'Claude Opus', root: 'claude-opus', id: 'claude/claude-opus' },
  { alias: 'Claude Sonnet', root: 'claude-sonnet', id: 'claude/claude-sonnet' },
  { alias: 'Claude Haiku', root: 'claude-haiku', id: 'claude/claude-haiku' },
];

async function fetchModelsWithTimeout(timeoutMs: number): Promise<UpstreamModel[]> {
  const modelsUrl = upstreamModelsUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(modelsUrl, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json() as { data?: UpstreamModel[] };
    return Array.isArray(body.data) ? body.data : [];
  } finally {
    clearTimeout(timeout);
  }
}

export function statsRoutes(statsService: StatsService, languageAnalyzer?: LanguageAnalyzer, toolAnalyzer?: ToolAnalyzer) {
  const app = new Hono();

  app.get('/stats/overview', (c) => {
    const data = statsService.getOverview();
    return c.json({ data });
  });

  app.get('/stats/models', (c) => {
    const data = statsService.getModelStats();
    return c.json({ data });
  });

  app.get('/models/availability', async (c) => {
    const usedModels = statsService.getModelStats();
    const usedById = new Map(usedModels.map(model => [`${model.provider}/${model.model}`, model]));
    const usedByModel = new Map(usedModels.map(model => [model.model, model]));

    try {
      const upstream = await fetchModelsWithTimeout(3500);
      const now = Math.floor(Date.now() / 1000);
      const aliases = upstream.map(model => {
        const id = model.id ?? '';
        const provider = id.includes('/') ? id.split('/')[0] ?? '' : model.owned_by ?? '';
        const shortId = id.includes('/') ? id.slice(id.indexOf('/') + 1) : id;
        const usage = usedById.get(id) ?? usedByModel.get(shortId) ?? usedByModel.get(model.root ?? '');
        const created = typeof model.created === 'number' ? model.created : null;
        return {
          id,
          alias: displayModelName(id),
          root: model.root ?? shortId,
          parent: model.parent ?? null,
          provider,
          ownedBy: model.owned_by ?? provider,
          contextLength: model.context_length ?? model.max_input_tokens ?? null,
          maxInputTokens: model.max_input_tokens ?? null,
          maxOutputTokens: model.max_output_tokens ?? null,
          capabilities: model.capabilities ?? {},
          inputModalities: model.input_modalities ?? [],
          outputModalities: model.output_modalities ?? [],
          created,
          isNew: created ? now - created < 14 * 24 * 60 * 60 : !usage,
          usageCount: usage?.count ?? 0,
          successRate: usage?.successRate ?? null,
          avgLatency: usage?.avgLatency ?? null,
          lastSeen: usage?.lastSeen ?? null,
        };
      }).filter(model => model.id);

      const aliasById = new Map(aliases.map(model => [model.id, model]));
      const available = dedupeModels(aliases)
        .filter(model => !/claude-(opus|sonnet|haiku)/i.test(model.id))
        .sort((a, b) => Number(b.isNew) - Number(a.isNew) || (b.usageCount - a.usageCount) || a.id.localeCompare(b.id));
      const seenNewFamilies = new Set<string>();
      const curatedNewModels = CURATED_NEW_MODEL_ALIASES
        .map(alias => aliasById.get(alias))
        .filter((model): model is (typeof aliases)[number] => Boolean(model))
        .filter(model => {
          const family = normalizeModelFamily(model.id);
          if (seenNewFamilies.has(family)) return false;
          seenNewFamilies.add(family);
          return true;
        });
      const newModels = dedupeModels(curatedNewModels).slice(0, 12);
      const unavailable = CURATED_UNAVAILABLE_CLAUDE.map(item => ({
        id: item.id,
        alias: item.alias,
        root: item.root,
        parent: null,
        provider: 'claude',
        ownedBy: 'claude',
        contextLength: item.root.includes('haiku') ? 200_000 : 1_000_000,
        maxInputTokens: null,
        maxOutputTokens: item.root.includes('haiku') ? 64_000 : 128_000,
        capabilities: { vision: true, tools: true },
        inputModalities: ['text', 'image'],
        outputModalities: ['text'],
        created: null,
        isNew: false,
        usageCount: 0,
        successRate: 0,
        avgLatency: null,
        lastSeen: null,
      }));

      return c.json({
        data: {
          total: aliases.length,
          available: available.slice(0, 32),
          newModels,
          unavailable,
          endpoints: CUSTOM_ENDPOINTS,
          checkedAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      return c.json({
        data: {
          total: usedModels.length,
          available: usedModels.slice(0, 24).map(model => ({
            id: `${model.provider}/${model.model}`,
            alias: displayModelName(`${model.provider}/${model.model}`),
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
            usageCount: model.count,
            successRate: model.successRate,
            avgLatency: model.avgLatency,
            lastSeen: model.lastSeen,
          })),
          newModels: [],
          unavailable: [],
          endpoints: CUSTOM_ENDPOINTS,
          checkedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : 'models endpoint unavailable',
        },
      });
    }
  });

  app.get('/stats/providers', (c) => {
    const data = statsService.getProviderStats();
    return c.json({ data });
  });

  app.get('/stats/timeline', (c) => {
    const period = c.req.query('period') ?? '24h';
    const data = statsService.getTimeline(period);
    return c.json({ data });
  });

  app.get('/stats/user/:name', (c) => {
    const name = c.req.param('name');
    const data = statsService.getUserPublicStats(name);
    if (!data) {
      return c.json({ error: { code: 'NOT_FOUND', message: `User "${name}" not found` } }, 404);
    }
    return c.json({ data });
  });

  app.get('/stats/user/:name/profile', (c) => {
    const name = c.req.param('name');
    const leaderboard = statsService.getLeaderboard();
    const entry = leaderboard.find(e => e.name === name);
    if (!entry) {
      return c.json({ error: { code: 'NOT_FOUND', message: `User "${name}" not found` } }, 404);
    }
    const profile = generateUserProfile(entry, leaderboard);
    return c.json({ data: profile });
  });

  if (languageAnalyzer) {
    app.get('/stats/user/:name/language', async (c) => {
      const name = c.req.param('name');
      const data = await languageAnalyzer.getUserLanguageStats(name);
      return c.json({ data });
    });
  }

  if (toolAnalyzer) {
    app.get('/stats/user/:name/tools', async (c) => {
      const name = c.req.param('name');
      const data = await toolAnalyzer.getUserToolStats(name);
      return c.json({ data });
    });

    app.get('/stats/user/:name/artifacts', async (c) => {
      const name = c.req.param('name');
      const data = await toolAnalyzer.getUserArtifactStats(name);
      return c.json({ data });
    });
  }

  return app;
}

function displayModelName(id: string): string {
  const normalized = id.trim();
  const withoutProvider = normalized
    .replace(/^fireworks\/accounts\/fireworks\/models\//i, '')
    .replace(/^fireworks\/accounts\/fireworks\/routers\//i, '')
    .replace(/^together\/(?:Qwen|deepseek-ai|moonshotai|openai|google|Wan-AI)\//i, '')
    .replace(/^(cx|codex|openrouter|opencode-go|fireworks|together|groq|cerebras|samba|sambanova|mistral|cohere|xai|glm|kmc|kimi-coding)\//i, '');
  return withoutProvider
    .replace(/^openai\//i, '')
    .replace(/^qwen\//i, '')
    .replace(/^models\//i, '')
    .replace(/^routers\//i, '');
}

function normalizeModelFamily(id: string): string {
  const normalized = id.toLowerCase();
  if (normalized.includes('gpt-5.5-xhigh')) return 'gpt-5.5-xhigh';
  if (normalized.includes('gpt-5.5-high')) return 'gpt-5.5-high';
  if (normalized.includes('gpt-5.5-medium')) return 'gpt-5.5-medium';
  if (normalized.includes('gpt-5.5-mini')) return 'gpt-5.5-mini';
  if (normalized.includes('gpt-5.3-codex-spark')) return 'gpt-5.3-codex-spark';
  if (normalized.includes('codex-auto-review')) return 'codex-auto-review';
  if (normalized.includes('deepseek-v4-pro')) return 'deepseek-v4-pro';
  if (normalized.includes('deepseek-v4-flash')) return 'deepseek-v4-flash';
  if (normalized.includes('deepseek')) return 'deepseek';
  if (normalized.includes('minimax-m2.7') || normalized.includes('minimax-m2p7')) return 'minimax-m2.7';
  if (normalized.includes('qwen3.6-plus') || normalized.includes('qwen3p6-plus')) return 'qwen3.6-plus';
  if (normalized.includes('qwen3.5-plus')) return 'qwen3.5-plus';
  return normalized.replace(/^(cx|codex|openrouter|opencode-go|fireworks|together)\//, '');
}

function dedupeModels<T extends { alias: string; usageCount?: number | null; successRate?: number | null; contextLength?: number | null }>(models: T[]): T[] {
  const byAlias = new Map<string, T>();
  for (const model of models) {
    const key = model.alias.toLowerCase();
    const current = byAlias.get(key);
    if (!current) {
      byAlias.set(key, model);
      continue;
    }
    const modelScore = (model.usageCount ?? 0) * 10 + (model.successRate ?? 0) + (model.contextLength ? 1 : 0);
    const currentScore = (current.usageCount ?? 0) * 10 + (current.successRate ?? 0) + (current.contextLength ? 1 : 0);
    if (modelScore > currentScore) byAlias.set(key, model);
  }
  return [...byAlias.values()];
}
