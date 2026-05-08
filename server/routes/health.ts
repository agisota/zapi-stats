import { Hono } from 'hono';

const startedAt = Date.now();
const LEGACY_UPSTREAM_PREFIX = ['OMNI', 'ROUTE'].join('');

function upstreamEnv(name: 'HEALTH_URL' | 'MODELS_URL', fallback: string): string {
  return process.env[`API_ZED_${name}`]
    ?? process.env[`UPSTREAM_${name}`]
    ?? process.env[`${LEGACY_UPSTREAM_PREFIX}_${name}`]
    ?? fallback;
}

async function fetchJsonWithTimeout<T>(url: string, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json() as T;
  } finally {
    clearTimeout(timeout);
  }
}

export function healthRoutes() {
  const app = new Hono();

  app.get('/health', (c) => {
    return c.json({
      status: 'ok',
      uptime: Math.floor((Date.now() - startedAt) / 1000),
      version: '1.0.0',
    });
  });

  app.get('/deployment/status', async (c) => {
    const healthUrl = upstreamEnv('HEALTH_URL', 'http://127.0.0.1:20130/api/monitoring/health');
    const modelsUrl = upstreamEnv('MODELS_URL', 'http://127.0.0.1:20130/v1/models');

    try {
      const health = await fetchJsonWithTimeout<{
        status?: string;
        version?: string;
        activeConnections?: number;
        providerSummary?: {
          catalogCount?: number;
          configuredCount?: number;
          activeCount?: number;
          monitoredCount?: number;
        };
        circuitBreakers?: {
          open?: number;
          halfOpen?: number;
          closed?: number;
          total?: number;
        };
        system?: {
          uptime?: number;
          memoryUsage?: { rss?: number; heapUsed?: number; heapTotal?: number };
          nodeVersion?: string;
        };
      }>(healthUrl, 2500);

      let modelCount: number | null = null;
      try {
        const models = await fetchJsonWithTimeout<{ data?: unknown[] }>(modelsUrl, 3500);
        modelCount = Array.isArray(models.data) ? models.data.length : null;
      } catch {
        modelCount = null;
      }

      return c.json({
        data: {
          status: health.status ?? 'unknown',
          version: health.version ?? 'unknown',
          activeConnections: health.activeConnections ?? 0,
          providerSummary: health.providerSummary ?? {},
          circuitBreakers: health.circuitBreakers ?? {},
          modelCount,
          nodeVersion: health.system?.nodeVersion ?? null,
          uptime: health.system?.uptime ?? null,
          memoryRss: health.system?.memoryUsage?.rss ?? null,
          checkedAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      return c.json({
        data: {
          status: 'unreachable',
          version: 'unknown',
          activeConnections: 0,
          providerSummary: {},
          circuitBreakers: {},
          modelCount: null,
          nodeVersion: null,
          uptime: null,
          memoryRss: null,
          checkedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : 'unknown error',
        },
      });
    }
  });

  return app;
}
