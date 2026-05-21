/**
 * Centralized, validated configuration. Reading process.env anywhere else in
 * the codebase is discouraged — import `config` from here instead.
 */
import 'dotenv/config';
import { z } from 'zod';

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? def : v.toLowerCase() === 'true'));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET must be at least 16 chars'),
  SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(480),

  SUPER_ADMIN_EMAILS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),

  SAML_ENABLED: bool(false),
  SAML_ENTRY_POINT: z.string().optional(),
  SAML_ISSUER: z.string().default('internal-admin-tool'),
  SAML_IDP_CERT: z.string().optional(),
  SAML_SP_PRIVATE_KEY: z.string().optional(),
  SAML_SP_CERT: z.string().optional(),

  OIDC_ENABLED: bool(false),
  OIDC_ISSUER_URL: z.string().optional(),
  OIDC_CLIENT_ID: z.string().optional(),
  OIDC_CLIENT_SECRET: z.string().optional(),
  OIDC_SCOPE: z.string().default('openid profile email'),

  AUTH_DEV_MODE: bool(false),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Fail fast and loud — never boot with broken config.
  console.error('Invalid configuration:\n' + JSON.stringify(parsed.error.flatten().fieldErrors, null, 2));
  process.exit(1);
}

const env = parsed.data;

// Dev mock login is only ever honored outside production.
const devModeActive = env.AUTH_DEV_MODE && env.NODE_ENV !== 'production';

if (env.NODE_ENV === 'production' && !env.SAML_ENABLED && !env.OIDC_ENABLED) {
  console.error('Refusing to start: production requires SAML or OIDC to be enabled (no local accounts).');
  process.exit(1);
}

if (env.NODE_ENV === 'production' && env.SESSION_SECRET.includes('change-me')) {
  console.error('Refusing to start: SESSION_SECRET still has its placeholder value.');
  process.exit(1);
}

export const config = {
  ...env,
  isProd: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  devModeActive,
  samlCallbackUrl: `${env.APP_BASE_URL}/auth/saml/callback`,
  oidcCallbackUrl: `${env.APP_BASE_URL}/auth/oidc/callback`,
};

export type AppConfig = typeof config;
