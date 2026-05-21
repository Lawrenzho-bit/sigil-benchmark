/**
 * Environment configuration. Parsed and validated once at startup so a
 * misconfigured deployment fails fast with a clear message rather than
 * surfacing as a confusing runtime error later.
 */
import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .string()
  .transform((v) => v.toLowerCase() === 'true' || v === '1')
  .pipe(z.boolean());

const csv = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_BASE_URL: z.string().url(),

  DATABASE_URL: z.string().min(1),

  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(480),

  BOOTSTRAP_SUPER_ADMINS: csv,
  ALLOW_JIT_PROVISIONING: bool.default('true' as unknown as boolean),

  IMPERSONATION_JWT_SECRET: z.string().min(16),
  IMPERSONATION_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),

  SAML_ENTRY_POINT: z.string().default(''),
  SAML_ISSUER: z.string().default('saas-admin-tool'),
  SAML_IDP_CERT: z.string().default(''),
  SAML_SP_PRIVATE_KEY: z.string().default(''),
  SAML_SP_CERT: z.string().default(''),

  OIDC_ISSUER: z.string().default(''),
  OIDC_AUTHORIZATION_URL: z.string().default(''),
  OIDC_TOKEN_URL: z.string().default(''),
  OIDC_USERINFO_URL: z.string().default(''),
  OIDC_CLIENT_ID: z.string().default(''),
  OIDC_CLIENT_SECRET: z.string().default(''),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    // eslint-disable-next-line no-console
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

const env = parsed.data;

export const config = {
  ...env,
  isProd: env.NODE_ENV === 'production',
  /** SAML is only usable when the IdP endpoint and signing cert are present. */
  samlEnabled: Boolean(env.SAML_ENTRY_POINT && env.SAML_IDP_CERT),
  /** OIDC is only usable when the full endpoint + client config is present. */
  oidcEnabled: Boolean(
    env.OIDC_AUTHORIZATION_URL &&
      env.OIDC_TOKEN_URL &&
      env.OIDC_CLIENT_ID &&
      env.OIDC_CLIENT_SECRET,
  ),
};

export type Config = typeof config;
