import { Hono } from 'hono';
import type { StatsService } from '../services/stats-service.ts';

export function statsRoutes(statsService: StatsService) {
  const app = new Hono();

  app.get('/stats/overview', (c) => {
    const data = statsService.getOverview();
    return c.json({ data });
  });

  app.get('/stats/models', (c) => {
    const data = statsService.getModelStats();
    return c.json({ data });
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

  return app;
}
