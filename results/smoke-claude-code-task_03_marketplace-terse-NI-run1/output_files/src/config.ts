import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  APP_BASE_URL: z.string().url(),
  LOG_LEVEL: z.string().default("info"),

  DATABASE_URL: z.string(),
  REDIS_URL: z.string(),

  JWT_SECRET: z.string().min(16),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().default(900),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().default(60 * 60 * 24 * 30),
  COOKIE_DOMAIN: z.string().default("localhost"),
  COOKIE_SECURE: z
    .string()
    .default("false")
    .transform((s) => s === "true"),

  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().optional(),

  STRIPE_SECRET_KEY: z.string(),
  STRIPE_WEBHOOK_SECRET: z.string(),
  STRIPE_CONNECT_CLIENT_ID: z.string().optional(),
  STRIPE_PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(10000).default(1000),
  STRIPE_TAX_ENABLED: z
    .string()
    .default("true")
    .transform((s) => s === "true"),

  S3_ENDPOINT: z.string(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string(),
  S3_ACCESS_KEY_ID: z.string(),
  S3_SECRET_ACCESS_KEY: z.string(),
  S3_FORCE_PATH_STYLE: z
    .string()
    .default("true")
    .transform((s) => s === "true"),
  S3_PUBLIC_BASE_URL: z.string(),

  EMAIL_FROM: z.string().default("no-reply@marketplace.local"),
});

export type AppConfig = z.infer<typeof envSchema>;

export const config: AppConfig = envSchema.parse(process.env);
