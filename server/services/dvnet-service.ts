import { createHash } from 'node:crypto';
import { safeEqual } from './account-service.ts';

export interface DvnetCheckout {
  configured: boolean;
  checkoutUrl: string | null;
  providerPaymentId: string | null;
  raw: unknown;
}

export interface DvnetPaymentWebhook {
  type: string;
  paymentIntentId: string;
  amount: number;
  externalRef: string;
  providerPaymentId: string | null;
  raw: unknown;
}

export class DvnetService {
  private apiBaseUrl: string | null;
  private apiKey: string | null;
  private webhookSecret: string | null;

  constructor(env: Record<string, string | undefined> = process.env) {
    this.apiBaseUrl = trimTrailingSlash(env.DVNET_API_BASE_URL ?? env.DVNET_BASE_URL ?? '');
    this.apiKey = env.DVNET_API_KEY || null;
    this.webhookSecret = env.DVNET_WEBHOOK_SECRET || env.DVNET_SECRET_KEY || null;
  }

  get configured(): boolean {
    return Boolean(this.apiBaseUrl && this.apiKey);
  }

  async createDepositWallet(input: { storeExternalId: string; amount: number }): Promise<DvnetCheckout> {
    if (!this.configured) {
      return {
        configured: false,
        checkoutUrl: null,
        providerPaymentId: null,
        raw: { mode: 'unconfigured', message: 'Set DVNET_API_BASE_URL and DVNET_API_KEY to create live DV.net payment links.' },
      };
    }

    const res = await fetch(`${this.apiBaseUrl}/api/v1/external/wallet`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey!,
      },
      body: JSON.stringify({
        amount: input.amount,
        store_external_id: input.storeExternalId,
      }),
    });

    const raw = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new DvnetError('DVNET_CHECKOUT_FAILED', `DV.net checkout failed with HTTP ${res.status}`, 502, raw);
    }

    const envelope = raw as Record<string, unknown>;
    const data = isRecord(envelope.data) ? envelope.data : envelope;
    return {
      configured: true,
      checkoutUrl: pickString(data, ['pay_url', 'payUrl', 'url', 'checkout_url']),
      providerPaymentId: pickString(data, ['id', 'wallet_id', 'walletId']),
      raw,
    };
  }

  verifyWebhook(rawBody: string, signature: string | null): boolean {
    if (!this.webhookSecret) return process.env.NODE_ENV !== 'production';
    if (!signature) return false;
    const calculated = createHash('sha256').update(rawBody + this.webhookSecret).digest('hex');
    return safeEqual(signature, calculated);
  }

  parsePaymentWebhook(payload: unknown): DvnetPaymentWebhook | null {
    const body = payload as Record<string, unknown>;
    const type = String(body.type ?? body.unconfirmed_type ?? '');
    if (type !== 'PaymentReceived') return null;

    const wallet = body.wallet as Record<string, unknown> | undefined;
    const transactions = body.transactions as Record<string, unknown> | undefined;
    const paymentIntentId = String(wallet?.store_external_id ?? '');
    const txHash = String(transactions?.tx_hash ?? '');
    const uniq = String(transactions?.bc_uniq_key ?? '0');
    const amount = Number(body.amount ?? transactions?.amount_usd ?? 0);

    if (!paymentIntentId || !txHash || !Number.isFinite(amount) || amount <= 0) {
      throw new DvnetError('INVALID_WEBHOOK', 'DV.net PaymentReceived webhook is missing payment intent id, transaction hash, or amount', 400, payload);
    }

    return {
      type,
      paymentIntentId,
      amount,
      externalRef: `dvnet:${txHash}:${uniq}`,
      providerPaymentId: typeof transactions?.tx_id === 'string' ? transactions.tx_id : null,
      raw: payload,
    };
  }
}

export class DvnetError extends Error {
  constructor(public code: string, message: string, public status = 400, public detail?: unknown) {
    super(message);
  }
}

function trimTrailingSlash(value: string): string | null {
  const clean = value.trim().replace(/\/+$/, '');
  return clean || null;
}

function pickString(data: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
