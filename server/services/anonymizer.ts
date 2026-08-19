import { createHmac } from 'node:crypto';

const DEV_ANON_SECRET = 'omniroute-stats-development-only';
const ALIAS_HEX_LENGTH = 12;

export function resolveAnonSecret(env: Record<string, string | undefined> = process.env): string {
  const configured = env.STATS_ANON_SECRET?.trim();
  if (configured) return configured;

  if (env.NODE_ENV === 'production') {
    throw new Error('STATS_ANON_SECRET must be configured in production');
  }

  return DEV_ANON_SECRET;
}

export class Anonymizer {
  constructor(private readonly secret: string) {
    if (!secret) throw new Error('An anonymization secret is required');
  }

  alias(apiKeyName: string): string {
    const digest = createHmac('sha256', this.secret).update(apiKeyName).digest('hex');
    return `user-${digest.slice(0, ALIAS_HEX_LENGTH)}`;
  }
}
