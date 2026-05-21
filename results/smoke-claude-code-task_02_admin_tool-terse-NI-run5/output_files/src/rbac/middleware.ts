/**
 * Authorization enforcement middleware. `attachActor` must run earlier in the
 * chain so `req.actor` is populated before these checks.
 */
import { RequestHandler } from 'express';
import { AdminRole } from '@prisma/client';
import { unauthorized, forbidden } from '../errors';
import { logger } from '../logger';
import type { Permission } from './permissions';

/** Reject anonymous requests. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.actor) return next(unauthorized());
  next();
};

/**
 * Require ALL of the given permissions. Denials are logged so attempted
 * privilege escalation is itself visible in the operational logs.
 */
export function requirePermission(...needed: Permission[]): RequestHandler {
  return (req, _res, next) => {
    const actor = req.actor;
    if (!actor) return next(unauthorized());

    const missing = needed.filter((p) => !actor.permissions.has(p));
    if (missing.length > 0) {
      logger.warn(
        { email: actor.email, role: actor.role, needed, missing, path: req.originalUrl },
        'authorization denied',
      );
      return next(forbidden(`Missing required permission: ${missing.join(', ')}`));
    }
    next();
  };
}

/** Require ANY one of the given permissions. */
export function requireAnyPermission(...options: Permission[]): RequestHandler {
  return (req, _res, next) => {
    const actor = req.actor;
    if (!actor) return next(unauthorized());
    if (options.some((p) => actor.permissions.has(p))) return next();
    logger.warn(
      { email: actor.email, role: actor.role, options, path: req.originalUrl },
      'authorization denied',
    );
    next(forbidden(`Requires one of: ${options.join(', ')}`));
  };
}

/** Restrict a route to specific admin roles regardless of permission set. */
export function requireRole(...roles: AdminRole[]): RequestHandler {
  return (req, _res, next) => {
    const actor = req.actor;
    if (!actor) return next(unauthorized());
    if (!roles.includes(actor.role)) {
      logger.warn({ email: actor.email, role: actor.role, roles }, 'role check denied');
      return next(forbidden('Your role cannot access this resource'));
    }
    next();
  };
}
