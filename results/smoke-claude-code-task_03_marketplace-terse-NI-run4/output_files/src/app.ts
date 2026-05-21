// Fastify app assembly: plugins, error handling, route registration.
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { config, isProd } from './config.js';
import { AppError } from './lib/errors.js';
import { authRoutes } from './routes/auth.js';
import { sellerRoutes } from './routes/sellers.js';
import { listingRoutes } from './routes/listings.js';
import { searchRoutes } from './routes/search.js';
import { cartRoutes } from './routes/cart.js';
import { checkoutRoutes } from './routes/checkout.js';
import { orderRoutes } from './routes/orders.js';
import { reviewRoutes } from './routes/reviews.js';
import { messageRoutes } from './routes/messages.js';
import { disputeRoutes } from './routes/disputes.js';
import { payoutRoutes } from './routes/payouts.js';
import { webhookRoutes } from './routes/webhooks.js';
import { adminRoutes } from './routes/admin.js';
import { privacyRoutes } from './routes/privacy.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: isProd ? 'info' : 'debug' },
    // Trust the proxy so req.ip reflects the real client behind a load balancer.
    trustProxy: true,
    bodyLimit: 1_048_576, // 1 MiB; photo bytes go straight to S3, not through us
  });

  await app.register(helmet);
  await app.register(cors, { origin: true, credentials: true });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

  // Stripe webhook signature verification needs the *raw* body. Capture it for
  // that one content type without disturbing normal JSON parsing.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req, body, done) => {
      (req as { rawBody?: Buffer }).rawBody = body as Buffer;
      try {
        done(null, body.length ? JSON.parse(body.toString('utf8')) : {});
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  // Uniform error envelope: { error: { code, message } }.
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: { code: 'validation_error', message: 'Invalid request', issues: err.issues },
      });
    }
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({
        error: { code: err.code, message: err.message },
      });
    }
    if (err.statusCode === 429) {
      return reply.code(429).send({
        error: { code: 'rate_limited', message: 'Too many requests' },
      });
    }
    app.log.error(err);
    return reply.code(500).send({
      error: { code: 'internal_error', message: 'Something went wrong' },
    });
  });

  app.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));

  // Feature routes.
  await app.register(authRoutes);
  await app.register(sellerRoutes);
  await app.register(listingRoutes);
  await app.register(searchRoutes);
  await app.register(cartRoutes);
  await app.register(checkoutRoutes);
  await app.register(orderRoutes);
  await app.register(reviewRoutes);
  await app.register(messageRoutes);
  await app.register(disputeRoutes);
  await app.register(payoutRoutes);
  await app.register(webhookRoutes);
  await app.register(adminRoutes);
  await app.register(privacyRoutes);

  void config; // referenced indirectly by route modules
  return app;
}
