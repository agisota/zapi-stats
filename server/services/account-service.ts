import type { Database } from 'bun:sqlite';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

const SESSION_TTL_DAYS = 30;
const MAGIC_LINK_TTL_MINUTES = 15;

export interface AccountUser {
  id: string;
  email: string;
  displayName: string;
  status: 'pending' | 'active' | 'suspended';
  createdAt: string;
  verifiedAt: string | null;
}

export interface AccountSession {
  id: string;
  userId: string;
  token: string;
  createdAt: string;
  expiresAt: string;
}

export interface MagicLinkChallenge {
  id: string;
  user: AccountUser;
  email: string;
  token: string;
  createdAt: string;
  expiresAt: string;
}

export interface MagicLinkConsumeResult {
  user: AccountUser;
  session: AccountSession;
  activated: boolean;
}

export interface WalletBalance {
  walletId: string;
  currency: 'USD';
  available: number;
  reserved: number;
  spent: number;
  updatedAt: string;
}

export interface WalletLedgerEntry {
  id: string;
  type: 'credit' | 'debit' | 'refund' | 'adjustment';
  amount: number;
  balanceAfter: number;
  label: string;
  detail: string;
  externalRef: string | null;
  createdAt: string;
}

export interface WalletDebitResult {
  debited: boolean;
  balance: WalletBalance;
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

export class AccountService {
  constructor(private db: Database) {}

  register(input: { email: string; displayName?: string; autoVerify?: boolean }): { user: AccountUser; session: AccountSession } {
    const email = normalizeEmail(input.email);
    if (!email) throw new AccountError('INVALID_EMAIL', 'Valid email is required', 400);

    const existing = this.getUserByEmail(email);
    if (existing) throw new AccountError('ACCOUNT_EXISTS', 'Account already exists', 409);

    const now = new Date().toISOString();
    const user: AccountUser = {
      id: id('usr'),
      email,
      displayName: cleanDisplayName(input.displayName, email),
      status: input.autoVerify === false ? 'pending' : 'active',
      createdAt: now,
      verifiedAt: input.autoVerify === false ? null : now,
    };

    this.db.transaction(() => {
      this.db.prepare(
        'INSERT INTO users (id, email, display_name, status, created_at, verified_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(user.id, user.email, user.displayName, user.status, user.createdAt, user.verifiedAt);
      this.db.prepare(
        'INSERT INTO wallets (id, user_id, currency, available_cents, reserved_cents, updated_at) VALUES (?, ?, ?, 0, 0, ?)',
      ).run(id('wal'), user.id, 'USD', now);
      this.audit(user.id, 'account.registered', 'user', user.id, { email: user.email, status: user.status }, now);
    })();

    return { user, session: this.createSession(user.id) };
  }

  loginByEmail(emailInput: string): { user: AccountUser; session: AccountSession } {
    const email = normalizeEmail(emailInput);
    const user = email ? this.getUserByEmail(email) : null;
    if (!user || user.status !== 'active') {
      throw new AccountError('INVALID_ACCOUNT', 'Account not found or inactive', 401);
    }
    return { user, session: this.createSession(user.id) };
  }

  createMagicLinkForEmail(emailInput: string, ttlMinutes = MAGIC_LINK_TTL_MINUTES): MagicLinkChallenge | null {
    const email = normalizeEmail(emailInput);
    if (!email) throw new AccountError('INVALID_EMAIL', 'Valid email is required', 400);
    const user = this.getUserByEmail(email);
    if (!user || user.status === 'suspended') return null;
    return this.createMagicLinkForUser(user.id, ttlMinutes);
  }

  createMagicLinkForUser(userId: string, ttlMinutes = MAGIC_LINK_TTL_MINUTES): MagicLinkChallenge {
    const user = this.getUserById(userId);
    if (!user || user.status === 'suspended') {
      throw new AccountError('INVALID_ACCOUNT', 'Account not found or inactive', 401);
    }
    const now = new Date();
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + sanitizeTtlMinutes(ttlMinutes) * 60 * 1000).toISOString();
    const token = secret('ml');
    const challenge: MagicLinkChallenge = {
      id: id('mlk'),
      user,
      email: user.email,
      token,
      createdAt,
      expiresAt,
    };

    this.db.transaction(() => {
      this.db.prepare(`
        UPDATE magic_links
        SET revoked_at = ?
        WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL
      `).run(createdAt, user.id);
      this.db.prepare(`
        INSERT INTO magic_links
        (id, user_id, email, token_hash, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(challenge.id, user.id, user.email, hashSecret(token), createdAt, expiresAt);
      this.audit(user.id, 'account.magic_link.created', 'magic_link', challenge.id, { email: user.email, expiresAt }, createdAt);
    })();

    return challenge;
  }

  markMagicLinkSent(linkId: string, provider: string, messageId: string | null): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE magic_links
      SET provider = ?, provider_message_id = ?, sent_at = ?
      WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL
    `).run(provider, messageId, now, linkId);
    const row = this.db.prepare('SELECT user_id FROM magic_links WHERE id = ?').get(linkId) as { user_id: string } | null;
    this.audit(row?.user_id ?? null, 'account.magic_link.sent', 'magic_link', linkId, { provider, messageId }, now);
  }

  consumeMagicLink(rawToken: string): MagicLinkConsumeResult {
    const token = String(rawToken ?? '').trim();
    if (!token) throw new AccountError('MAGIC_LINK_INVALID', 'Magic link is invalid or expired', 401);
    const row = this.db.prepare(`
      SELECT
        ml.id as link_id,
        ml.user_id as link_user_id,
        ml.expires_at as link_expires_at,
        ml.used_at as link_used_at,
        ml.revoked_at as link_revoked_at,
        u.id as user_id,
        u.email as user_email,
        u.display_name as user_display_name,
        u.status as user_status,
        u.created_at as user_created_at,
        u.verified_at as user_verified_at
      FROM magic_links ml
      JOIN users u ON u.id = ml.user_id
      WHERE ml.token_hash = ?
    `).get(hashSecret(token)) as DbMagicLinkTokenRow | null;

    if (
      !row
      || row.link_used_at
      || row.link_revoked_at
      || new Date(row.link_expires_at).getTime() <= Date.now()
      || row.user_status === 'suspended'
    ) {
      throw new AccountError('MAGIC_LINK_INVALID', 'Magic link is invalid or expired', 401);
    }

    const now = new Date().toISOString();
    const activated = row.user_status === 'pending';
    let session: AccountSession | null = null;

    this.db.transaction(() => {
      const updated = this.db.prepare(`
        UPDATE magic_links
        SET used_at = ?
        WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL
      `).run(now, row.link_id) as { changes: number };
      if (updated.changes !== 1) {
        throw new AccountError('MAGIC_LINK_INVALID', 'Magic link is invalid or expired', 401);
      }
      if (activated) {
        this.db.prepare(`
          UPDATE users
          SET status = 'active', verified_at = ?
          WHERE id = ? AND status = 'pending'
        `).run(now, row.user_id);
        this.audit(row.user_id, 'account.email_verified', 'user', row.user_id, { via: 'magic_link' }, now);
      }
      this.audit(row.user_id, 'account.magic_link.used', 'magic_link', row.link_id, { activated }, now);
      session = this.createSession(row.user_id);
    })();

    const user = this.getUserById(row.user_id);
    if (!user || !session) throw new AccountError('MAGIC_LINK_INVALID', 'Magic link is invalid or expired', 401);
    return { user, session, activated };
  }

  authenticate(rawToken: string | null): AccountUser | null {
    if (!rawToken) return null;
    const tokenHash = hashSecret(rawToken);
    const row = this.db.prepare(`
      SELECT u.id, u.email, u.display_name, u.status, u.created_at, u.verified_at, s.expires_at, s.revoked_at
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?
    `).get(tokenHash) as DbUserRow & { expires_at: string; revoked_at: string | null } | null;

    if (!row || row.revoked_at || new Date(row.expires_at).getTime() <= Date.now()) return null;
    if (row.status !== 'active') return null;
    return fromUserRow(row);
  }

  getUserById(userId: string): AccountUser | null {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as DbUserRow | null;
    return row ? fromUserRow(row) : null;
  }

  getUserByEmail(email: string): AccountUser | null {
    const row = this.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as DbUserRow | null;
    return row ? fromUserRow(row) : null;
  }

  getBalance(userId: string): WalletBalance {
    const wallet = this.walletForUser(userId);
    const spent = this.db.prepare(`
      SELECT COALESCE(SUM(ABS(amount_cents)), 0) as cents
      FROM wallet_ledger
      WHERE wallet_id = ? AND type = 'debit'
    `).get(wallet.id) as { cents: number };

    return {
      walletId: wallet.id,
      currency: wallet.currency,
      available: centsToDollars(wallet.available_cents),
      reserved: centsToDollars(wallet.reserved_cents),
      spent: centsToDollars(spent.cents ?? 0),
      updatedAt: wallet.updated_at,
    };
  }

  getLedger(userId: string, limit = 50): WalletLedgerEntry[] {
    const wallet = this.walletForUser(userId);
    const rows = this.db.prepare(`
      SELECT * FROM wallet_ledger
      WHERE wallet_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(wallet.id, Math.max(1, Math.min(200, limit))) as DbLedgerRow[];
    return rows.map(row => ({
      id: row.id,
      type: row.type as WalletLedgerEntry['type'],
      amount: centsToDollars(row.amount_cents),
      balanceAfter: centsToDollars(row.balance_after_cents),
      label: row.label,
      detail: row.detail,
      externalRef: row.external_ref,
      createdAt: row.created_at,
    }));
  }

  createPaymentIntent(userId: string, amount: number, metadata: unknown): PaymentIntent {
    const cents = dollarsToCents(amount);
    if (cents < 500) throw new AccountError('AMOUNT_TOO_SMALL', 'Minimum top-up is $5.00', 400);
    if (cents > 1_000_000) throw new AccountError('AMOUNT_TOO_LARGE', 'Maximum top-up is $10,000.00', 400);

    const now = new Date().toISOString();
    const intent: PaymentIntent = {
      id: randomUUID(),
      userId,
      provider: 'dvnet',
      providerPaymentId: null,
      status: 'pending',
      amount: centsToDollars(cents),
      currency: 'USD',
      checkoutUrl: null,
      idempotencyKey: id('idem'),
      createdAt: now,
      updatedAt: now,
    };

    this.db.prepare(`
      INSERT INTO payment_intents
      (id, user_id, provider, provider_payment_id, status, amount_cents, currency, checkout_url, idempotency_key, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(intent.id, userId, intent.provider, null, intent.status, cents, intent.currency, null, intent.idempotencyKey, JSON.stringify(metadata ?? {}), now, now);
    this.audit(userId, 'billing.topup.created', 'payment_intent', intent.id, { amount: intent.amount }, now);
    return intent;
  }

  attachPaymentCheckout(input: {
    intentId: string;
    userId: string;
    checkoutUrl: string | null;
    providerPaymentId: string | null;
    metadata: unknown;
  }): PaymentIntent {
    const intent = this.getPaymentIntent(input.intentId);
    if (!intent || intent.userId !== input.userId || intent.status !== 'pending') {
      throw new AccountError('PAYMENT_INTENT_NOT_FOUND', 'Pending payment intent not found', 404);
    }
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE payment_intents
      SET checkout_url = ?, provider_payment_id = ?, metadata_json = ?, updated_at = ?
      WHERE id = ?
    `).run(input.checkoutUrl, input.providerPaymentId, JSON.stringify(input.metadata ?? {}), now, input.intentId);
    this.audit(input.userId, 'billing.topup.checkout_attached', 'payment_intent', input.intentId, { checkoutUrl: input.checkoutUrl, providerPaymentId: input.providerPaymentId }, now);
    return this.getPaymentIntent(input.intentId)!;
  }

  completeDvnetPayment(input: {
    paymentIntentId: string;
    amount: number;
    externalRef: string;
    providerPaymentId?: string | null;
    metadata?: unknown;
  }): { credited: boolean; balance: WalletBalance; userId: string } {
    const cents = dollarsToCents(input.amount);
    if (cents <= 0) throw new AccountError('INVALID_AMOUNT', 'Payment amount must be positive', 400);
    const intent = this.getPaymentIntent(input.paymentIntentId);
    if (!intent) throw new AccountError('PAYMENT_INTENT_NOT_FOUND', 'Pending payment intent not found for DV.net webhook', 404);
    if (intent.status !== 'pending') {
      const duplicate = this.db.prepare('SELECT id FROM wallet_ledger WHERE external_ref = ?').get(input.externalRef);
      if (duplicate) return { credited: false, balance: this.getBalance(intent.userId), userId: intent.userId };
      throw new AccountError('PAYMENT_INTENT_CLOSED', 'Payment intent is not pending', 409);
    }
    if (dollarsToCents(intent.amount) !== cents) {
      throw new AccountError('PAYMENT_AMOUNT_MISMATCH', 'DV.net amount does not match the pending top-up intent', 409);
    }
    const wallet = this.walletForUser(intent.userId);
    const now = new Date().toISOString();
    const existing = this.db.prepare('SELECT id FROM wallet_ledger WHERE external_ref = ?').get(input.externalRef);
    if (existing) return { credited: false, balance: this.getBalance(intent.userId), userId: intent.userId };

    this.db.transaction(() => {
      const nextBalance = wallet.available_cents + cents;
      this.db.prepare('UPDATE wallets SET available_cents = ?, updated_at = ? WHERE id = ?').run(nextBalance, now, wallet.id);
      this.db.prepare(`
        UPDATE payment_intents
        SET status = 'completed', provider_payment_id = COALESCE(?, provider_payment_id), updated_at = ?
        WHERE id = ?
      `).run(input.providerPaymentId ?? null, now, intent.id);
      this.db.prepare(`
        INSERT INTO wallet_ledger
        (id, wallet_id, type, amount_cents, balance_after_cents, label, detail, external_ref, metadata_json, created_at)
        VALUES (?, ?, 'credit', ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id('led'),
        wallet.id,
        cents,
        nextBalance,
        'DV.net top-up',
        `Confirmed DV.net payment for ${centsToDollars(cents).toFixed(2)} USD.`,
        input.externalRef,
        JSON.stringify(input.metadata ?? {}),
        now,
      );
      this.audit(intent.userId, 'billing.topup.completed', 'wallet', wallet.id, { amount: centsToDollars(cents), externalRef: input.externalRef, providerPaymentId: input.providerPaymentId, paymentIntentId: intent.id }, now);
    })();

    return { credited: true, balance: this.getBalance(intent.userId), userId: intent.userId };
  }

  debitWallet(input: {
    userId: string;
    amount: number;
    label: string;
    detail: string;
    externalRef: string;
    metadata?: unknown;
  }): WalletDebitResult {
    const cents = dollarsToCents(input.amount);
    if (cents <= 0) return { debited: false, balance: this.getBalance(input.userId) };
    const existing = this.db.prepare('SELECT id FROM wallet_ledger WHERE external_ref = ?').get(input.externalRef);
    if (existing) return { debited: false, balance: this.getBalance(input.userId) };

    const wallet = this.walletForUser(input.userId);
    const now = new Date().toISOString();
    this.db.transaction(() => {
      const nextBalance = wallet.available_cents - cents;
      this.db.prepare('UPDATE wallets SET available_cents = ?, updated_at = ? WHERE id = ?').run(nextBalance, now, wallet.id);
      this.db.prepare(`
        INSERT INTO wallet_ledger
        (id, wallet_id, type, amount_cents, balance_after_cents, label, detail, external_ref, metadata_json, created_at)
        VALUES (?, ?, 'debit', ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id('led'),
        wallet.id,
        -cents,
        nextBalance,
        input.label,
        input.detail,
        input.externalRef,
        JSON.stringify(input.metadata ?? {}),
        now,
      );
      this.audit(input.userId, 'billing.usage.debited', 'wallet', wallet.id, { amount: centsToDollars(cents), externalRef: input.externalRef }, now);
    })();

    return { debited: true, balance: this.getBalance(input.userId) };
  }

  private getPaymentIntent(intentId: string): PaymentIntent | null {
    const row = this.db.prepare('SELECT * FROM payment_intents WHERE id = ?').get(intentId) as DbPaymentIntentRow | null;
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      provider: row.provider,
      providerPaymentId: row.provider_payment_id,
      status: row.status as PaymentIntent['status'],
      amount: centsToDollars(row.amount_cents),
      currency: row.currency as 'USD',
      checkoutUrl: row.checkout_url,
      idempotencyKey: row.idempotency_key,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private createSession(userId: string): AccountSession {
    const now = new Date();
    const token = secret('acct');
    const session: AccountSession = {
      id: id('ses'),
      userId,
      token,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    };
    this.db.prepare(
      'INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
    ).run(session.id, userId, hashSecret(token), session.createdAt, session.expiresAt);
    this.audit(userId, 'account.session.created', 'session', session.id, {}, session.createdAt);
    return session;
  }

  private walletForUser(userId: string): DbWalletRow {
    const row = this.db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId) as DbWalletRow | null;
    if (!row) throw new AccountError('WALLET_NOT_FOUND', 'Wallet not found', 404);
    return row;
  }

  private audit(actorUserId: string | null, action: string, targetType: string, targetId: string | null, metadata: unknown, now = new Date().toISOString()): void {
    this.db.prepare(`
      INSERT INTO audit_events (id, actor_user_id, action, target_type, target_id, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id('aud'), actorUserId, action, targetType, targetId, JSON.stringify(metadata ?? {}), now);
  }
}

export class AccountError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

export function hashSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function id(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('hex')}`;
}

export function secret(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString('base64url')}`;
}

export function dollarsToCents(amount: number): number {
  if (!Number.isFinite(amount)) throw new AccountError('INVALID_AMOUNT', 'Amount must be numeric', 400);
  return Math.round(amount * 100);
}

export function centsToDollars(cents: number): number {
  return Math.round(cents) / 100;
}

function normalizeEmail(input: string): string | null {
  const email = String(input ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function cleanDisplayName(displayName: string | undefined, email: string): string {
  const clean = String(displayName ?? '').trim().replace(/\s+/g, ' ');
  if (clean.length >= 2 && clean.length <= 80) return clean;
  return email.split('@')[0] || 'API user';
}

function sanitizeTtlMinutes(input: number): number {
  if (!Number.isFinite(input)) return MAGIC_LINK_TTL_MINUTES;
  return Math.max(5, Math.min(60, Math.round(input)));
}

function fromUserRow(row: DbUserRow): AccountUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    status: row.status as AccountUser['status'],
    createdAt: row.created_at,
    verifiedAt: row.verified_at,
  };
}

interface DbUserRow {
  id: string;
  email: string;
  display_name: string;
  status: string;
  created_at: string;
  verified_at: string | null;
}

interface DbWalletRow {
  id: string;
  user_id: string;
  currency: 'USD';
  available_cents: number;
  reserved_cents: number;
  updated_at: string;
}

interface DbLedgerRow {
  id: string;
  type: string;
  amount_cents: number;
  balance_after_cents: number;
  label: string;
  detail: string;
  external_ref: string | null;
  created_at: string;
}

interface DbPaymentIntentRow {
  id: string;
  user_id: string;
  provider: string;
  provider_payment_id: string | null;
  status: string;
  amount_cents: number;
  currency: string;
  checkout_url: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

interface DbMagicLinkTokenRow {
  link_id: string;
  link_user_id: string;
  link_expires_at: string;
  link_used_at: string | null;
  link_revoked_at: string | null;
  user_id: string;
  user_email: string;
  user_display_name: string;
  user_status: string;
  user_created_at: string;
  user_verified_at: string | null;
}
