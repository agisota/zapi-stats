import type { Database } from 'bun:sqlite';
import { AccountService, centsToDollars, dollarsToCents } from './account-service.ts';
import { calculateCost } from './pricing.ts';
import { ProvisioningService } from './provisioning-service.ts';

export interface UsageBillingSummary {
  scanned: number;
  debited: number;
  totalDebited: number;
  balance: number;
  suspendedKeys: number;
  activatedKeys: number;
}

export class UsageBillingService {
  private hasUsageHistory: boolean | null = null;

  constructor(
    private usageDb: Database,
    private accountDb: Database,
    private accountService: AccountService,
    private provisioner: ProvisioningService,
    private options: { enforceBalance?: boolean } = {},
  ) {}

  reconcileUser(userId: string): UsageBillingSummary {
    if (!this.usageHistoryExists()) {
      const balance = this.accountService.getBalance(userId);
      return { scanned: 0, debited: 0, totalDebited: 0, balance: balance.available, suspendedKeys: 0, activatedKeys: 0 };
    }

    const keys = this.provisioner
      .listKeys(userId)
      .filter(key => key.status !== 'revoked')
      .map(key => ({ id: key.id, gatewayKeyId: key.gatewayKeyId }));

    if (keys.length === 0) {
      const balance = this.accountService.getBalance(userId);
      return { scanned: 0, debited: 0, totalDebited: 0, balance: balance.available, suspendedKeys: 0, activatedKeys: 0 };
    }

    let scanned = 0;
    let debited = 0;
    let totalCents = 0;
    for (const key of keys) {
      const cursor = this.readCursor(key.id);
      const rows = this.usageDb.prepare(`
        SELECT id, provider, model, api_key_id, tokens_input, tokens_output, success, timestamp
        FROM usage_history
        WHERE api_key_id = ?
          AND id > ?
          AND COALESCE(success, 1) = 1
        ORDER BY id ASC
        LIMIT 1000
      `).all(key.gatewayKeyId, cursor) as UsageHistoryRow[];

      scanned += rows.length;
      let maxUsageId = cursor;
      for (const row of rows) {
        maxUsageId = Math.max(maxUsageId, row.id);
        const cost = calculateCost(row.model ?? 'unknown', row.tokens_input ?? 0, row.tokens_output ?? 0);
        const cents = dollarsToCents(cost);
        if (cents <= 0) continue;
        const result = this.accountService.debitWallet({
          userId,
          amount: centsToDollars(cents),
          label: 'API usage',
          detail: `${row.model ?? 'unknown'} via ${row.provider ?? 'unknown'} (${row.tokens_input ?? 0} in / ${row.tokens_output ?? 0} out).`,
          externalRef: `usage:${row.id}`,
          metadata: {
            usageId: row.id,
            apiKeyId: row.api_key_id,
            provider: row.provider,
            model: row.model,
            timestamp: row.timestamp,
          },
        });
        if (result.debited) {
          debited += 1;
          totalCents += cents;
        }
      }
      if (maxUsageId > cursor) {
        this.writeCursor(key.id, maxUsageId);
      }
    }

    const balance = this.accountService.getBalance(userId);
    const access = this.options.enforceBalance
      ? this.provisioner.syncUserAccessByBalance(userId, dollarsToCents(balance.available))
      : { suspended: 0, activated: 0 };

    return {
      scanned,
      debited,
      totalDebited: centsToDollars(totalCents),
      balance: balance.available,
      suspendedKeys: access.suspended,
      activatedKeys: access.activated,
    };
  }

  private usageHistoryExists(): boolean {
    if (this.hasUsageHistory !== null) return this.hasUsageHistory;
    const row = this.usageDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'usage_history'").get();
    this.hasUsageHistory = Boolean(row);
    return this.hasUsageHistory;
  }

  private readCursor(accountKeyId: string): number {
    const row = this.accountDb.prepare('SELECT last_usage_id FROM usage_billing_cursors WHERE account_key_id = ?').get(accountKeyId) as { last_usage_id: number } | null;
    return row?.last_usage_id ?? 0;
  }

  private writeCursor(accountKeyId: string, usageId: number): void {
    this.accountDb.prepare(`
      INSERT INTO usage_billing_cursors (account_key_id, last_usage_id, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(account_key_id) DO UPDATE SET last_usage_id = excluded.last_usage_id, updated_at = excluded.updated_at
    `).run(accountKeyId, usageId, new Date().toISOString());
  }
}

interface UsageHistoryRow {
  id: number;
  provider: string | null;
  model: string | null;
  api_key_id: string | null;
  tokens_input: number | null;
  tokens_output: number | null;
  success: number | null;
  timestamp: string;
}
