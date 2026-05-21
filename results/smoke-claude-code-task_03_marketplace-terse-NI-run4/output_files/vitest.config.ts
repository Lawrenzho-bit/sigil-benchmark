import { defineConfig } from 'vitest/config';

// Minimal env so the strict config validator in src/config.ts passes when a
// unit test imports a module that transitively imports config.
export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      JWT_SECRET: 'test-secret-test-secret-test-secret-32',
      STRIPE_SECRET_KEY: 'sk_test_dummy',
      STRIPE_WEBHOOK_SECRET: 'whsec_dummy',
      S3_ENDPOINT: 'http://localhost:9000',
      S3_BUCKET: 'test',
      S3_ACCESS_KEY_ID: 'test',
      S3_SECRET_ACCESS_KEY: 'test',
      S3_PUBLIC_BASE_URL: 'http://localhost:9000/test',
    },
  },
});
