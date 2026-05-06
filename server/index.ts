import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serveStatic } from 'hono/bun';
import { StatsService } from './services/stats-service.ts';
import { AuthService } from './services/auth-service.ts';
import { healthRoutes } from './routes/health.ts';
import { leaderboardRoutes } from './routes/leaderboard.ts';
import { statsRoutes } from './routes/stats.ts';
import { userRoutes } from './routes/user.ts';
import { supportRoutes } from './routes/support.ts';
import { skillsRoutes } from './routes/skills.ts';
import { LogReader } from './services/log-reader.ts';
import { LanguageAnalyzer } from './services/language-analyzer.ts';
import { ToolAnalyzer } from './services/tool-analyzer.ts';
import type { Database } from 'bun:sqlite';

export function createApp(db: Database, logsPath?: string) {
  const app = new Hono();

  // Services
  const statsService = new StatsService(db);
  const authService = new AuthService(db);
  const logReader = new LogReader(db, logsPath);
  const languageAnalyzer = new LanguageAnalyzer(db, logsPath);
  const toolAnalyzer = new ToolAnalyzer(db, logsPath);

  // Middleware
  app.use('*', cors());
  app.use('/api/*', logger());

  // API routes
  app.route('/api', healthRoutes());
  app.route('/api', leaderboardRoutes(statsService));
  app.route('/api', statsRoutes(statsService, languageAnalyzer, toolAnalyzer));
  app.route('/api', userRoutes(statsService, authService, logReader));
  app.route('/api', supportRoutes());
  app.route('/api', skillsRoutes());

  return app;
}

export function createProductionApp(db: Database, logsPath?: string) {
  const app = createApp(db, logsPath);

  // Serve static frontend in production
  app.use('/assets/*', serveStatic({ root: './dist' }));
  app.get('*', async (c) => {
    const htmlFile = Bun.file('./dist/index.html');
    const html = await htmlFile.text();
    const host = c.req.header('host')?.split(':')[0]?.toLowerCase() ?? '';
    const title = host === 'skills.api.zed.md' || c.req.path.startsWith('/skills')
      ? 'Навыки агентов — API ZED'
      : 'Рейтинг API — API ZED';

    return c.html(html.replace(/<title>.*?<\/title>/, `<title>${title}</title>`));
  });

  return app;
}

// Production entry
async function startServer() {
  const { createDb } = await import('./db.ts');
  const dbPath = process.env.DB_PATH ?? '/data/omniroute/storage.sqlite';
  const logsPath = process.env.LOGS_PATH ?? '/data/omniroute/call_logs';
  const port = parseInt(process.env.PORT ?? '20129', 10);
  const hostname = process.env.BIND_HOST ?? process.env.HOST ?? '0.0.0.0';

  const db = createDb(dbPath);
  const app = createProductionApp(db, logsPath);

  console.log(`API ZED Stats running on http://${hostname}:${port}`);

  Bun.serve({
    hostname,
    port,
    fetch: app.fetch,
  });
}

if (import.meta.main) {
  startServer();
}
