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
import { LogReader } from './services/log-reader.ts';
import { LanguageAnalyzer } from './services/language-analyzer.ts';
import { ToolAnalyzer } from './services/tool-analyzer.ts';
import type { Database } from 'bun:sqlite';

export function createApp(db: Database, logsPath?: string) {
  const app = new Hono();

  // Services
  const statsService = new StatsService(db);
  const authService = new AuthService(db);
  const logReader = logsPath ? new LogReader(logsPath) : undefined;
  const languageAnalyzer = logsPath ? new LanguageAnalyzer(logsPath) : undefined;
  const toolAnalyzer = logsPath ? new ToolAnalyzer(logsPath) : undefined;

  // Middleware
  app.use('*', cors());
  app.use('/api/*', logger());

  // API routes
  app.route('/api', healthRoutes());
  app.route('/api', leaderboardRoutes(statsService));
  app.route('/api', statsRoutes(statsService, languageAnalyzer, toolAnalyzer));
  app.route('/api', userRoutes(statsService, authService, logReader));

  return app;
}

export function createProductionApp(db: Database, logsPath?: string) {
  const app = createApp(db, logsPath);

  // Serve static frontend in production
  app.use('/assets/*', serveStatic({ root: './dist' }));
  app.get('*', serveStatic({ root: './dist', path: '/index.html' }));

  return app;
}

// Production entry
async function startServer() {
  const { createDb } = await import('./db.ts');
  const dbPath = process.env.DB_PATH ?? '/data/storage.sqlite';
  const logsPath = process.env.LOGS_PATH ?? '/data/call_logs';
  const port = parseInt(process.env.PORT ?? '20129', 10);

  const db = createDb(dbPath);
  const app = createProductionApp(db, logsPath);

  console.log(`OmniRoute Stats running on http://localhost:${port}`);

  Bun.serve({
    port,
    fetch: app.fetch,
  });
}

if (import.meta.main) {
  startServer();
}
