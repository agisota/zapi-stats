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

export async function getGlobalSkillAnalytics(period: string = '30d') {
  return fetchJson<{ data: SkillAnalytics }>(`/stats/skills/analytics?period=${period}`);
}

export async function getGlobalUserExpenses(period: string = '30d') {
  return fetchJson<{ data: ExpenseAnalytics }>(`/stats/expenses/users?period=${period}`);
}

export async function getDeploymentStatus() {
  return fetchJson<{ data: DeploymentStatus }>('/deployment/status');
}

export async function getModelAvailability() {
  return fetchJson<{ data: ModelAvailabilityResponse }>('/models/availability');
}

export async function getSkills(params: { q?: string; source?: string; category?: string } = {}) {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.source) query.set('source', params.source);
  if (params.category) query.set('category', params.category);
  return fetchJson<{ data: SkillsResponse }>(`/skills?${query.toString()}`);
}

export async function trackSkillAction(id: string, action: 'like' | 'download') {
  return fetchJson<{ data: Pick<SkillItem, 'id' | 'likes' | 'downloads'> }>(`/skills/${encodeURIComponent(id)}/${action}`, {
    method: 'POST',
  });
}

export async function submitSupportRequest(payload: SupportRequestPayload) {
  return fetchJson<{ data: { id: string; status: string; createdAt: string } }>('/support/requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function transcribeSupportAudio(audio: Blob) {
  const form = new FormData();
  const extension = audio.type.includes('ogg') ? 'ogg' : audio.type.includes('mp4') ? 'mp4' : 'webm';
  form.set('audio', new File([audio], `support-voice.${extension}`, { type: audio.type || 'audio/webm' }));
  return fetchJson<{ data: { text: string; model: string } }>('/support/transcribe', {
    method: 'POST',
    body: form,
  });
}

export async function getUserPublicStats(name: string) {
  return fetchJson<{ data: UserPublicStats }>(`/stats/user/${encodeURIComponent(name)}`);
}

export async function getUserProfile(name: string) {
  return fetchJson<{ data: UserProfile }>(`/stats/user/${encodeURIComponent(name)}/profile`);
}

// Auth
export async function validateApiKey(key: string) {
  return fetchJson<{ valid: boolean; keyName: string; keyId: string; noLog: boolean }>('/auth/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  });
}

export async function registerAccount(payload: { email: string; displayName?: string }) {
  return fetchJson<{ data: AccountRegistrationResult }>('/account/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function loginAccount(email: string) {
  return fetchJson<{ data: AccountLoginResult }>('/account/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
}

function accountHeaders(sessionToken: string): Record<string, string> {
  return { 'X-Account-Session': sessionToken };
}

export async function getAccountMe(sessionToken: string) {
  return fetchJson<{ data: { user: AccountUser } }>('/account/me', { headers: accountHeaders(sessionToken) });
}

export async function getAccountBalance(sessionToken: string) {
  return fetchJson<{ data: AccountBalance }>('/account/billing/balance', { headers: accountHeaders(sessionToken) });
}

export async function getAccountLedger(sessionToken: string) {
  return fetchJson<{ data: AccountLedgerEntry[] }>('/account/billing/ledger', { headers: accountHeaders(sessionToken) });
}

export async function getAccountExpenses(sessionToken: string, period: string = '30d') {
  return fetchJson<{ data: ExpenseAnalytics }>(`/account/billing/expenses?period=${period}`, { headers: accountHeaders(sessionToken) });
}

export async function createTopup(sessionToken: string, amount: number) {
  return fetchJson<{ data: AccountTopupResult }>('/account/billing/topup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...accountHeaders(sessionToken) },
    body: JSON.stringify({ amount }),
  });
}

export async function getAccountKeys(sessionToken: string) {
  return fetchJson<{ data: ManagedApiKey[] }>('/account/keys', { headers: accountHeaders(sessionToken) });
}

export async function createAccountKey(sessionToken: string, payload: { displayName?: string; noLog?: boolean } = {}) {
  return fetchJson<{ data: ManagedApiKey & { rawKey: string } }>('/account/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...accountHeaders(sessionToken) },
    body: JSON.stringify(payload),
  });
}

export async function revokeAccountKey(sessionToken: string, keyId: string) {
  return fetchJson<{ data: ManagedApiKey }>(`/account/keys/${encodeURIComponent(keyId)}/revoke`, {
    method: 'POST',
    headers: accountHeaders(sessionToken),
  });
}

export async function rotateAccountKey(sessionToken: string, keyId: string) {
  return fetchJson<{ data: ManagedApiKey & { rawKey: string } }>(`/account/keys/${encodeURIComponent(keyId)}/rotate`, {
    method: 'POST',
    headers: accountHeaders(sessionToken),
  });
}

export async function updateAccountKeyLimits(sessionToken: string, keyId: string, limits: Partial<KeyLimits>) {
  return fetchJson<{ data: ManagedApiKey }>(`/account/keys/${encodeURIComponent(keyId)}/limits`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...accountHeaders(sessionToken) },
    body: JSON.stringify(limits),
  });
}

export async function getAccountSkillAnalytics(sessionToken: string, period: string = '30d') {
  return fetchJson<{ data: SkillAnalytics }>(`/account/skills/analytics?period=${period}`, { headers: accountHeaders(sessionToken) });
}

export async function recordAccountSkillActivation(sessionToken: string, skillId: string, action: SkillEventAction = 'activate') {
  return fetchJson<{ data: SkillEventRecord }>(`/account/skills/${encodeURIComponent(skillId)}/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...accountHeaders(sessionToken) },
    body: JSON.stringify({ action, source: 'skills_catalog' }),
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

export async function getUserLogs(apiKey: string, params: UserLogQuery = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  }
  return fetchJson<{ data: UserLogPage }>(`/user/logs?${query.toString()}`, { headers: authHeaders(apiKey) });
}

export async function getUserLogFacets(apiKey: string) {
  return fetchJson<{ data: UserLogFacets }>('/user/log-facets', { headers: authHeaders(apiKey) });
}

export async function getUserSessions(apiKey: string) {
  return fetchJson<{ data: UserSession[] }>('/user/sessions', { headers: authHeaders(apiKey) });
}

export async function getUserLogDetail(apiKey: string, id: string) {
  return fetchJson<{ data: UserLogDetail }>(`/user/logs/${encodeURIComponent(id)}`, { headers: authHeaders(apiKey) });
}

export async function getUserBalance(apiKey: string) {
  return fetchJson<{ data: UserBalance }>('/user/balance', { headers: authHeaders(apiKey) });
}

export async function getUserActivity(apiKey: string) {
  return fetchJson<{ data: UserActivityAnalytics }>('/user/activity', { headers: authHeaders(apiKey) });
}

export async function getUserSkillsMapping(apiKey: string) {
  return fetchJson<{ data: UserSkillsMapping }>('/user/skills-mapping', { headers: authHeaders(apiKey) });
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
  requestsPerDay: number;
  outputRatio: number;
  peakHour: number;
  providerDiversity: number;
  providerBreakdown: Array<{ provider: string; percent: number }>;
  activeDays: number;
  avgSessionMessages: number;
  longestSessionMessages: number;
  hourlyActivity: number[];
  dailyActivity: number[];
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
  provider: string;
  count: number;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  avgLatency: number;
  successRate: number;
  users: number;
  lastSeen: string;
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

export type SkillEventAction = 'activate' | 'download' | 'like';

export interface SkillEventRecord {
  id: string;
  userId: string;
  displayName: string;
  skillId: string;
  skillSlug: string;
  action: SkillEventAction;
  source: string;
  createdAt: string;
}

export interface SkillAnalyticsItem {
  skillId: string;
  skillSlug: string;
  count: number;
  explicit: number;
  inferred: number;
}

export interface SkillAnalyticsUser {
  userId: string | null;
  displayName: string;
  count: number;
}

export interface SkillAnalyticsUserSkills {
  userId: string | null;
  displayName: string;
  total: number;
  explicit: number;
  inferred: number;
  topSkills: SkillAnalyticsItem[];
}

export interface SkillAnalyticsBreakdownItem {
  label: string;
  count: number;
}

export interface SkillAnalyticsDay {
  date: string;
  total: number;
  skills: SkillAnalyticsItem[];
  users: SkillAnalyticsUser[];
}

export interface SkillAnalytics {
  totalInvocations: number;
  explicitActivations: number;
  inferredInvocations: number;
  activeUsers: number;
  topSkills: SkillAnalyticsItem[];
  topUsers: SkillAnalyticsUser[];
  userSkillMatrix: SkillAnalyticsUserSkills[];
  actionBreakdown: SkillAnalyticsBreakdownItem[];
  sourceBreakdown: SkillAnalyticsBreakdownItem[];
  daily: SkillAnalyticsDay[];
  recent: SkillEventRecord[];
}

export interface UserCostSlice {
  userId: string | null;
  displayName: string;
  apiKeyName: string;
  cost: number;
  requests: number;
  tokensIn: number;
  tokensOut: number;
}

export interface ExpenseDay {
  date: string;
  totalCost: number;
  totalRequests: number;
  users: UserCostSlice[];
}

export interface ExpenseAnalytics {
  totalCost: number;
  totalRequests: number;
  activeUsers: number;
  topUsers: UserCostSlice[];
  daily: ExpenseDay[];
}

export interface DeploymentStatus {
  status: string;
  version: string;
  activeConnections: number;
  providerSummary: {
    catalogCount?: number;
    configuredCount?: number;
    activeCount?: number;
    monitoredCount?: number;
  };
  circuitBreakers: {
    open?: number;
    halfOpen?: number;
    closed?: number;
    total?: number;
  };
  modelCount: number | null;
  nodeVersion: string | null;
  uptime: number | null;
  memoryRss: number | null;
  checkedAt: string;
  error?: string;
}

export interface AvailableModel {
  id: string;
  alias: string;
  root: string;
  parent: string | null;
  provider: string;
  ownedBy: string;
  contextLength: number | null;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  capabilities: Record<string, boolean>;
  inputModalities: string[];
  outputModalities: string[];
  created: number | null;
  isNew: boolean;
  usageCount: number;
  successRate: number | null;
  avgLatency: number | null;
  lastSeen: string | null;
}

export interface ModelAvailabilityResponse {
  total: number;
  available: AvailableModel[];
  newModels: AvailableModel[];
  unavailable: AvailableModel[];
  endpoints: CustomEndpoint[];
  checkedAt: string;
  error?: string;
}

export interface CustomEndpoint {
  alias: string;
  kind: string;
  title: string;
  description: string;
  status: string;
  baseUrl?: string;
  modelParam?: string;
  usageHint?: string;
}

export interface SkillItem {
  id: string;
  slug: string;
  title: string;
  descriptionRu: string;
  source: string;
  sourcePath: string;
  githubRepo: string | null;
  installCommand: string;
  tags: string[];
  category: string;
  likes: number;
  downloads: number;
  stars: number | null;
  updatedAt: string | null;
}

export interface SkillsResponse {
  total: number;
  returned: number;
  items: SkillItem[];
  sources: string[];
  categories: string[];
}

export interface SupportRequestPayload {
  message: string;
  contact: string;
  contactType: 'telegram' | 'email';
  voiceNote?: string;
}

export interface UserProfile {
  displayName: string;
  summary?: string;
  patterns: string[];
  recommendations: string[];
  highlights: string[];
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

export interface UserLogQuery {
  q?: string;
  provider?: string;
  model?: string;
  status?: 'success' | 'error' | '';
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  sort?: 'timestamp' | 'duration' | 'status' | 'model' | 'provider' | 'tokens';
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface UserLogEntry {
  id: string;
  timestamp: string;
  method: string | null;
  path: string | null;
  model: string | null;
  requestedModel: string | null;
  provider: string | null;
  status: number | null;
  success: boolean;
  duration: number;
  tokensIn: number;
  tokensOut: number;
  tokensCacheRead: number;
  tokensCacheCreation: number;
  tokensReasoning: number;
  requestType: string | null;
  requestSummary: string | null;
  error: string | null;
  detailState: string | null;
  artifactSizeBytes: number | null;
  hasRequestBody: boolean;
  hasResponseBody: boolean;
  hasPipelineDetails: boolean;
}

export interface UserLogPage {
  items: UserLogEntry[];
  logs: UserLogEntry[];
  total: number;
  limit: number;
  offset: number;
  nextCursor: string | null;
}

export interface UserLogFacets {
  models: Array<{ value: string; count: number }>;
  providers: Array<{ value: string; count: number }>;
  statuses: Array<{ value: string; count: number }>;
  dates: Array<{ value: string; count: number }>;
}

export interface UserSession {
  id: string;
  firstSeen: string;
  lastSeen: string;
  requests: number;
  successful: number;
  successRate: number;
  tokensIn: number;
  tokensOut: number;
  avgLatency: number;
  topModel: string | null;
  topProvider: string | null;
  lastSummary: string | null;
}

export interface TraceStep {
  id: string;
  kind: 'request' | 'auth' | 'routing' | 'model_call' | 'response' | 'billing';
  title: string;
  summary: string;
  timestamp: string;
  durationMs: number | null;
  status: 'success' | 'warning' | 'error' | 'info';
  meta: Array<{ label: string; value: string }>;
  detail: string;
}

export interface UserLogDetail extends UserLogEntry {
  account: string | null;
  connectionId: string | null;
  comboName: string | null;
  comboStepId: string | null;
  detail: unknown;
  trace: TraceStep[];
  artifact: {
    available: boolean;
    relpath: string | null;
    sizeBytes: number | null;
    preview: unknown;
  };
}

export interface BalanceLedgerEntry {
  id: string;
  timestamp: string;
  type: 'credit' | 'debit' | 'refill';
  label: string;
  amount: number;
  balanceAfter: number;
  detail: string;
}

export interface UserBalance {
  monthlyLimit: number;
  currency: 'USD';
  periodStart: string;
  nextRefillAt: string;
  currentSpend: number;
  remaining: number;
  usagePercent: number;
  keyCreatedAt: string;
  ledger: BalanceLedgerEntry[];
}

export interface AccountUser {
  id: string;
  email: string;
  displayName: string;
  status: 'pending' | 'active' | 'suspended';
  createdAt: string;
  verifiedAt: string | null;
}

export interface KeyLimits {
  maxRequestsPerMinute: number;
  maxRequestsPerDay: number;
  allowedModels: string[];
  allowedConnections: string[];
}

export interface ManagedApiKey {
  id: string;
  userId: string;
  gatewayKeyId: string;
  gatewayName: string;
  keyPrefix: string;
  displayName: string;
  status: 'active' | 'revoked' | 'suspended';
  syncStatus: 'shadow' | 'synced' | 'failed';
  noLog: boolean;
  limits: KeyLimits;
  createdAt: string;
  revokedAt: string | null;
}

export interface AccountRegistrationResult {
  user: AccountUser;
  sessionToken: string | null;
  defaultKey: (ManagedApiKey & { rawKey: string }) | null;
  verificationRequired: boolean;
}

export interface AccountLoginResult {
  user: AccountUser;
  sessionToken: string;
}

export interface AccountBalance {
  walletId: string;
  currency: 'USD';
  available: number;
  reserved: number;
  spent: number;
  updatedAt: string;
  usageSync: {
    scanned: number;
    debited: number;
    totalDebited: number;
    balance: number;
    suspendedKeys: number;
    activatedKeys: number;
  } | null;
}

export interface AccountLedgerEntry {
  id: string;
  type: 'credit' | 'debit' | 'refund' | 'adjustment';
  amount: number;
  balanceAfter: number;
  label: string;
  detail: string;
  externalRef: string | null;
  createdAt: string;
}

export interface PaymentIntent {
  id: string;
  userId: string;
  provider: string;
  providerPaymentId: string | null;
  status: 'pending' | 'completed' | 'failed' | 'expired';
  amount: number;
  currency: 'USD';
  checkoutUrl: string | null;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface AccountTopupResult {
  intent: PaymentIntent;
  checkout: {
    configured: boolean;
    checkoutUrl: string | null;
    providerPaymentId: string | null;
    raw: unknown;
  };
}

export interface ActivityDay {
  date: string;
  requests: number;
  sessions: number;
  tokens: number;
  cost: number;
  successRate: number;
  firstSeen: string | null;
  lastSeen: string | null;
  topModel: string | null;
  topProvider: string | null;
}

export interface UserRecommendation {
  id: string;
  severity: 'info' | 'attention' | 'critical';
  title: string;
  body: string;
  action: string;
}

export interface UserActivityAnalytics {
  days: ActivityDay[];
  recommendations: UserRecommendation[];
}

export interface SkillMappingItem {
  id: string;
  slug: string;
  category: string;
  source: string;
  status: 'used' | 'recommended' | 'unused';
  confidence: number;
  evidence: string;
  reason: string;
  insight?: string;
  nextStep?: string;
  matchedSignals?: string[];
  installCommand: string;
}

export interface UserSkillsMapping {
  totalSkills: number;
  usedCount: number;
  recommendedCount: number;
  items: SkillMappingItem[];
}
