function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(`Env var ${name} must be a number`);
  return n;
}

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: num('PORT', 3000),

  jwtSecret: req('JWT_SECRET'),
  jwtAccessTtlSeconds: num('JWT_ACCESS_TTL', 900),

  // Platform fee in basis points (1000 = 10%).
  platformFeeBps: num('PLATFORM_FEE_BPS', 1000),
  payoutDayOfWeek: num('PAYOUT_DAY_OF_WEEK', 1),

  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY ?? '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
  },

  s3: {
    endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket: process.env.S3_BUCKET ?? 'listing-photos',
    accessKey: process.env.S3_ACCESS_KEY ?? 'minioadmin',
    secretKey: process.env.S3_SECRET_KEY ?? 'minioadmin',
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
  },
};

export const isProd = config.env === 'production';
