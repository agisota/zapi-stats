import { Database } from 'bun:sqlite';
import { hashSecret, id, secret } from './account-service.ts';
import type { ApiKeyInfo } from './auth-service.ts';
import { getDisplayName } from './display-names.ts';

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

export interface CreatedManagedApiKey extends ManagedApiKey {
  rawKey: string;
}

export interface ManagedKeyOwner {
  id: string;
  userId: string;
  gatewayKeyId: string;
  status: ManagedApiKey['status'];
}

export class ProvisioningService {
  private gatewayWriteDb: Database | null;
  private gatewayColumns: Set<string> | null = null;
  private enforceBalance: boolean;

  constructor(private accountDb: Database, options: { gatewayWriteDbPath?: string | null; enforceBalance?: boolean } = {}) {
    this.gatewayWriteDb = options.gatewayWriteDbPath ? new Database(options.gatewayWriteDbPath) : null;
    this.enforceBalance = options.enforceBalance === true;
    if (this.gatewayWriteDb) {
      this.gatewayColumns = new Set(
        (this.gatewayWriteDb.prepare('PRAGMA table_info(api_keys)').all() as Array<{ name: string }>).map(c => c.name),
      );
    }
  }

  createKey(input: {
    userId: string;
    userEmail: string;
    userDisplayName: string;
    displayName?: string;
    noLog?: boolean;
    limits?: Partial<KeyLimits>;
  }): CreatedManagedApiKey {
    const rawKey = secret('zed');
    const now = new Date().toISOString();
    const gatewayKeyId = id('key');
    const gatewayName = gatewaySafeName(input.userEmail, input.userId);
    const limits = normalizeLimits(input.limits);
    const status: ManagedApiKey['status'] = this.enforceBalance && this.userAvailableCents(input.userId) <= 0 ? 'suspended' : 'active';
    const key: CreatedManagedApiKey = {
      id: id('ak'),
      userId: input.userId,
      gatewayKeyId,
      gatewayName,
      keyPrefix: rawKey.slice(0, 18),
      displayName: String(input.displayName ?? 'Default key').trim().slice(0, 80) || 'Default key',
      status,
      syncStatus: 'shadow',
      noLog: input.noLog === true,
      limits,
      createdAt: now,
      revokedAt: null,
      rawKey,
    };

    let syncStatus: ManagedApiKey['syncStatus'] = 'shadow';
    if (this.gatewayWriteDb) {
      try {
        this.insertGatewayKey({ ...key, syncStatus }, rawKey);
        syncStatus = 'synced';
      } catch (error) {
        syncStatus = 'failed';
        console.error('[provisioning] failed to sync new key to gateway', error);
      }
    }

    this.accountDb.prepare(`
      INSERT INTO account_keys
      (id, user_id, gateway_key_id, gateway_name, key_hash, key_prefix, display_name, status, sync_status, no_log, limits_json, created_at, revoked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      key.id,
      key.userId,
      key.gatewayKeyId,
      key.gatewayName,
      hashSecret(rawKey),
      key.keyPrefix,
      key.displayName,
      key.status,
      syncStatus,
      key.noLog ? 1 : 0,
      JSON.stringify(key.limits),
      key.createdAt,
      null,
    );

    this.audit(key.userId, 'key.created', 'account_key', key.id, { gatewayKeyId, syncStatus, limits: key.limits });
    return { ...key, syncStatus };
  }

  listKeys(userId: string): ManagedApiKey[] {
    const rows = this.accountDb.prepare('SELECT * FROM account_keys WHERE user_id = ? ORDER BY created_at DESC').all(userId) as DbAccountKeyRow[];
    return rows.map(fromKeyRow);
  }

  revokeKey(userId: string, keyId: string): ManagedApiKey {
    const key = this.getOwnedKey(userId, keyId);
    if (key.status === 'revoked') return key;
    const now = new Date().toISOString();
    let syncStatus = key.syncStatus;
    if (this.gatewayWriteDb) {
      try {
        this.updateGatewayKey(key.gatewayKeyId, { is_active: 0 });
        syncStatus = 'synced';
      } catch (error) {
        syncStatus = 'failed';
        console.error('[provisioning] failed to revoke gateway key', error);
      }
    }
    this.accountDb.prepare('UPDATE account_keys SET status = ?, sync_status = ?, revoked_at = ? WHERE id = ?').run('revoked', syncStatus, now, key.id);
    this.audit(userId, 'key.revoked', 'account_key', key.id, { gatewayKeyId: key.gatewayKeyId, syncStatus });
    return this.getOwnedKey(userId, keyId);
  }

  rotateKey(input: { userId: string; userEmail: string; userDisplayName: string; keyId: string }): CreatedManagedApiKey {
    const oldKey = this.revokeKey(input.userId, input.keyId);
    return this.createKey({
      userId: input.userId,
      userEmail: input.userEmail,
      userDisplayName: input.userDisplayName,
      displayName: `${oldKey.displayName} rotated`,
      noLog: oldKey.noLog,
      limits: oldKey.limits,
    });
  }

  updateLimits(userId: string, keyId: string, limitsInput: Partial<KeyLimits>): ManagedApiKey {
    const key = this.getOwnedKey(userId, keyId);
    const limits = normalizeLimits({ ...key.limits, ...limitsInput });
    let syncStatus = key.syncStatus;
    if (this.gatewayWriteDb && key.status === 'active') {
      try {
        this.updateGatewayKey(key.gatewayKeyId, {
          max_requests_per_minute: limits.maxRequestsPerMinute,
          max_requests_per_day: limits.maxRequestsPerDay,
          allowed_models: JSON.stringify(limits.allowedModels),
          allowed_connections: JSON.stringify(limits.allowedConnections),
        });
        syncStatus = 'synced';
      } catch (error) {
        syncStatus = 'failed';
        console.error('[provisioning] failed to update gateway limits', error);
      }
    }
    this.accountDb.prepare('UPDATE account_keys SET limits_json = ?, sync_status = ? WHERE id = ?').run(JSON.stringify(limits), syncStatus, key.id);
    this.audit(userId, 'key.limits.updated', 'account_key', key.id, { limits, syncStatus });
    return this.getOwnedKey(userId, keyId);
  }

  validateManagedKey(rawKey: string): ApiKeyInfo | null {
    const row = this.accountDb.prepare(`
      SELECT k.*, u.display_name as user_display_name, u.status as user_status, u.created_at as user_created_at, w.available_cents as wallet_available_cents
      FROM account_keys k
      JOIN users u ON u.id = k.user_id
      JOIN wallets w ON w.user_id = u.id
      WHERE k.key_hash = ?
    `).get(hashSecret(rawKey)) as (DbAccountKeyRow & { user_display_name: string; user_status: string; user_created_at: string; wallet_available_cents: number }) | null;

    if (!row || row.status !== 'active' || row.user_status !== 'active') return null;
    if (this.enforceBalance && row.wallet_available_cents <= 0) return null;
    return {
      id: row.gateway_key_id,
      name: row.gateway_name,
      displayName: getDisplayName(row.user_display_name || row.gateway_name),
      noLog: row.no_log === 1,
      isActive: true,
      createdAt: row.created_at,
      lastUsedAt: null,
    };
  }

  findManagedKeyOwner(rawKey: string): ManagedKeyOwner | null {
    const row = this.accountDb.prepare(`
      SELECT id, user_id, gateway_key_id, status
      FROM account_keys
      WHERE key_hash = ?
    `).get(hashSecret(rawKey)) as { id: string; user_id: string; gateway_key_id: string; status: string } | null;

    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      gatewayKeyId: row.gateway_key_id,
      status: row.status as ManagedApiKey['status'],
    };
  }

  syncUserAccessByBalance(userId: string, availableCents: number): { suspended: number; activated: number } {
    if (!this.enforceBalance) return { suspended: 0, activated: 0 };
    const now = new Date().toISOString();
    const nextStatus: ManagedApiKey['status'] = availableCents > 0 ? 'active' : 'suspended';
    const currentStatus: ManagedApiKey['status'] = availableCents > 0 ? 'suspended' : 'active';
    const rows = this.accountDb.prepare(`
      SELECT * FROM account_keys
      WHERE user_id = ? AND status = ?
    `).all(userId, currentStatus) as DbAccountKeyRow[];

    for (const row of rows) {
      let syncStatus = row.sync_status;
      if (this.gatewayWriteDb) {
        try {
          const patch: Record<string, string | number | null> = { is_active: nextStatus === 'active' ? 1 : 0 };
          if (nextStatus === 'active') {
            const limits = JSON.parse(row.limits_json) as KeyLimits;
            patch.max_requests_per_minute = limits.maxRequestsPerMinute;
            patch.max_requests_per_day = limits.maxRequestsPerDay;
            patch.allowed_models = JSON.stringify(limits.allowedModels);
            patch.allowed_connections = JSON.stringify(limits.allowedConnections);
          }
          this.updateGatewayKey(row.gateway_key_id, patch);
          syncStatus = 'synced';
        } catch (error) {
          syncStatus = 'failed';
          console.error('[provisioning] failed to sync balance access state', error);
        }
      }
      this.accountDb.prepare('UPDATE account_keys SET status = ?, sync_status = ? WHERE id = ?').run(nextStatus, syncStatus, row.id);
      this.audit(userId, nextStatus === 'active' ? 'key.balance_activated' : 'key.balance_suspended', 'account_key', row.id, {
        gatewayKeyId: row.gateway_key_id,
        syncStatus,
        availableCents,
      });
    }

    return nextStatus === 'active'
      ? { suspended: 0, activated: rows.length }
      : { suspended: rows.length, activated: 0 };
  }

  private getOwnedKey(userId: string, keyId: string): ManagedApiKey {
    const row = this.accountDb.prepare('SELECT * FROM account_keys WHERE user_id = ? AND id = ?').get(userId, keyId) as DbAccountKeyRow | null;
    if (!row) throw new ProvisioningError('KEY_NOT_FOUND', 'API key not found', 404);
    return fromKeyRow(row);
  }

  private userAvailableCents(userId: string): number {
    const row = this.accountDb.prepare('SELECT available_cents FROM wallets WHERE user_id = ?').get(userId) as { available_cents: number } | null;
    return row?.available_cents ?? 0;
  }

  private insertGatewayKey(key: ManagedApiKey, rawKey: string): void {
    if (!this.gatewayWriteDb || !this.gatewayColumns) return;
    const values: Record<string, string | number | null> = {
      id: key.gatewayKeyId,
      name: key.gatewayName,
      key: rawKey,
      no_log: key.noLog ? 1 : 0,
      is_active: key.status === 'active' ? 1 : 0,
      created_at: key.createdAt,
      allowed_models: JSON.stringify(key.limits.allowedModels),
      allowed_connections: JSON.stringify(key.limits.allowedConnections),
      max_requests_per_day: key.limits.maxRequestsPerDay,
      max_requests_per_minute: key.limits.maxRequestsPerMinute,
    };
    const columns = Object.keys(values).filter(column => this.gatewayColumns!.has(column));
    const placeholders = columns.map(column => `$${column}`);
    const params = Object.fromEntries(columns.map(column => [`$${column}`, values[column]])) as Record<string, string | number | null>;
    this.gatewayWriteDb.prepare(`INSERT INTO api_keys (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`).run(params);
  }

  private updateGatewayKey(gatewayKeyId: string, patch: Record<string, string | number | null>): void {
    if (!this.gatewayWriteDb || !this.gatewayColumns) return;
    const columns = Object.keys(patch).filter(column => this.gatewayColumns!.has(column));
    if (columns.length === 0) return;
    const setClause = columns.map(column => `${column} = $${column}`).join(', ');
    const params = Object.fromEntries(columns.map(column => [`$${column}`, patch[column]])) as Record<string, string | number | null>;
    this.gatewayWriteDb.prepare(`UPDATE api_keys SET ${setClause} WHERE id = $id`).run({ ...params, $id: gatewayKeyId });
  }

  private audit(actorUserId: string | null, action: string, targetType: string, targetId: string | null, metadata: unknown): void {
    this.accountDb.prepare(`
      INSERT INTO audit_events (id, actor_user_id, action, target_type, target_id, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id('aud'), actorUserId, action, targetType, targetId, JSON.stringify(metadata ?? {}), new Date().toISOString());
  }
}

export class ProvisioningError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

function normalizeLimits(input: Partial<KeyLimits> = {}): KeyLimits {
  return {
    maxRequestsPerMinute: clampInt(input.maxRequestsPerMinute, 1, 10_000, 10),
    maxRequestsPerDay: clampInt(input.maxRequestsPerDay, 1, 1_000_000, 1_000),
    allowedModels: Array.isArray(input.allowedModels) ? input.allowedModels.filter(Boolean).slice(0, 200) : [],
    allowedConnections: Array.isArray(input.allowedConnections) ? input.allowedConnections.filter(Boolean).slice(0, 200) : [],
  };
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function gatewaySafeName(email: string, userId: string): string {
  const prefix = email.split('@')[0]?.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'user';
  return `${prefix}_${userId.slice(-8)}`;
}

function fromKeyRow(row: DbAccountKeyRow): ManagedApiKey {
  return {
    id: row.id,
    userId: row.user_id,
    gatewayKeyId: row.gateway_key_id,
    gatewayName: row.gateway_name,
    keyPrefix: row.key_prefix,
    displayName: row.display_name,
    status: row.status as ManagedApiKey['status'],
    syncStatus: row.sync_status as ManagedApiKey['syncStatus'],
    noLog: row.no_log === 1,
    limits: JSON.parse(row.limits_json) as KeyLimits,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };
}

interface DbAccountKeyRow {
  id: string;
  user_id: string;
  gateway_key_id: string;
  gateway_name: string;
  key_prefix: string;
  display_name: string;
  status: string;
  sync_status: string;
  no_log: number;
  limits_json: string;
  created_at: string;
  revoked_at: string | null;
}
