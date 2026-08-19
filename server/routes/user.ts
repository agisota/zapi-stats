import { Hono } from 'hono';
import type { StatsService } from '../services/stats-service.ts';
import type { AuthService, ApiKeyInfo } from '../services/auth-service.ts';
import type { LogReader } from '../services/log-reader.ts';
import { authMiddleware } from '../middleware/auth.ts';
import type { Anonymizer } from '../services/anonymizer.ts';

type AuthEnv = {
  Variables: {
    apiKeyInfo: ApiKeyInfo;
  };
};

export function userRoutes(statsService: StatsService, authService: AuthService, anonymizer: Anonymizer, logReader?: LogReader) {
  const app = new Hono<AuthEnv>();

  // Auth validation endpoint (no middleware needed)
  app.post('/auth/validate', async (c) => {
    const body = await c.req.json().catch(() => null);
    const apiKey = (body as { key?: string } | null)?.key ?? c.req.header('X-API-Key');

    if (!apiKey) {
      return c.json({ valid: false, error: 'API key required' }, 400);
    }

    const keyInfo = authService.validateKey(apiKey);
    if (!keyInfo) {
      return c.json({ valid: false, error: 'Invalid or inactive key' }, 401);
    }

    return c.json({
      valid: true,
      keyName: anonymizer.alias(keyInfo.name),
      keyId: keyInfo.id,
      noLog: keyInfo.noLog,
    });
  });

  // All /user/* routes require auth
  const authed = new Hono<AuthEnv>();
  authed.use('/*', authMiddleware(authService));

  authed.get('/stats', (c) => {
    const info = c.get('apiKeyInfo');
    const data = statsService.getAuthenticatedUserStats(info.name);
    if (!data) {
      return c.json({ error: { code: 'NO_DATA', message: 'No usage data found' } }, 404);
    }
    return c.json({ data });
  });

  authed.get('/models', (c) => {
    const info = c.get('apiKeyInfo');
    const data = statsService.getAuthenticatedUserStats(info.name);
    return c.json({ data: data?.models ?? [] });
  });

  // Log endpoints (require LogReader)
  if (logReader) {
    authed.get('/balance', (c) => {
      const info = c.get('apiKeyInfo');
      const data = logReader.getUserBalance(info.name, info.createdAt);
      return c.json({ data });
    });

    authed.get('/activity', (c) => {
      const info = c.get('apiKeyInfo');
      if (info.noLog) {
        return c.json({ error: { code: 'NO_LOG', message: 'Logging disabled for this key' } }, 403);
      }

      const data = logReader.getUserActivityAnalytics(info.name);
      return c.json({ data });
    });

    authed.get('/skills-mapping', (c) => {
      const info = c.get('apiKeyInfo');
      if (info.noLog) {
        return c.json({ error: { code: 'NO_LOG', message: 'Logging disabled for this key' } }, 403);
      }

      const data = logReader.getUserSkillsMapping(info.name);
      return c.json({ data });
    });

    authed.get('/logs', async (c) => {
      const info = c.get('apiKeyInfo');
      if (info.noLog) {
        return c.json({ error: { code: 'NO_LOG', message: 'Logging disabled for this key' } }, 403);
      }

      const cursor = c.req.query('cursor') ?? undefined;
      const q = c.req.query('q') ?? undefined;
      const limit = parseInt(c.req.query('limit') ?? '50', 10);
      const offset = parseInt(c.req.query('offset') ?? '0', 10);
      const date = c.req.query('date') ?? undefined;
      const dateFrom = c.req.query('dateFrom') ?? undefined;
      const dateTo = c.req.query('dateTo') ?? undefined;
      const model = c.req.query('model') ?? undefined;
      const provider = c.req.query('provider') ?? undefined;
      const status = c.req.query('status') ?? undefined;
      const sort = c.req.query('sort') ?? undefined;
      const order = c.req.query('order') ?? undefined;

      const page = await logReader.getUserLogs(info.name, { cursor, q, limit, offset, date, dateFrom, dateTo, model, provider, status, sort, order });
      const logs = page.logs.map(({ apiKeyName: _, error: __, ...entry }) => entry);
      return c.json({ data: { ...page, logs } });
    });

    authed.get('/log-facets', async (c) => {
      const info = c.get('apiKeyInfo');
      if (info.noLog) {
        return c.json({ error: { code: 'NO_LOG', message: 'Logging disabled for this key' } }, 403);
      }

      const data = logReader.getUserLogFacets(info.name);
      return c.json({ data });
    });

    authed.get('/sessions', async (c) => {
      const info = c.get('apiKeyInfo');
      if (info.noLog) {
        return c.json({ error: { code: 'NO_LOG', message: 'Logging disabled for this key' } }, 403);
      }

      const data = logReader.getUserSessions(info.name);
      return c.json({ data });
    });

    authed.get('/logs/:id', async (c) => {
      const info = c.get('apiKeyInfo');
      if (info.noLog) {
        return c.json({ error: { code: 'NO_LOG', message: 'Logging disabled for this key' } }, 403);
      }

      const logId = c.req.param('id');
      const detail = await logReader.getLogDetail(info.name, logId);

      if (!detail) {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Log entry not found' } }, 404);
      }

      // Verify this log belongs to the authenticated user
      if (detail.apiKeyName !== info.name) {
        return c.json({ error: { code: 'FORBIDDEN', message: 'Access denied' } }, 403);
      }

      const {
        id, timestamp, model, provider, status, duration, tokensIn, tokensOut,
        sourceFormat, targetFormat, method, path,
      } = detail;
      return c.json({
        data: {
          id, timestamp, model, provider, status, duration, tokensIn, tokensOut,
          sourceFormat, targetFormat, method, path,
        },
      });
    });
  }

  app.route('/user', authed);

  return app;
}
