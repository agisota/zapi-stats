import { AccountError } from './account-service.ts';

export interface MagicLinkMailerConfig {
  configured: boolean;
  provider: 'resend' | 'log' | 'none';
  baseUrl: string | null;
  from: string | null;
  ttlMinutes: number;
  reason: string | null;
}

export interface MagicLinkDelivery {
  provider: string;
  messageId: string | null;
}

export interface MagicLinkMailer {
  config: MagicLinkMailerConfig;
  send(input: {
    idempotencyKey: string;
    email: string;
    token: string;
    displayName: string;
    expiresAt: string;
  }): Promise<MagicLinkDelivery>;
}

type Env = Record<string, string | undefined>;
type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function createMagicLinkMailer(env: Env = process.env, fetcher: FetchLike = fetch): MagicLinkMailer {
  const config = readMagicLinkConfig(env);
  return {
    config,
    async send(input) {
      if (!config.configured || !config.baseUrl) {
        throw new AccountError('MAGIC_LINK_NOT_CONFIGURED', config.reason ?? 'Magic-link provider is not configured', 503);
      }
      const link = buildMagicLinkUrl(config.baseUrl, input.token);
      const subject = 'Вход в API ZED';
      const text = [
        `Здравствуйте, ${input.displayName}.`,
        '',
        'Откройте одноразовую ссылку, чтобы войти в API ZED:',
        link,
        '',
        `Ссылка действует до ${input.expiresAt}. Если вы не запрашивали вход, просто проигнорируйте письмо.`,
      ].join('\n');
      const html = [
        `<p>Здравствуйте, ${escapeHtml(input.displayName)}.</p>`,
        '<p>Откройте одноразовую ссылку, чтобы войти в API ZED:</p>',
        `<p><a href="${escapeHtml(link)}">Войти в API ZED</a></p>`,
        `<p>Ссылка действует до ${escapeHtml(input.expiresAt)}. Если вы не запрашивали вход, просто проигнорируйте письмо.</p>`,
      ].join('');

      if (config.provider === 'log') {
        console.info('[magic-link] dev delivery', { email: input.email, link });
        return { provider: 'log', messageId: null };
      }

      if (config.provider !== 'resend' || !config.from) {
        throw new AccountError('MAGIC_LINK_NOT_CONFIGURED', 'Magic-link provider is not configured', 503);
      }

      return sendResendEmail(fetcher, env, {
        idempotencyKey: input.idempotencyKey,
        from: config.from,
        to: input.email,
        subject,
        text,
        html,
      });
    },
  };
}

export function buildMagicLinkUrl(baseUrl: string, token: string): string {
  const url = new URL('/magic', ensureTrailingSlash(baseUrl));
  url.hash = `token=${token}`;
  return url.toString();
}

function readMagicLinkConfig(env: Env): MagicLinkMailerConfig {
  const provider = readProvider(env);
  const baseUrl = clean(env.MAGIC_LINK_BASE_URL ?? env.PUBLIC_APP_URL ?? env.APP_BASE_URL)
    ?? (env.NODE_ENV === 'production' ? 'https://stats.api.zed.md' : null);
  const ttlMinutes = readTtl(env.MAGIC_LINK_TTL_MINUTES);
  const from = clean(env.MAGIC_LINK_FROM ?? env.RESEND_FROM);

  if (provider === 'none') {
    return { configured: false, provider, baseUrl, from, ttlMinutes, reason: 'MAGIC_LINK_PROVIDER is not configured' };
  }
  if (!baseUrl) {
    return { configured: false, provider, baseUrl, from, ttlMinutes, reason: 'MAGIC_LINK_BASE_URL or PUBLIC_APP_URL is required' };
  }
  if (env.NODE_ENV === 'production' && !baseUrl.startsWith('https://')) {
    return { configured: false, provider, baseUrl, from, ttlMinutes, reason: 'Production magic links require an HTTPS base URL' };
  }
  if (provider === 'log') {
    return {
      configured: env.NODE_ENV !== 'production',
      provider,
      baseUrl,
      from,
      ttlMinutes,
      reason: env.NODE_ENV === 'production' ? 'Log magic-link provider is disabled in production' : null,
    };
  }
  if (!clean(env.RESEND_API_KEY)) {
    return { configured: false, provider, baseUrl, from, ttlMinutes, reason: 'RESEND_API_KEY is required' };
  }
  if (!from) {
    return { configured: false, provider, baseUrl, from, ttlMinutes, reason: 'MAGIC_LINK_FROM is required' };
  }
  return { configured: true, provider, baseUrl, from, ttlMinutes, reason: null };
}

function readProvider(env: Env): MagicLinkMailerConfig['provider'] {
  const explicit = clean(env.MAGIC_LINK_PROVIDER)?.toLowerCase();
  if (explicit === 'resend' || explicit === 'log') return explicit;
  if (clean(env.RESEND_API_KEY)) return 'resend';
  return 'none';
}

async function sendResendEmail(
  fetcher: FetchLike,
  env: Env,
  input: {
    idempotencyKey: string;
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
  },
): Promise<MagicLinkDelivery> {
  const apiKey = clean(env.RESEND_API_KEY);
  if (!apiKey) throw new AccountError('MAGIC_LINK_NOT_CONFIGURED', 'RESEND_API_KEY is required', 503);

  const res = await fetcher('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': input.idempotencyKey,
    },
    body: JSON.stringify({
      from: input.from,
      to: [input.to],
      subject: input.subject,
      text: input.text,
      html: input.html,
      tags: [{ name: 'kind', value: 'magic_link' }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('[magic-link] resend rejected delivery', { status: res.status, detail: detail.slice(0, 500) });
    throw new AccountError('MAGIC_LINK_SEND_FAILED', 'Magic-link provider rejected the email', 502);
  }

  const body = await res.json().catch(() => ({})) as { id?: unknown };
  return { provider: 'resend', messageId: typeof body.id === 'string' ? body.id : null };
}

function readTtl(input: string | undefined): number {
  const parsed = Number(input ?? 15);
  if (!Number.isFinite(parsed)) return 15;
  return Math.max(5, Math.min(60, Math.round(parsed)));
}

function clean(input: string | undefined): string | null {
  const value = String(input ?? '').trim();
  return value ? value : null;
}

function ensureTrailingSlash(input: string): string {
  return input.endsWith('/') ? input : `${input}/`;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
