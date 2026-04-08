const BASE = '/api';

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error((err as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// Public endpoints
export async function getLeaderboard() {
  return fetchJson<{ data: LeaderboardEntry[] }>('/leaderboard');
}

export async function getOverview() {
  return fetchJson<{ data: OverviewStats }>('/stats/overview');
}

export async function getModelStats() {
  return fetchJson<{ data: ModelStat[] }>('/stats/models');
}

export async function getProviderStats() {
  return fetchJson<{ data: ProviderStat[] }>('/stats/providers');
}

export async function getTimeline(period: string = '24h') {
  return fetchJson<{ data: TimelinePoint[] }>(`/stats/timeline?period=${period}`);
}

export async function getUserPublicStats(name: string) {
  return fetchJson<{ data: UserPublicStats }>(`/stats/user/${encodeURIComponent(name)}`);
}

// Auth
export async function validateApiKey(key: string) {
  return fetchJson<{ valid: boolean; keyName: string; keyId: string; noLog: boolean }>('/auth/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  });
}

// Private endpoints
function authHeaders(apiKey: string): Record<string, string> {
  return { 'X-API-Key': apiKey };
}

export async function getUserStats(apiKey: string) {
  return fetchJson<{ data: UserPublicStats }>('/user/stats', { headers: authHeaders(apiKey) });
}

export async function getUserModels(apiKey: string) {
  return fetchJson<{ data: ModelStat[] }>('/user/models', { headers: authHeaders(apiKey) });
}

// Types
export interface LeaderboardEntry {
  name: string;
  displayName: string;
  requests: number;
  tokensIn: number;
  tokensOut: number;
  tokensCacheRead: number;
  tokensCacheCreation: number;
  tokensReasoning: number;
  totalTokens: number;
  tokensPerRequest: number;
  cost: number;
  costPerRequest: number;
  inputCost: number;
  outputCost: number;
  avgLatency: number;
  avgTtft: number;
  successRate: number;
  errorCount: number;
  errorRate: number;
  uniqueModels: number;
  uniqueProviders: number;
  topModel: string;
  topProvider: string;
  firstSeen: string;
  lastSeen: string;
}

export interface OverviewStats {
  totalRequests: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCost: number;
  activeKeys: number;
  uniqueModels: number;
  uniqueProviders: number;
}

export interface ModelStat {
  model: string;
  count: number;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  avgLatency: number;
}

export interface ProviderStat {
  provider: string;
  count: number;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  successRate: number;
}

export interface TimelinePoint {
  timestamp: string;
  requests: number;
  tokensIn: number;
  tokensOut: number;
  cost: number;
}

export interface UserPublicStats {
  name: string;
  displayName: string;
  requests: number;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  successRate: number;
  avgLatency: number;
  models: ModelStat[];
  providers: ProviderStat[];
  firstSeen: string;
  lastSeen: string;
}
