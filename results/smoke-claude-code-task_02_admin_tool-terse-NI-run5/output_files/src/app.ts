/**
 * Express application assembly: security middleware, sessions, authentication,
 * routing, the static admin UI, and terminal error handling.
 */
import path from 'node:path';
import express, { type Express } from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { config } from './config';
import { logger } from './logger';
import { passport, registerStrategies } from './auth/passport';
import { attachActor } from './auth/actor';
import { buildRouter } from './routes';
import { notFoundHandler, errorHandler } from './http/errorHandler';
import { forbidden } from './errors';
import { recordRequest } from './metrics';
import { prisma } from './db';

export async function createApp(): Promise<Express> {
  const app = express();
  const activeProviders = await registerStrategies();

  // Behind a reverse proxy / load balancer in production.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      hsts: config.isProd,
    }),
  );

  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/healthz' } }));
  app.use(express.json({ limit: '6mb' })); // headroom for CSV import payloads
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());

  // Tally every response for the health dashboard's error-rate metric.
  app.use((req, res, next) => {
    res.on('finish', () => recordRequest(res.statusCode));
    next();
  });

  // --- Sessions ---
  const PgStore = connectPgSimple(session);
  app.use(
    session({
      name: 'admin.sid',
      store: new PgStore({
        conObject: { connectionString: config.DATABASE_URL },
        tableName: 'session',
        createTableIfMissing: false, // table is owned by the Prisma schema
        pruneSessionInterval: 60 * 15,
      }),
      secret: config.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      rolling: true, // refresh idle timeout on activity
      cookie: {
        httpOnly: true,
        sameSite: 'lax', // also our first line of CSRF defense
        secure: config.isProd,
        maxAge: config.SESSION_TTL_MINUTES * 60 * 1000,
      },
    }),
  );

  app.use(passport.initialize());
  app.use(passport.session());

  // Resolve the principal (session user or bearer token) onto req.actor.
  app.use(attachActor);

  // --- CSRF defense for cookie-authenticated mutations ---
  // Bearer-token requests carry no ambient cookie, so they are exempt. For
  // session requests we require the Origin/Referer to match this app's URL.
  app.use((req, _res, next) => {
    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const isSessionAuth = req.actor?.type === 'ADMIN_USER';
    if (!mutating || !isSessionAuth) return next();
    const origin = req.get('origin') ?? req.get('referer') ?? '';
    if (origin && origin.startsWith(config.APP_BASE_URL)) return next();
    return next(forbidden('Cross-origin request rejected (CSRF protection)'));
  });

  // --- Rate limiting ---
  const authLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });
  const apiLimiter = rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false });
  app.use('/auth', authLimiter);
  app.use('/api', apiLimiter);

  // --- Liveness probe (unauthenticated, no DB dependency) ---
  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
  // Readiness probe — confirms the database is reachable.
  app.get('/readyz', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'not-ready' });
    }
  });

  // --- API ---
  app.use(buildRouter(activeProviders));

  // --- Static admin UI ---
  const publicDir = path.resolve(process.cwd(), 'public');
  app.use(express.static(publicDir));
  // SPA fallback for non-API GET routes.
  app.get(/^\/(?!api|auth|healthz|readyz).*/, (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
