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
import { accountRoutes } from './routes/account.ts';
import { analyticsRoutes } from './routes/analytics.ts';
import { LogReader } from './services/log-reader.ts';
import { LanguageAnalyzer } from './services/language-analyzer.ts';
import { ToolAnalyzer } from './services/tool-analyzer.ts';
import { createAccountDb, createAccountMemoryDb } from './services/account-db.ts';
import { AccountService } from './services/account-service.ts';
import { ProvisioningService } from './services/provisioning-service.ts';
import { DvnetService } from './services/dvnet-service.ts';
import { UsageBillingService } from './services/usage-billing-service.ts';
import { AccountAnalyticsService } from './services/account-analytics-service.ts';
import { createMagicLinkMailer } from './services/magic-link-mailer.ts';
import type { Database } from 'bun:sqlite';

interface CreateAppOptions {
  logsPath?: string;
  accountDb?: Database;
  gatewayWriteDbPath?: string | null;
  dvnetEnv?: Record<string, string | undefined>;
  magicLinkEnv?: Record<string, string | undefined>;
  magicLinkFetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  enforceAccountBalance?: boolean;
}

export function createApp(db: Database, logsPathOrOptions?: string | CreateAppOptions, accountDb?: Database) {
  const options: CreateAppOptions = typeof logsPathOrOptions === 'string'
    ? { logsPath: logsPathOrOptions, accountDb }
    : (logsPathOrOptions ?? {});
  const app = new Hono();

  // Services
  const accountStateDb = options.accountDb ?? createAccountMemoryDb();
  const accountService = new AccountService(accountStateDb);
  const enforceAccountBalance = options.enforceAccountBalance ?? accountBalanceEnforcementEnabled();
  const provisioner = new ProvisioningService(accountStateDb, {
    gatewayWriteDbPath: options.gatewayWriteDbPath ?? null,
    enforceBalance: enforceAccountBalance,
  });
  const statsService = new StatsService(db);
  const logReader = new LogReader(db, options.logsPath);
  const languageAnalyzer = new LanguageAnalyzer(db, options.logsPath);
  const toolAnalyzer = new ToolAnalyzer(db, options.logsPath);
  const dvnet = new DvnetService(options.dvnetEnv ?? {});
  const magicLinks = createMagicLinkMailer(options.magicLinkEnv ?? process.env, options.magicLinkFetch);
  const usageBilling = new UsageBillingService(db, accountStateDb, accountService, provisioner, { enforceBalance: enforceAccountBalance });
  const accountAnalytics = new AccountAnalyticsService(db, accountStateDb);
  const authService = new AuthService(db, apiKey => {
    const owner = provisioner.findManagedKeyOwner(apiKey);
    if (!owner) return { handled: false, keyInfo: null };
    usageBilling.reconcileUser(owner.userId);
    return { handled: true, keyInfo: provisioner.validateManagedKey(apiKey) };
  });

  // Middleware
  app.use('*', cors({
    origin: allowedCorsOrigin,
    allowHeaders: ['Authorization', 'Content-Type', 'X-Account-Session', 'X_SIGN'],
    allowMethods: ['GET', 'HEAD', 'POST', 'PATCH', 'OPTIONS'],
    maxAge: 600,
  }));
  app.use('/api/*', logger());

  // API routes
  app.route('/api', healthRoutes());
  app.route('/api', leaderboardRoutes(statsService));
  app.route('/api', statsRoutes(statsService, languageAnalyzer, toolAnalyzer));
  app.route('/api', analyticsRoutes(accountAnalytics));
  app.route('/api', userRoutes(statsService, authService, logReader));
  app.route('/api', accountRoutes(accountService, provisioner, dvnet, usageBilling, accountAnalytics, magicLinks));
  app.route('/api', supportRoutes());
  app.route('/api', skillsRoutes());

  return app;
}

function allowedCorsOrigin(origin: string): string | null {
  if (!origin) return null;
  const configured = (process.env.CORS_ALLOWED_ORIGINS ?? process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  if (configured.length === 0) {
    return process.env.NODE_ENV === 'production' ? null : origin;
  }
  return configured.includes(origin) ? origin : null;
}

function accountBalanceEnforcementEnabled(): boolean {
  const raw = process.env.ACCOUNT_ENFORCE_BALANCE ?? '';
  return raw === '1' || raw.toLowerCase() === 'true';
}

export function createProductionApp(db: Database, logsPath?: string, accountDb?: Database) {
  const app = createApp(db, {
    logsPath,
    accountDb,
    gatewayWriteDbPath: process.env.OMNIROUTE_RW_DB_PATH ?? null,
    dvnetEnv: process.env,
    magicLinkEnv: process.env,
  });

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
  const accountDbPath = process.env.ACCOUNT_DB_PATH ?? `${process.env.APP_STATE_DIR ?? '/data/zapi-stats-state'}/account.sqlite`;
  const port = parseInt(process.env.PORT ?? '20129', 10);
  const hostname = process.env.BIND_HOST ?? process.env.HOST ?? '0.0.0.0';

  const db = createDb(dbPath);
  const accountDb = createAccountDb(accountDbPath);
  const app = createProductionApp(db, logsPath, accountDb);

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
