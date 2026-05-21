import * as Joi from 'joi';

/**
 * Fail-fast validation of environment configuration at boot. Anything required
 * for a safe production start is `required()`; integrations that can run in a
 * degraded/dev mode are optional with defaults.
 */
export const configValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().default(3000),
  APP_URL: Joi.string().uri().required(),

  DATABASE_URL: Joi.string().required(),
  REDIS_URL: Joi.string().required(),

  JWT_ACCESS_SECRET: Joi.string().min(16).required(),
  JWT_REFRESH_SECRET: Joi.string().min(16).required(),
  JWT_ACCESS_TTL: Joi.number().default(900),
  JWT_REFRESH_TTL: Joi.number().default(2_592_000),

  GOOGLE_CLIENT_ID: Joi.string().allow('').optional(),
  GOOGLE_CLIENT_SECRET: Joi.string().allow('').optional(),
  GOOGLE_CALLBACK_URL: Joi.string().uri().optional(),

  STRIPE_SECRET_KEY: Joi.string().allow('').optional(),
  STRIPE_WEBHOOK_SECRET: Joi.string().allow('').optional(),
  STRIPE_CONNECT_WEBHOOK_SECRET: Joi.string().allow('').optional(),
  PLATFORM_FEE_BPS: Joi.number().min(0).max(10_000).default(1000),
  PAYOUT_DAY_OF_WEEK: Joi.number().min(0).max(6).default(1),

  S3_ENDPOINT: Joi.string().uri().required(),
  S3_REGION: Joi.string().default('us-east-1'),
  S3_BUCKET: Joi.string().required(),
  S3_ACCESS_KEY_ID: Joi.string().required(),
  S3_SECRET_ACCESS_KEY: Joi.string().required(),
  S3_FORCE_PATH_STYLE: Joi.boolean().default(true),
  S3_PUBLIC_URL: Joi.string().uri().required(),

  KYC_PROVIDER: Joi.string().default('stripe'),
  STRIPE_TAX_ENABLED: Joi.boolean().default(true),
  PLATFORM_TAX_COUNTRY: Joi.string().length(2).default('IE'),
});
