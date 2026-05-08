import { Hono } from 'hono';
import type { AccountUser } from '../services/account-service.ts';
import { AccountError, AccountService } from '../services/account-service.ts';
import { DvnetError, DvnetService } from '../services/dvnet-service.ts';
import { ProvisioningError, ProvisioningService, type KeyLimits } from '../services/provisioning-service.ts';
import type { UsageBillingService } from '../services/usage-billing-service.ts';
import type { AccountAnalyticsService, SkillEventAction } from '../services/account-analytics-service.ts';

type AccountEnv = {
  Variables: {
    accountUser: AccountUser;
  };
};

const MAX_JSON_BODY_BYTES = 16 * 1024;
const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export function accountRoutes(
  accountService: AccountService,
  provisioner: ProvisioningService,
  dvnet: DvnetService,
  usageBilling?: UsageBillingService,
  analytics?: AccountAnalyticsService,
) {
  const app = new Hono<AccountEnv>();

  app.post('/account/register', async (c) => {
    try {
      const limited = rateLimit(c, 'account.register', 10, 60 * 60 * 1000);
      if (limited) return limited;
      const body = await readJsonBody(c);
      const autoVerify = process.env.NODE_ENV !== 'production' || process.env.ACCOUNT_AUTO_VERIFY === '1';
      const { user, session } = accountService.register({
        email: String((body as { email?: string }).email ?? ''),
        displayName: typeof (body as { displayName?: unknown }).displayName === 'string' ? (body as { displayName: string }).displayName : undefined,
        autoVerify,
      });
      const defaultKey = user.status === 'active'
        ? provisioner.createKey({ userId: user.id, userEmail: user.email, userDisplayName: user.displayName })
        : null;
      return c.json({
        data: {
          user,
          sessionToken: user.status === 'active' ? session.token : null,
          defaultKey,
          verificationRequired: user.status !== 'active',
        },
      }, 201);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.post('/account/login', async (c) => {
    try {
      const limited = rateLimit(c, 'account.login', 20, 15 * 60 * 1000);
      if (limited) return limited;
      const body = await readJsonBody(c);
      if (process.env.ACCOUNT_ALLOW_EMAIL_LOGIN !== '1' && process.env.NODE_ENV === 'production') {
        return c.json({ error: { code: 'LOGIN_DISABLED', message: 'Email-only login is disabled in production. Use API key login or configure a verified magic-link provider.' } }, 403);
      }
      const { user, session } = accountService.loginByEmail(String((body as { email?: string }).email ?? ''));
      return c.json({ data: { user, sessionToken: session.token } });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  const authed = new Hono<AccountEnv>();
  authed.use('/*', async (c, next) => {
    const token = accountToken(c.req.header('Authorization'), c.req.header('X-Account-Session'));
    const user = accountService.authenticate(token);
    if (!user) return c.json({ error: { code: 'ACCOUNT_UNAUTHORIZED', message: 'Account session required' } }, 401);
    c.set('accountUser', user);
    await next();
  });

  authed.get('/me', (c) => c.json({ data: { user: c.get('accountUser') } }));

  authed.get('/billing/balance', (c) => {
    const user = c.get('accountUser');
    const usageSync = usageBilling?.reconcileUser(user.id) ?? null;
    return c.json({ data: { ...accountService.getBalance(user.id), usageSync } });
  });

  authed.get('/billing/ledger', (c) => {
    const user = c.get('accountUser');
    usageBilling?.reconcileUser(user.id);
    const limit = Number(c.req.query('limit') ?? 50);
    return c.json({ data: accountService.getLedger(user.id, limit) });
  });

  authed.get('/billing/expenses', (c) => {
    const user = c.get('accountUser');
    const days = readDays(c.req.query('period') ?? c.req.query('days'));
    return c.json({ data: analytics?.getUserExpenseAnalytics(user.id, days) ?? emptyExpenseAnalytics() });
  });

  authed.post('/billing/topup', async (c) => {
    try {
      const user = c.get('accountUser');
      const limited = rateLimit(c, `billing.topup.${user.id}`, 10, 15 * 60 * 1000);
      if (limited) return limited;
      const body = await readJsonBody(c);
      const amount = Number((body as { amount?: number }).amount);
      const createdIntent = accountService.createPaymentIntent(user.id, amount, { source: 'account_console' });
      const checkout = await dvnet.createDepositWallet({ storeExternalId: createdIntent.id, amount: createdIntent.amount });
      const intent = accountService.attachPaymentCheckout({
        intentId: createdIntent.id,
        userId: user.id,
        checkoutUrl: checkout.checkoutUrl,
        providerPaymentId: checkout.providerPaymentId,
        metadata: checkout.raw,
      });
      return c.json({ data: { intent, checkout } }, 201);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  authed.get('/keys', (c) => {
    const user = c.get('accountUser');
    usageBilling?.reconcileUser(user.id);
    return c.json({ data: provisioner.listKeys(user.id) });
  });

  authed.post('/keys', async (c) => {
    try {
      const user = c.get('accountUser');
      const limited = rateLimit(c, `account.keys.create.${user.id}`, 20, 60 * 60 * 1000);
      if (limited) return limited;
      const body = await readJsonBody(c);
      const key = provisioner.createKey({
        userId: user.id,
        userEmail: user.email,
        userDisplayName: user.displayName,
        displayName: typeof (body as { displayName?: unknown }).displayName === 'string' ? (body as { displayName: string }).displayName : undefined,
        noLog: (body as { noLog?: boolean }).noLog === true,
        limits: readLimits(body),
      });
      return c.json({ data: key }, 201);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  authed.post('/keys/:id/revoke', (c) => {
    try {
      const user = c.get('accountUser');
      return c.json({ data: provisioner.revokeKey(user.id, c.req.param('id')) });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  authed.post('/keys/:id/rotate', (c) => {
    try {
      const user = c.get('accountUser');
      const limited = rateLimit(c, `account.keys.rotate.${user.id}`, 20, 60 * 60 * 1000);
      if (limited) return limited;
      return c.json({ data: provisioner.rotateKey({ userId: user.id, userEmail: user.email, userDisplayName: user.displayName, keyId: c.req.param('id') }) });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  authed.patch('/keys/:id/limits', async (c) => {
    try {
      const user = c.get('accountUser');
      const limited = rateLimit(c, `account.keys.limits.${user.id}`, 60, 60 * 60 * 1000);
      if (limited) return limited;
      const body = await readJsonBody(c);
      return c.json({ data: provisioner.updateLimits(user.id, c.req.param('id'), readLimits(body)) });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  authed.get('/skills/analytics', (c) => {
    const user = c.get('accountUser');
    const days = readDays(c.req.query('period') ?? c.req.query('days'));
    return c.json({ data: analytics?.getUserSkillAnalytics(user.id, days) ?? emptySkillAnalytics() });
  });

  authed.post('/skills/:id/activate', async (c) => {
    try {
      if (!analytics) return c.json({ error: { code: 'ANALYTICS_DISABLED', message: 'Skill analytics is not configured' } }, 503);
      const user = c.get('accountUser');
      const limited = rateLimit(c, `account.skills.activate.${user.id}`, 240, 60 * 60 * 1000);
      if (limited) return limited;
      const body = await readJsonBody(c);
      const action = readSkillAction((body as { action?: unknown } | null)?.action);
      const source = typeof (body as { source?: unknown } | null)?.source === 'string'
        ? (body as { source: string }).source
        : 'skills_catalog';
      const data = analytics.recordSkillEvent({
        userId: user.id,
        skillId: c.req.param('id'),
        action,
        source,
        metadata: { userAgent: c.req.header('user-agent') ?? null },
      });
      return c.json({ data }, 201);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.post('/billing/dvnet/webhook', async (c) => {
    try {
      const limited = rateLimit(c, 'billing.dvnet.webhook', 120, 60 * 1000);
      if (limited) return limited;
      const raw = await readRawBody(c, MAX_WEBHOOK_BODY_BYTES);
      if (!dvnet.verifyWebhook(raw, c.req.header('X_SIGN') ?? null)) {
        return c.json({ error: { code: 'INVALID_SIGNATURE', message: 'Invalid DV.net webhook signature' } }, 401);
      }
      const parsed = JSON.parse(raw) as unknown;
      const payment = dvnet.parsePaymentWebhook(parsed);
      if (!payment) return c.json({ success: true });
      const result = accountService.completeDvnetPayment({
        paymentIntentId: payment.paymentIntentId,
        amount: payment.amount,
        externalRef: payment.externalRef,
        providerPaymentId: payment.providerPaymentId,
        metadata: payment.raw,
      });
      provisioner.syncUserAccessByBalance(result.userId, Math.round(result.balance.available * 100));
      return c.json({ success: true });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.route('/account', authed);

  return app;
}

function accountToken(auth: string | undefined, explicit: string | undefined): string | null {
  if (explicit?.trim()) return explicit.trim();
  const match = /^Bearer\s+(.+)$/i.exec(auth ?? '');
  return match?.[1]?.trim() ?? null;
}

async function readJsonBody(c: any, maxBytes = MAX_JSON_BODY_BYTES): Promise<unknown> {
  const raw = await readRawBody(c, maxBytes);
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new AccountError('INVALID_JSON', 'Request body must be valid JSON', 400);
  }
}

async function readRawBody(c: any, maxBytes: number): Promise<string> {
  const contentLength = Number(c.req.header('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new AccountError('BODY_TOO_LARGE', `Request body must be at most ${maxBytes} bytes`, 413);
  }
  const raw = await c.req.text();
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
    throw new AccountError('BODY_TOO_LARGE', `Request body must be at most ${maxBytes} bytes`, 413);
  }
  return raw;
}

function rateLimit(c: any, scope: string, limit: number, windowMs: number) {
  const identity = clientIdentity(c);
  const key = `${scope}:${identity}`;
  const now = Date.now();
  const current = rateBuckets.get(key);

  if (!current || current.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }

  current.count += 1;
  if (current.count > limit) {
    return c.json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again later.' } }, 429);
  }
  return null;
}

function clientIdentity(c: any): string {
  const forwarded = c.req.header('cf-connecting-ip')
    ?? c.req.header('x-real-ip')
    ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded?.trim() || 'local';
}

function readLimits(body: unknown): Partial<KeyLimits> {
  const input = body as Partial<KeyLimits> | null;
  if (!input || typeof input !== 'object') return {};
  return {
    maxRequestsPerMinute: input.maxRequestsPerMinute,
    maxRequestsPerDay: input.maxRequestsPerDay,
    allowedModels: input.allowedModels,
    allowedConnections: input.allowedConnections,
  };
}

function readSkillAction(input: unknown): SkillEventAction {
  return input === 'download' || input === 'like' ? input : 'activate';
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

function emptySkillAnalytics() {
  return {
    totalInvocations: 0,
    explicitActivations: 0,
    inferredInvocations: 0,
    activeUsers: 0,
    topSkills: [],
    topUsers: [],
    userSkillMatrix: [],
    actionBreakdown: [],
    sourceBreakdown: [],
    daily: [],
    recent: [],
  };
}

function emptyExpenseAnalytics() {
  return {
    totalCost: 0,
    totalRequests: 0,
    activeUsers: 0,
    topUsers: [],
    daily: [],
  };
}

// Hono's JSON status typing is intentionally narrow; centralizing keeps route code readable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function errorResponse(c: any, error: unknown) {
  if (error instanceof AccountError || error instanceof ProvisioningError || error instanceof DvnetError) {
    return c.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  console.error('[account-routes] unexpected error', error);
  return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Internal account service error' } }, 500);
}
