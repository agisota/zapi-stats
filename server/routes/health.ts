import { Hono } from 'hono';

const startedAt = Date.now();

export function healthRoutes() {
  const app = new Hono();

  app.get('/health', (c) => {
    return c.json({
      status: 'ok',
      uptime: Math.floor((Date.now() - startedAt) / 1000),
      version: '1.0.0',
    });
  });

  return app;
}
