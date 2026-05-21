/**
 * Assembles the application's HTTP API.
 *
 *   /auth/*  — authentication (mixed public + authenticated endpoints)
 *   /api/*   — everything else; requires an authenticated actor, then each
 *              route additionally enforces its own fine-grained permission.
 */
import { Router } from 'express';
import { requireAuth } from '../rbac/middleware';
import { buildAuthRouter } from './auth.routes';
import { usersRouter } from './users.routes';
import { orgsRouter } from './orgs.routes';
import { auditRouter } from './audit.routes';
import { bulkRouter } from './bulk.routes';
import { healthRouter } from './health.routes';
import { flagsRouter } from './flags.routes';
import { commsRouter } from './comms.routes';
import { tokensRouter } from './tokens.routes';
import { adminsRouter } from './admins.routes';

export function buildRouter(activeProviders: string[]): Router {
  const router = Router();

  router.use('/auth', buildAuthRouter(activeProviders));

  const api = Router();
  // Single chokepoint: no /api route is reachable without authentication.
  api.use(requireAuth);
  api.use('/users', usersRouter);
  api.use('/orgs', orgsRouter);
  api.use('/audit', auditRouter);
  api.use('/bulk', bulkRouter);
  api.use('/health', healthRouter);
  api.use('/flags', flagsRouter);
  api.use('/announcements', commsRouter);
  api.use('/tokens', tokensRouter);
  api.use('/admins', adminsRouter);
  router.use('/api', api);

  return router;
}
