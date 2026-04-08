import { createMiddleware } from 'hono/factory';
import type { AuthService, ApiKeyInfo } from '../services/auth-service.ts';

type AuthEnv = {
  Variables: {
    apiKeyInfo: ApiKeyInfo;
  };
};

export function authMiddleware(authService: AuthService) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const apiKey = c.req.header('X-API-Key');

    if (!apiKey) {
      return c.json({ error: { code: 'MISSING_KEY', message: 'X-API-Key header required' } }, 401);
    }

    const keyInfo = authService.validateKey(apiKey);

    if (!keyInfo) {
      return c.json({ error: { code: 'INVALID_KEY', message: 'Invalid or inactive API key' } }, 401);
    }

    c.set('apiKeyInfo', keyInfo);
    await next();
  });
}

export type { AuthEnv };
