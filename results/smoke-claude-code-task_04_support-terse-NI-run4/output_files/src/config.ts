import * as dotenv from 'dotenv';

dotenv.config();

/** Read a required env var, failing fast at boot if it is missing. */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`Env ${name} must be a number`);
  return parsed;
}

const isProd = process.env.NODE_ENV === 'production';

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  isProd,
  port: int('PORT', 3000),
  corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),

  // In production a weak/default JWT secret is a security hole — refuse to boot.
  jwtSecret: (() => {
    const secret = process.env.JWT_SECRET ?? 'dev-only-insecure-secret';
    if (isProd && secret.length < 32) {
      throw new Error('JWT_SECRET must be at least 32 chars in production');
    }
    return secret;
  })(),
  jwtTtlSeconds: int('JWT_TTL_SECONDS', 3600),

  // Required in production; in dev/test falls back to the local compose DB so
  // unit tests and `npm run dev` work without a populated .env.
  databaseUrl: isProd
    ? required('DATABASE_URL')
    : process.env.DATABASE_URL ?? 'postgres://support:support@localhost:5432/support',
  pgPoolMax: int('PG_POOL_MAX', 20),

  smtp: {
    host: process.env.SMTP_HOST ?? 'localhost',
    port: int('SMTP_PORT', 1025),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
  },
  supportFromAddress: process.env.SUPPORT_FROM_ADDRESS ?? 'support@example.com',
  supportDomain: process.env.SUPPORT_DOMAIN ?? 'example.com',

  inboundWebhookSecret: process.env.INBOUND_WEBHOOK_SECRET ?? 'dev-inbound-secret',
  gdprRetentionDays: int('GDPR_RETENTION_DAYS', 730),
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000',

  slack: {
    botToken: process.env.SLACK_BOT_TOKEN ?? '',
    signingSecret: process.env.SLACK_SIGNING_SECRET ?? '',
    enabled: Boolean(process.env.SLACK_BOT_TOKEN),
  },
};

export type Config = typeof config;
