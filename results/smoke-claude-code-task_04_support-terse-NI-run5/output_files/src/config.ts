/** Centralised, validated configuration. Throws at startup on missing/invalid env. */
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

const boolish = z
  .string()
  .transform((v) => v === 'true' || v === '1')
  .pipe(z.boolean());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 chars'),
  JWT_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  PORTAL_JWT_TTL_SECONDS: z.coerce.number().int().positive().default(86400),

  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  SMTP_SECURE: boolish.default('false'),
  EMAIL_DOMAIN: z.string().default('support.example.com'),
  EMAIL_FROM_NAME: z.string().default('Support'),
  INBOUND_ADDRESS_LOCALPART: z.string().default('support'),
  INBOUND_WEBHOOK_SECRET: z.string().min(8, 'INBOUND_WEBHOOK_SECRET must be at least 8 chars'),

  SLA_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(60000),
  EMAIL_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(15000),

  RETENTION_CLOSED_TICKET_DAYS: z.coerce.number().int().nonnegative().default(730),
  RETENTION_AUDIT_LOG_DAYS: z.coerce.number().int().nonnegative().default(2555),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Fail fast and loud — a misconfigured deployment should never start.
  console.error('Invalid configuration:\n' + JSON.stringify(parsed.error.flatten().fieldErrors, null, 2));
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;

export const isProd = config.NODE_ENV === 'production';
