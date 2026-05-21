/**
 * Centralized, validated configuration. Importing this module reads process.env
 * once and fails fast (throws) if a required value is missing in production.
 */
import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    return fallback ?? '';
  }
  return v;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',
  port: int('PORT', 3000),
  logLevel: process.env.LOG_LEVEL ?? 'info',

  databaseUrl: required('DATABASE_URL', 'postgres://support:support@localhost:5432/support'),

  jwt: {
    agentSecret: required('JWT_SECRET', 'dev-only-change-me-agent-secret'),
    customerSecret: required('JWT_CUSTOMER_SECRET', 'dev-only-change-me-customer-secret'),
    expiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
  },

  mail: {
    smtpHost: process.env.SMTP_HOST ?? '',
    smtpPort: int('SMTP_PORT', 587),
    smtpUser: process.env.SMTP_USER ?? '',
    smtpPass: process.env.SMTP_PASS ?? '',
    smtpSecure: process.env.SMTP_SECURE === 'true',
    from: process.env.MAIL_FROM ?? 'Support <support@example.com>',
    inboundDomain: process.env.SUPPORT_INBOUND_DOMAIN ?? 'example.com',
    inboundLocalpart: process.env.SUPPORT_INBOUND_LOCALPART ?? 'support',
  },

  inboundWebhookSecret: required('INBOUND_WEBHOOK_SECRET', 'dev-only-change-me-inbound-secret'),

  slaScanIntervalMs: int('SLA_SCAN_INTERVAL_MS', 60_000),

  slack: {
    botToken: process.env.SLACK_BOT_TOKEN ?? '',
    defaultChannel: process.env.SLACK_DEFAULT_CHANNEL ?? '',
  },

  retention: {
    closedTicketDays: int('RETENTION_CLOSED_TICKET_DAYS', 0),
  },
} as const;

export type Config = typeof config;
