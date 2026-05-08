import { test, expect, describe } from 'bun:test';
import { createTestApp } from './fixtures/test-app.ts';

const { app } = createTestApp();

function req(path: string, init?: RequestInit) {
  return app.request(path, init);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function json(res: Response): Promise<any> {
  return res.json();
}

describe('GET /api/health', () => {
  test('returns 200 with status ok', async () => {
    const res = await req('/api/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });

  test('returns degraded deployment status as data', async () => {
    const previousHealthUrl = process.env.API_ZED_HEALTH_URL;
    try {
      process.env.API_ZED_HEALTH_URL = 'http://127.0.0.1:9/unreachable';
      const { app: degradedApp } = createTestApp();
      const res = await degradedApp.request('/api/deployment/status');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.status).toBe('unreachable');
      expect(body.data.error).toBeString();
    } finally {
      if (previousHealthUrl === undefined) delete process.env.API_ZED_HEALTH_URL;
      else process.env.API_ZED_HEALTH_URL = previousHealthUrl;
    }
  });
});

describe('GET /api/leaderboard', () => {
  test('returns leaderboard data', async () => {
    const res = await req('/api/leaderboard');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeArray();
    expect(body.data.length).toBe(3);
    expect(body.data[0].name).toBe('alice');
  });

  test('includes extended metrics and displayName', async () => {
    const res = await req('/api/leaderboard');
    const body = await res.json();
    const alice = body.data[0];
    expect(alice.cost).toBeGreaterThan(0);
    expect(alice.displayName).toBe('alice');
    expect(alice.topModel).toBe('claude-opus-4-6');
    expect(alice.successRate).toBeCloseTo(0.75, 2);
    expect(alice.errorCount).toBe(1);
    expect(alice.totalTokens).toBe(109000);
    expect(alice.inputCost).toBeGreaterThan(0);
    expect(alice.outputCost).toBeGreaterThan(0);
    expect(alice.uniqueModels).toBe(2);
    expect(alice.uniqueProviders).toBe(2);
  });
});

describe('GET /api/stats/*', () => {
  test('overview returns aggregates', async () => {
    const res = await req('/api/stats/overview');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.totalRequests).toBe(7);
    expect(body.data.totalCost).toBeGreaterThan(0);
  });

  test('models returns breakdown', async () => {
    const res = await req('/api/stats/models');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeArray();
    expect(body.data[0].model).toBe('claude-opus-4-6');
  });

  test('providers returns breakdown', async () => {
    const res = await req('/api/stats/providers');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeArray();
    expect(body.data.length).toBe(4);
  });

  test('timeline returns data points', async () => {
    const res = await req('/api/stats/timeline?period=30d');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeArray();
  });

  test('user/:name returns public stats', async () => {
    const res = await req('/api/stats/user/alice');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.name).toBe('alice');
    expect(body.data.requests).toBe(4);
    expect(body.data.models).toBeArray();
  });

  test('user/:name returns 404 for unknown', async () => {
    const res = await req('/api/stats/user/nobody');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/auth/validate', () => {
  test('validates correct key', async () => {
    const res = await req('/api/auth/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'agisota-aaa111-pzdrk-bbb222' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.keyName).toBe('alice');
  });

  test('rejects invalid key', async () => {
    const res = await req('/api/auth/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'invalid-key' }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.valid).toBe(false);
  });

  test('rejects missing key', async () => {
    const res = await req('/api/auth/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/user/* (authenticated)', () => {
  const authHeaders = { 'X-API-Key': 'agisota-aaa111-pzdrk-bbb222' };

  test('returns user stats with valid key', async () => {
    const res = await req('/api/user/stats', { headers: authHeaders });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.name).toBe('alice');
  });

  test('returns user models', async () => {
    const res = await req('/api/user/models', { headers: authHeaders });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeArray();
  });

  test('rejects without key', async () => {
    const res = await req('/api/user/stats');
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('MISSING_KEY');
  });

  test('rejects with invalid key', async () => {
    const res = await req('/api/user/stats', {
      headers: { 'X-API-Key': 'bad-key' },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_KEY');
  });

  test('rejects inactive key', async () => {
    const res = await req('/api/user/stats', {
      headers: { 'X-API-Key': 'agisota-ggg777-pzdrk-hhh888' },
    });
    expect(res.status).toBe(401);
  });
});
