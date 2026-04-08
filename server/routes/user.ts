import { Hono } from 'hono';
import type { StatsService } from '../services/stats-service.ts';
import type { AuthService, ApiKeyInfo } from '../services/auth-service.ts';
import { authMiddleware } from '../middleware/auth.ts';

type AuthEnv = {
  Variables: {
    apiKeyInfo: ApiKeyInfo;
  };
};

export function userRoutes(statsService: StatsService, authService: AuthService) {
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
      keyName: keyInfo.name,
      keyId: keyInfo.id,
      noLog: keyInfo.noLog,
    });
  });

  // All /user/* routes require auth
  const authed = new Hono<AuthEnv>();
  authed.use('/*', authMiddleware(authService));

  authed.get('/stats', (c) => {
    const info = c.get('apiKeyInfo');
    const data = statsService.getUserPublicStats(info.name);
    if (!data) {
      return c.json({ error: { code: 'NO_DATA', message: 'No usage data found' } }, 404);
    }
    return c.json({ data });
  });

  authed.get('/models', (c) => {
    const info = c.get('apiKeyInfo');
    const data = statsService.getUserPublicStats(info.name);
    return c.json({ data: data?.models ?? [] });
  });

  app.route('/user', authed);

  return app;
}
