/**
 * Authentication routes: SSO login/callback, dev-mode login, logout and the
 * `/auth/me` identity endpoint.
 */
import { Router } from 'express';
import { z } from 'zod';
import { passport } from '../auth/passport';
import { config } from '../config';
import { prisma } from '../db';
import { asyncHandler } from '../http/asyncHandler';
import { parseBody } from '../http/validate';
import { unauthorized } from '../errors';
import { provisionFromSso } from '../auth/provisioning';
import { permissionsForRole, ROLE_LABELS } from '../rbac/permissions';
import { auditFromRequest } from '../audit/audit';
import { AdminRole } from '@prisma/client';

export function buildAuthRouter(activeProviders: string[]): Router {
  const router = Router();

  // Which login methods the UI should offer.
  router.get('/providers', (_req, res) => {
    res.json({ providers: activeProviders, devMode: config.devModeActive });
  });

  // --- SAML ---
  if (activeProviders.includes('saml')) {
    router.get('/saml', passport.authenticate('saml'));
    router.post(
      '/saml/callback',
      passport.authenticate('saml', { failureRedirect: '/?error=saml_failed' }),
      (_req, res) => res.redirect('/'),
    );
  }

  // --- OIDC ---
  if (activeProviders.includes('oidc')) {
    router.get('/oidc', passport.authenticate('oidc'));
    router.get(
      '/oidc/callback',
      passport.authenticate('oidc', { failureRedirect: '/?error=oidc_failed' }),
      (_req, res) => res.redirect('/'),
    );
  }

  // --- Dev-mode login (non-production only) ---
  // Lets a developer assume any role locally without standing up an IdP.
  if (config.devModeActive) {
    const devSchema = z.object({
      email: z.string().email(),
      name: z.string().min(1).optional(),
      role: z.nativeEnum(AdminRole).optional(),
    });
    router.post(
      '/dev/login',
      asyncHandler(async (req, res, next) => {
        const input = parseBody(devSchema, req.body);
        const user = await provisionFromSso({
          provider: 'DEV',
          subject: `dev|${input.email}`,
          email: input.email,
          name: input.name ?? input.email,
        });
        // Dev convenience: allow assuming a specific role for testing RBAC.
        const finalUser =
          input.role && input.role !== user.role
            ? await prisma.adminUser.update({ where: { id: user.id }, data: { role: input.role } })
            : user;
        req.login(finalUser, (err) => {
          if (err) return next(err);
          res.json({ ok: true, role: finalUser.role });
        });
      }),
    );
  }

  // --- Identity ---
  router.get(
    '/me',
    asyncHandler(async (req, res) => {
      if (!req.actor) throw unauthorized();
      res.json({
        adminUserId: req.actor.adminUserId,
        email: req.actor.email,
        name: req.actor.name,
        role: req.actor.role,
        roleLabel: ROLE_LABELS[req.actor.role],
        authType: req.actor.type,
        permissions: [...req.actor.permissions].sort(),
      });
    }),
  );

  // --- Logout ---
  router.post(
    '/logout',
    asyncHandler(async (req, res, next) => {
      const wasAdmin = req.actor?.type === 'ADMIN_USER';
      if (wasAdmin) await auditFromRequest(req, { action: 'auth.logout' });
      req.logout((err) => {
        if (err) return next(err);
        req.session.destroy(() => {
          res.clearCookie('admin.sid');
          res.json({ ok: true });
        });
      });
    }),
  );

  // Permission catalog, useful for the token-creation UI.
  router.get('/permissions', (req, res, next) => {
    if (!req.actor) return next(unauthorized());
    res.json({ role: req.actor.role, granted: [...permissionsForRole(req.actor.role)].sort() });
  });

  return router;
}
