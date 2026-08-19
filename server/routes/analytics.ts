import { Hono } from 'hono';
import type { AccountAnalyticsService } from '../services/account-analytics-service.ts';

export function analyticsRoutes(analytics: AccountAnalyticsService) {
  const app = new Hono();

  app.get('/stats/skills/analytics', (c) => {
    const days = readDays(c.req.query('period') ?? c.req.query('days'));
    return c.json({ data: analytics.getGlobalSkillAnalytics(days) });
  });

  app.get('/stats/expenses/users', (c) => {
    const days = readDays(c.req.query('period') ?? c.req.query('days'));
    return c.json({ data: analytics.getGlobalExpenseAnalytics(days) });
  });

  return app;
}

function readDays(raw: string | undefined): number {
  if (!raw) return 30;
  if (raw === '24h') return 1;
  if (raw === '7d') return 7;
  if (raw === '30d') return 30;
  if (raw === '90d') return 90;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(365, Math.round(parsed))) : 30;
}
