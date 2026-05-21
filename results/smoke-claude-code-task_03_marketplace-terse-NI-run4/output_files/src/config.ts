// Centralised, validated configuration. Fails fast at boot if anything
// required is missing rather than surfacing as a confusing runtime error.
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:8080'),

  DATABASE_URL: z.string().min(1),

  JWT_SECRET: z.string().min(32),
  JWT_SECRET_PREVIOUS: z.string().optional(),
  ACCESS_TOKEN_TTL: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL: z.coerce.number().int().positive().default(2_592_000),

  OAUTH_GOOGLE_CLIENT_ID: z.string().optional(),
  OAUTH_GOOGLE_CLIENT_SECRET: z.string().optional(),
  OAUTH_GOOGLE_REDIRECT_URI: z.string().optional(),

  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  STRIPE_CONNECT_CLIENT_ID: z.string().optional(),
  PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(10_000).default(1000),

  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
  S3_PUBLIC_BASE_URL: z.string().url(),

  KYC_PROVIDER: z.enum(['stripe_identity', 'mock']).default('stripe_identity'),
  TAX_PROVIDER: z.enum(['internal', 'stripe_tax']).default('internal'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error(
    'Invalid configuration:\n',
    JSON.stringify(parsed.error.flatten().fieldErrors, null, 2),
  );
  process.exit(1);
}

export const config = parsed.data;
export const isProd = config.NODE_ENV === 'production';
