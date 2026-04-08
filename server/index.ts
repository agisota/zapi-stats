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
import type { Database } from 'bun:sqlite';

export function createApp(db: Database) {
  const app = new Hono();

  // Services
  const statsService = new StatsService(db);
  const authService = new AuthService(db);

  // Middleware
  app.use('*', cors());
  app.use('/api/*', logger());

  // API routes
  app.route('/api', healthRoutes());
  app.route('/api', leaderboardRoutes(statsService));
  app.route('/api', statsRoutes(statsService));
  app.route('/api', userRoutes(statsService, authService));

  return app;
}

export function createProductionApp(db: Database) {
  const app = createApp(db);

  // Serve static frontend in production
  app.use('/assets/*', serveStatic({ root: './dist' }));
  app.get('*', serveStatic({ root: './dist', path: '/index.html' }));

  return app;
}

// Production entry
async function startServer() {
  const { createDb } = await import('./db.ts');
  const dbPath = process.env.DB_PATH ?? '/data/storage.sqlite';
  const port = parseInt(process.env.PORT ?? '20129', 10);

  const db = createDb(dbPath);
  const app = createProductionApp(db);

  console.log(`OmniRoute Stats running on http://localhost:${port}`);

  Bun.serve({
    port,
    fetch: app.fetch,
  });
}

if (import.meta.main) {
  startServer();
}
