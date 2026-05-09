import { describe, expect, test } from 'bun:test';
import { createTestApp } from './fixtures/test-app.ts';
import { createTestDb } from './fixtures/test-db.ts';
import { createApp } from '../index.ts';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { app } = createTestApp();
let requestSeq = 1;

type Requester = (path: string, init?: RequestInit) => Response | Promise<Response>;
type SentMagicEmail = { body: { html?: string; text?: string; to?: string[] }; headers: HeadersInit | undefined };

function req(path: string, init?: RequestInit) {
  return app.request(path, init);
}

async function register(email = 'new-user@example.com', requester: Requester = req) {
  const res = await requester('/api/account/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `203.0.113.${requestSeq++}` },
    body: JSON.stringify({ email, displayName: 'New User' }),
  });
  const body = await res.json();
  return { res, body };
}

describe('account registration and managed keys', () => {
  test('registers an account and returns a one-time managed API key', async () => {
    const { res, body } = await register('register-one@example.com');
    expect(res.status).toBe(201);
    expect(body.data.user.email).toBe('register-one@example.com');
    expect(body.data.sessionToken).toStartWith('acct_');
    expect(body.data.defaultKey.rawKey).toStartWith('zed_');
    expect(body.data.defaultKey.keyPrefix).toBe(body.data.defaultKey.rawKey.slice(0, 18));
  });

  test('does not authenticate pending production registrations', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousAutoVerify = process.env.ACCOUNT_AUTO_VERIFY;
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.ACCOUNT_AUTO_VERIFY;
      const { res, body } = await register('pending-production@example.com');
      expect(res.status).toBe(201);
      expect(body.data.user.status).toBe('pending');
      expect(body.data.sessionToken).toBeNull();
      expect(body.data.defaultKey).toBeNull();
      expect(body.data.verificationRequired).toBe(true);
      expect(body.data.magicLinkSent).toBe(false);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousAutoVerify === undefined) delete process.env.ACCOUNT_AUTO_VERIFY;
      else process.env.ACCOUNT_AUTO_VERIFY = previousAutoVerify;
    }
  });

  test('sends and consumes production magic-link login without direct email sessions', async () => {
    const sentEmails: SentMagicEmail[] = [];
    const { app: magicApp } = createMagicApp(sentEmails);
    const magicReq: Requester = (path, init) => magicApp.request(path, init);

    const { body } = await register('magic-login@example.com', magicReq);
    const previousNodeEnv = process.env.NODE_ENV;
    const previousAllowEmail = process.env.ACCOUNT_ALLOW_EMAIL_LOGIN;
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.ACCOUNT_ALLOW_EMAIL_LOGIN;
      const login = await magicReq('/api/account/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.10' },
        body: JSON.stringify({ email: body.data.user.email }),
      });
      const loginBody = await login.json();
      expect(login.status).toBe(200);
      expect(loginBody.data.sessionToken).toBeNull();
      expect(loginBody.data.user).toBeNull();
      expect(loginBody.data.magicLinkSent).toBe(true);
      expect(sentEmails).toHaveLength(1);

      const token = extractMagicToken(sentEmails[0]!);
      const verified = await magicReq('/api/account/magic/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.11' },
        body: JSON.stringify({ token }),
      });
      const verifiedBody = await verified.json();
      expect(verified.status).toBe(200);
      expect(verifiedBody.data.sessionToken).toStartWith('acct_');
      expect(verifiedBody.data.user.status).toBe('active');
      expect(verifiedBody.data.defaultKey).toBeNull();

      const me = await magicReq('/api/account/me', {
        headers: { 'X-Account-Session': verifiedBody.data.sessionToken },
      });
      expect(me.status).toBe(200);

      const replay = await magicReq('/api/account/magic/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.12' },
        body: JSON.stringify({ token }),
      });
      expect(replay.status).toBe(401);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousAllowEmail === undefined) delete process.env.ACCOUNT_ALLOW_EMAIL_LOGIN;
      else process.env.ACCOUNT_ALLOW_EMAIL_LOGIN = previousAllowEmail;
    }
  });

  test('verifies production registrations by magic link and issues the first key once', async () => {
    const sentEmails: SentMagicEmail[] = [];
    const previousNodeEnv = process.env.NODE_ENV;
    const previousAutoVerify = process.env.ACCOUNT_AUTO_VERIFY;
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.ACCOUNT_AUTO_VERIFY;
      const { app: magicApp } = createMagicApp(sentEmails);
      const magicReq: Requester = (path, init) => magicApp.request(path, init);

      const registered = await magicReq('/api/account/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.20' },
        body: JSON.stringify({ email: 'magic-register@example.com', displayName: 'Magic Register' }),
      });
      const registeredBody = await registered.json();
      expect(registered.status).toBe(201);
      expect(registeredBody.data.user.status).toBe('pending');
      expect(registeredBody.data.sessionToken).toBeNull();
      expect(registeredBody.data.defaultKey).toBeNull();
      expect(registeredBody.data.magicLinkSent).toBe(true);
      expect(sentEmails).toHaveLength(1);

      const token = extractMagicToken(sentEmails[0]!);
      const verified = await magicReq('/api/account/magic/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.21' },
        body: JSON.stringify({ token }),
      });
      const verifiedBody = await verified.json();
      expect(verified.status).toBe(200);
      expect(verifiedBody.data.activated).toBe(true);
      expect(verifiedBody.data.user.status).toBe('active');
      expect(verifiedBody.data.sessionToken).toStartWith('acct_');
      expect(verifiedBody.data.defaultKey.rawKey).toStartWith('zed_');
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousAutoVerify === undefined) delete process.env.ACCOUNT_AUTO_VERIFY;
      else process.env.ACCOUNT_AUTO_VERIFY = previousAutoVerify;
    }
  });

  test('requires a configured provider before production email login is enabled', async () => {
    const { app: noProviderApp } = createTestApp();
    const noProviderReq: Requester = (path, init) => noProviderApp.request(path, init);
    await register('no-provider@example.com', noProviderReq);
    const previousNodeEnv = process.env.NODE_ENV;
    const previousAllowEmail = process.env.ACCOUNT_ALLOW_EMAIL_LOGIN;
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.ACCOUNT_ALLOW_EMAIL_LOGIN;
      const login = await noProviderReq('/api/account/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.30' },
        body: JSON.stringify({ email: 'no-provider@example.com' }),
      });
      const loginBody = await login.json();
      expect(login.status).toBe(503);
      expect(loginBody.error.code).toBe('MAGIC_LINK_NOT_CONFIGURED');
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousAllowEmail === undefined) delete process.env.ACCOUNT_ALLOW_EMAIL_LOGIN;
      else process.env.ACCOUNT_ALLOW_EMAIL_LOGIN = previousAllowEmail;
    }
  });

  test('lists managed keys without returning raw key material', async () => {
    const { body } = await register('keys-list@example.com');
    const res = await req('/api/account/keys', {
      headers: { 'X-Account-Session': body.data.sessionToken },
    });
    expect(res.status).toBe(200);
    const listed = await res.json();
    expect(listed.data).toHaveLength(1);
    expect(listed.data[0].keyPrefix).toBeString();
    expect(listed.data[0].rawKey).toBeUndefined();
  });

  test('validates managed keys through the existing auth endpoint', async () => {
    const { body } = await register('managed-auth@example.com');
    const res = await req('/api/auth/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: body.data.defaultKey.rawKey }),
    });
    expect(res.status).toBe(200);
    const validated = await res.json();
    expect(validated.valid).toBe(true);
    expect(validated.keyId).toBe(body.data.defaultKey.gatewayKeyId);
  });
});

function createMagicApp(sentEmails: SentMagicEmail[]) {
  return createTestApp({
    magicLinkEnv: {
      NODE_ENV: 'production',
      MAGIC_LINK_PROVIDER: 'resend',
      MAGIC_LINK_BASE_URL: 'https://stats.api.zed.md',
      MAGIC_LINK_FROM: 'API ZED <login@api.zed.md>',
      RESEND_API_KEY: 're_test',
    },
    magicLinkFetch: async (_input, init) => {
      sentEmails.push({
        body: JSON.parse(String(init?.body ?? '{}')) as SentMagicEmail['body'],
        headers: init?.headers,
      });
      return new Response(JSON.stringify({ id: `email_${sentEmails.length}` }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
}

function extractMagicToken(email: SentMagicEmail): string {
  const html = String(email.body.html ?? '');
  const match = /https:\/\/stats\.api\.zed\.md\/magic#token=([^"'<\s]+)/.exec(html);
  if (!match?.[1]) throw new Error(`Magic token not found in ${html}`);
  return decodeURIComponent(match[1]);
}

describe('account billing and DV.net webhook', () => {
  test('creates an unconfigured DV.net top-up intent safely', async () => {
    const { body } = await register('topup@example.com');
    const res = await req('/api/account/billing/topup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Account-Session': body.data.sessionToken },
      body: JSON.stringify({ amount: 25 }),
    });
    expect(res.status).toBe(201);
    const topup = await res.json();
    expect(topup.data.intent.amount).toBe(25);
    expect(topup.data.intent.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(topup.data.checkout.configured).toBe(false);
  });

  test('credits wallet from idempotent DV.net PaymentReceived webhook', async () => {
    const { app: signedApp } = createTestApp({ dvnetEnv: { DVNET_WEBHOOK_SECRET: 'test-secret' } });
    const signedReq: Requester = (path, init) => signedApp.request(path, init);
    const { body } = await register('dvnet-webhook@example.com', signedReq);
    const topupRes = await signedReq('/api/account/billing/topup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Account-Session': body.data.sessionToken },
      body: JSON.stringify({ amount: 12.5 }),
    });
    const topup = await topupRes.json();
    const paymentIntentId = topup.data.intent.id;
    const payload = JSON.stringify({
      amount: '12.50',
      status: 'completed',
      type: 'PaymentReceived',
      transactions: {
        tx_hash: 'tx-test-1',
        bc_uniq_key: '0',
        tx_id: 'provider-payment-1',
      },
      wallet: {
        store_external_id: paymentIntentId,
      },
    });
    const signature = createHash('sha256').update(payload + 'test-secret').digest('hex');
    const invalid = await signedReq('/api/billing/dvnet/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', X_SIGN: 'bad-signature' },
      body: payload,
    });
    const first = await signedReq('/api/billing/dvnet/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', X_SIGN: signature },
      body: payload,
    });
    const second = await signedReq('/api/billing/dvnet/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', X_SIGN: signature },
      body: payload,
    });
    expect(invalid.status).toBe(401);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const balance = await signedReq('/api/account/billing/balance', {
      headers: { 'X-Account-Session': body.data.sessionToken },
    });
    const balanceBody = await balance.json();
    expect(balanceBody.data.available).toBe(12.5);
  });

  test('reconciles managed key usage into wallet debits without double charging', async () => {
    const { app: signedApp, db } = createTestApp({ dvnetEnv: { DVNET_WEBHOOK_SECRET: 'test-secret' } });
    const signedReq: Requester = (path, init) => signedApp.request(path, init);
    const { body } = await register('usage-billing@example.com', signedReq);
    const topupRes = await signedReq('/api/account/billing/topup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Account-Session': body.data.sessionToken },
      body: JSON.stringify({ amount: 10 }),
    });
    const topup = await topupRes.json();
    const payload = JSON.stringify({
      amount: '10.00',
      type: 'PaymentReceived',
      transactions: { tx_hash: 'tx-usage-billing', bc_uniq_key: '0', tx_id: 'provider-usage-billing' },
      wallet: { store_external_id: topup.data.intent.id },
    });
    const signature = createHash('sha256').update(payload + 'test-secret').digest('hex');
    await signedReq('/api/billing/dvnet/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', X_SIGN: signature },
      body: payload,
    });

    db.prepare(`
      INSERT INTO usage_history (provider, model, api_key_id, api_key_name, tokens_input, tokens_output, success, status, timestamp)
      VALUES ('codex', 'gpt-5.4', ?, ?, 1000000, 100000, 1, 'ok', '2026-05-08T10:00:00Z')
    `).run(body.data.defaultKey.gatewayKeyId, body.data.defaultKey.gatewayName);

    const first = await signedReq('/api/account/billing/balance', {
      headers: { 'X-Account-Session': body.data.sessionToken },
    });
    const firstBody = await first.json();
    expect(firstBody.data.available).toBe(6.5);
    expect(firstBody.data.spent).toBe(3.5);
    expect(firstBody.data.usageSync.debited).toBe(1);

    const second = await signedReq('/api/account/billing/balance', {
      headers: { 'X-Account-Session': body.data.sessionToken },
    });
    const secondBody = await second.json();
    expect(secondBody.data.available).toBe(6.5);
    expect(secondBody.data.usageSync.debited).toBe(0);
  });

  test('balance enforcement blocks and restores managed key validation', async () => {
    const { app: enforcedApp } = createTestApp({
      enforceAccountBalance: true,
      dvnetEnv: { DVNET_WEBHOOK_SECRET: 'test-secret' },
    });
    const enforcedReq: Requester = (path, init) => enforcedApp.request(path, init);
    const { body } = await register('balance-enforced@example.com', enforcedReq);
    expect(body.data.defaultKey.status).toBe('suspended');

    const blocked = await enforcedReq('/api/auth/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: body.data.defaultKey.rawKey }),
    });
    expect(blocked.status).toBe(401);

    const topupRes = await enforcedReq('/api/account/billing/topup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Account-Session': body.data.sessionToken },
      body: JSON.stringify({ amount: 5 }),
    });
    const topup = await topupRes.json();
    const payload = JSON.stringify({
      amount: '5.00',
      type: 'PaymentReceived',
      transactions: { tx_hash: 'tx-enforced', bc_uniq_key: '0', tx_id: 'provider-enforced' },
      wallet: { store_external_id: topup.data.intent.id },
    });
    const signature = createHash('sha256').update(payload + 'test-secret').digest('hex');
    await enforcedReq('/api/billing/dvnet/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', X_SIGN: signature },
      body: payload,
    });

    const validated = await enforcedReq('/api/auth/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: body.data.defaultKey.rawKey }),
    });
    expect(validated.status).toBe(200);
  });

  test('auth validation reconciles usage before accepting a managed key', async () => {
    const { app: enforcedApp, db } = createTestApp({
      enforceAccountBalance: true,
      dvnetEnv: { DVNET_WEBHOOK_SECRET: 'test-secret' },
    });
    const enforcedReq: Requester = (path, init) => enforcedApp.request(path, init);
    const { body } = await register('auth-reconcile@example.com', enforcedReq);

    const topupRes = await enforcedReq('/api/account/billing/topup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Account-Session': body.data.sessionToken },
      body: JSON.stringify({ amount: 5 }),
    });
    const topup = await topupRes.json();
    const payload = JSON.stringify({
      amount: '5.00',
      type: 'PaymentReceived',
      transactions: { tx_hash: 'tx-auth-reconcile', bc_uniq_key: '0', tx_id: 'provider-auth-reconcile' },
      wallet: { store_external_id: topup.data.intent.id },
    });
    const signature = createHash('sha256').update(payload + 'test-secret').digest('hex');
    await enforcedReq('/api/billing/dvnet/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', X_SIGN: signature },
      body: payload,
    });

    const initiallyValid = await enforcedReq('/api/auth/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: body.data.defaultKey.rawKey }),
    });
    expect(initiallyValid.status).toBe(200);

    db.prepare(`
      INSERT INTO usage_history (provider, model, api_key_id, api_key_name, tokens_input, tokens_output, success, status, timestamp)
      VALUES ('codex', 'gpt-5.4', ?, ?, 3000000, 300000, 1, 'ok', '2026-05-08T11:00:00Z')
    `).run(body.data.defaultKey.gatewayKeyId, body.data.defaultKey.gatewayName);

    const overdrawn = await enforcedReq('/api/auth/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: body.data.defaultKey.rawKey }),
    });
    expect(overdrawn.status).toBe(401);

    const balance = await enforcedReq('/api/account/billing/balance', {
      headers: { 'X-Account-Session': body.data.sessionToken },
    });
    const balanceBody = await balance.json();
    expect(balanceBody.data.available).toBeLessThanOrEqual(0);
    expect(balanceBody.data.usageSync.debited).toBe(0);

    const keys = await enforcedReq('/api/account/keys', {
      headers: { 'X-Account-Session': body.data.sessionToken },
    });
    const keysBody = await keys.json();
    expect(keysBody.data[0].status).toBe('suspended');
  });

  test('managed keys synced into the gateway DB still enforce account balance', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'zapi-stats-gateway-'));
    try {
      const gatewayDbPath = join(tempDir, 'gateway.sqlite');
      const gatewayDb = createTestDb(gatewayDbPath);
      const gatewayApp = createApp(gatewayDb, {
        gatewayWriteDbPath: gatewayDbPath,
        enforceAccountBalance: true,
        dvnetEnv: { DVNET_WEBHOOK_SECRET: 'test-secret' },
      });
      const gatewayReq: Requester = (path, init) => gatewayApp.request(path, init);
      const { body } = await register('gateway-bypass@example.com', gatewayReq);

      const initiallySynced = gatewayDb.prepare('SELECT is_active FROM api_keys WHERE key = ?').get(body.data.defaultKey.rawKey) as { is_active: number } | null;
      expect(initiallySynced?.is_active).toBe(0);

      const limits = await gatewayReq(`/api/account/keys/${body.data.defaultKey.id}/limits`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Account-Session': body.data.sessionToken },
        body: JSON.stringify({ maxRequestsPerMinute: 33, maxRequestsPerDay: 777 }),
      });
      expect(limits.status).toBe(200);

      const topupRes = await gatewayReq('/api/account/billing/topup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Account-Session': body.data.sessionToken },
        body: JSON.stringify({ amount: 5 }),
      });
      const topup = await topupRes.json();
      const payload = JSON.stringify({
        amount: '5.00',
        type: 'PaymentReceived',
        transactions: { tx_hash: 'tx-gateway-bypass', bc_uniq_key: '0', tx_id: 'provider-gateway-bypass' },
        wallet: { store_external_id: topup.data.intent.id },
      });
      const signature = createHash('sha256').update(payload + 'test-secret').digest('hex');
      await gatewayReq('/api/billing/dvnet/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', X_SIGN: signature },
        body: payload,
      });

      const activeInGateway = gatewayDb.prepare('SELECT is_active, max_requests_per_minute, max_requests_per_day FROM api_keys WHERE key = ?').get(body.data.defaultKey.rawKey) as { is_active: number; max_requests_per_minute: number; max_requests_per_day: number } | null;
      expect(activeInGateway?.is_active).toBe(1);
      expect(activeInGateway?.max_requests_per_minute).toBe(33);
      expect(activeInGateway?.max_requests_per_day).toBe(777);

      gatewayDb.prepare(`
        INSERT INTO usage_history (provider, model, api_key_id, api_key_name, tokens_input, tokens_output, success, status, timestamp)
        VALUES ('codex', 'gpt-5.4', ?, ?, 3000000, 300000, 1, 'ok', '2026-05-08T12:00:00Z')
      `).run(body.data.defaultKey.gatewayKeyId, body.data.defaultKey.gatewayName);

      const overdrawn = await gatewayReq('/api/auth/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: body.data.defaultKey.rawKey }),
      });
      expect(overdrawn.status).toBe(401);

      const suspendedInGateway = gatewayDb.prepare('SELECT is_active FROM api_keys WHERE key = ?').get(body.data.defaultKey.rawKey) as { is_active: number } | null;
      expect(suspendedInGateway?.is_active).toBe(0);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('tracks skill activations and per-user expense analytics', async () => {
    const { app: analyticsApp, db } = createTestApp();
    const analyticsReq: Requester = (path, init) => analyticsApp.request(path, init);
    const registerRes = await analyticsReq('/api/account/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.42' },
      body: JSON.stringify({ email: 'analytics-user@example.com', displayName: 'New User' }),
    });
    const body = await registerRes.json();
    expect(registerRes.status).toBe(201);

    const activated = await analyticsReq('/api/account/skills/autopilot/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Account-Session': body.data.sessionToken },
      body: JSON.stringify({ action: 'download', source: 'test' }),
    });
    expect(activated.status).toBe(201);
    const activatedBody = await activated.json();
    expect(activatedBody.data.skillSlug).toBe('autopilot');

    db.prepare(`
      INSERT INTO call_logs (id, timestamp, path, status, model, provider, api_key_name, duration, tokens_in, tokens_out)
      VALUES ('log-skill-1', '2026-05-08T12:30:00Z', '/skills/autopilot/run', 200, 'gpt-5.4', 'codex', ?, 1000, 1000, 100)
    `).run(body.data.defaultKey.gatewayName);
    db.prepare(`
      INSERT INTO usage_history (provider, model, api_key_id, api_key_name, tokens_input, tokens_output, success, status, timestamp)
      VALUES ('codex', 'gpt-5.4', ?, ?, 1000000, 100000, 1, 'ok', '2026-05-08T12:30:00Z')
    `).run(body.data.defaultKey.gatewayKeyId, body.data.defaultKey.gatewayName);

    const globalSkills = await analyticsReq('/api/stats/skills/analytics?days=30');
    expect(globalSkills.status).toBe(200);
    const globalSkillBody = await globalSkills.json();
    const autopilot = globalSkillBody.data.topSkills.find((item: { skillSlug: string }) => item.skillSlug === 'autopilot');
    expect(globalSkillBody.data.explicitActivations).toBe(1);
    expect(globalSkillBody.data.inferredInvocations).toBeGreaterThanOrEqual(1);
    expect(autopilot?.count).toBeGreaterThanOrEqual(2);
    expect(globalSkillBody.data.actionBreakdown[0]).toEqual({ label: 'download', count: 1 });
    expect(globalSkillBody.data.sourceBreakdown[0]).toEqual({ label: 'test', count: 1 });
    const userSkillRow = globalSkillBody.data.userSkillMatrix.find((item: { displayName: string }) => item.displayName === 'New User');
    expect(userSkillRow?.total).toBeGreaterThanOrEqual(2);
    expect(userSkillRow?.topSkills[0].skillSlug).toBe('autopilot');

    const personalSkills = await analyticsReq('/api/account/skills/analytics?days=30', {
      headers: { 'X-Account-Session': body.data.sessionToken },
    });
    const personalSkillBody = await personalSkills.json();
    expect(personalSkillBody.data.recent[0].skillSlug).toBe('autopilot');
    expect(personalSkillBody.data.topSkills.find((item: { skillSlug: string }) => item.skillSlug === 'autopilot')?.count).toBeGreaterThanOrEqual(2);
    expect(personalSkillBody.data.userSkillMatrix[0].displayName).toBe('New User');

    const globalExpenses = await analyticsReq('/api/stats/expenses/users?days=30');
    const globalExpenseBody = await globalExpenses.json();
    expect(globalExpenseBody.data.totalRequests).toBeGreaterThanOrEqual(1);
    expect(globalExpenseBody.data.topUsers[0].displayName).toBe('New User');
    expect(globalExpenseBody.data.topUsers[0].cost).toBe(3.5);

    const personalExpenses = await analyticsReq('/api/account/billing/expenses?days=30', {
      headers: { 'X-Account-Session': body.data.sessionToken },
    });
    const personalExpenseBody = await personalExpenses.json();
    expect(personalExpenseBody.data.totalCost).toBe(3.5);
    expect(personalExpenseBody.data.daily[0].users[0].displayName).toBe('New User');
  });
});

describe('account security headers', () => {
  test('uses explicit production CORS allowlist', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousOrigins = process.env.CORS_ALLOWED_ORIGINS;
    try {
      process.env.NODE_ENV = 'production';
      process.env.CORS_ALLOWED_ORIGINS = 'https://stats.api.zed.md';
      const { app: corsApp } = createTestApp();

      const denied = await corsApp.request('/api/health', {
        headers: { Origin: 'https://evil.example' },
      });
      expect(denied.headers.get('access-control-allow-origin')).toBeNull();

      const allowed = await corsApp.request('/api/health', {
        headers: { Origin: 'https://stats.api.zed.md' },
      });
      expect(allowed.headers.get('access-control-allow-origin')).toBe('https://stats.api.zed.md');
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousOrigins === undefined) delete process.env.CORS_ALLOWED_ORIGINS;
      else process.env.CORS_ALLOWED_ORIGINS = previousOrigins;
    }
  });
});
