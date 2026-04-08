import { Hono } from 'hono';
import type { StatsService } from '../services/stats-service.ts';

export function leaderboardRoutes(statsService: StatsService) {
  const app = new Hono();

  app.get('/leaderboard', (c) => {
    const data = statsService.getLeaderboard();
    return c.json({ data });
  });

  return app;
}
