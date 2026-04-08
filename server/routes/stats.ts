import { Hono } from 'hono';
import type { StatsService } from '../services/stats-service.ts';
import { generateUserProfile } from '../services/profile-service.ts';
import type { LanguageAnalyzer } from '../services/language-analyzer.ts';
import type { ToolAnalyzer } from '../services/tool-analyzer.ts';

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
