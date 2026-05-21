import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { config } from './config';
import { logger } from './logger';
import { errorHandler, notFoundHandler } from './middleware/error';
import authRouter from './routes/auth';
import ticketsRouter from './routes/tickets';
import inboxRouter from './routes/inbox';
import portalRouter from './routes/portal';
import kbRouter from './routes/kb';
import macrosRouter from './routes/macros';
import csatRouter from './routes/csat';
import reportingRouter from './routes/reporting';
import customersRouter from './routes/customers';
import adminRouter from './routes/admin';
import inboundWebhookRouter from './routes/inboundWebhook';
import slackRouter from './routes/slack';

/** Build the configured Express app (kept separate from `listen` for tests). */
export function createApp(): express.Express {
  const app = express();

  // Behind a load balancer / ingress — trust it for correct req.ip.
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(pinoHttp({ logger }));

  // --- CORS (customer portal + agent SPA on separate origins) ---
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin && config.corsOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    }
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // Slack mounts before the JSON parser — it needs the raw body for HMAC.
  app.use('/webhooks/slack', slackRouter);

  // Raw body for rfc822 inbound mail; JSON for everything else.
  app.use(express.raw({ type: 'message/rfc822', limit: '30mb' }));
  app.use(express.json({ limit: '30mb' }));

  // Liveness / readiness probe for the container orchestrator.
  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));

  // Throttle auth endpoints to blunt credential-stuffing.
  const authLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true });
  app.use('/auth', authLimiter, authRouter);

  // General API rate limit.
  app.use(rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true }));

  app.use('/webhooks', inboundWebhookRouter);
  app.use('/agent/tickets', ticketsRouter);
  app.use('/agent/inbox', inboxRouter);
  app.use('/agent/customers', customersRouter);
  app.use('/agent/macros', macrosRouter);
  app.use('/agent/reports', reportingRouter);
  app.use('/admin', adminRouter);
  app.use('/portal', portalRouter);
  app.use('/kb', kbRouter);
  app.use('/csat', csatRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
