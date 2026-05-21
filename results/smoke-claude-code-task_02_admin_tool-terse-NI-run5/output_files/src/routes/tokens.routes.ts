/**
 * API token management: create scoped tokens, inspect usage, revoke.
 *
 * Key rules:
 *  - The plaintext secret is returned exactly once, at creation.
 *  - A token's scopes may never exceed its creator's role permissions; the
 *    request is rejected outright if it tries to.
 *  - Revocation is immediate and audited.
 */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { asyncHandler } from '../http/asyncHandler';
import { parseBody, parseQuery } from '../http/validate';
import { paginationSchema, toPage, paginated } from '../http/pagination';
import { requirePermission } from '../rbac/middleware';
import { auditFromRequest } from '../audit/audit';
import { generateToken } from '../auth/apiToken';
import { ALL_PERMISSIONS, isPermission, permissionsForRole } from '../rbac/permissions';
import { notFound, conflict, forbidden, badRequest } from '../errors';

export const tokensRouter = Router();

// Public (non-secret) projection of a token row.
const tokenView = {
  id: true,
  name: true,
  tokenPrefix: true,
  scopes: true,
  orgId: true,
  lastUsedAt: true,
  expiresAt: true,
  revokedAt: true,
  createdAt: true,
  createdBy: { select: { email: true } },
} as const;

tokensRouter.get(
  '/',
  requirePermission('tokens:read'),
  asyncHandler(async (req, res) => {
    const query = parseQuery(paginationSchema, req.query);
    const page = toPage(query);
    const [items, total] = await Promise.all([
      prisma.apiToken.findMany({
        skip: page.skip,
        take: page.take,
        orderBy: { createdAt: 'desc' },
        select: tokenView,
      }),
      prisma.apiToken.count(),
    ]);
    res.json(paginated(items, total, page));
  }),
);

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  scopes: z.array(z.string().trim()).min(1).max(ALL_PERMISSIONS.length),
  orgId: z.string().uuid().optional(),
  expiresAt: z.coerce.date().optional(),
});

tokensRouter.post(
  '/',
  requirePermission('tokens:write'),
  asyncHandler(async (req, res) => {
    const input = parseBody(createSchema, req.body);
    const actor = req.actor!;

    // Validate each scope: must be a real permission AND held by the creator.
    const grantable = permissionsForRole(actor.role);
    const invalid = input.scopes.filter((s) => !isPermission(s));
    if (invalid.length) throw badRequest(`Unknown permission scope(s): ${invalid.join(', ')}`);
    const exceeds = input.scopes.filter((s) => isPermission(s) && !grantable.has(s));
    if (exceeds.length) {
      throw forbidden(`You cannot grant scopes you do not hold: ${exceeds.join(', ')}`);
    }
    if (input.expiresAt && input.expiresAt.getTime() <= Date.now()) {
      throw badRequest('expiresAt must be in the future');
    }
    if (input.orgId) {
      const org = await prisma.organization.findUnique({ where: { id: input.orgId } });
      if (!org) throw notFound('Organization not found for orgId');
    }

    const secret = generateToken();
    const token = await prisma.apiToken.create({
      data: {
        name: input.name,
        tokenPrefix: secret.prefix,
        tokenHash: secret.hash,
        scopes: [...new Set(input.scopes)],
        createdById: actor.adminUserId,
        orgId: input.orgId,
        expiresAt: input.expiresAt,
      },
      select: tokenView,
    });

    await auditFromRequest(req, {
      action: 'token.create',
      targetType: 'ApiToken',
      targetId: token.id,
      targetLabel: token.name,
      metadata: { scopes: token.scopes, orgId: input.orgId ?? null },
    });

    // The one and only time the secret is exposed.
    res.status(201).json({ ...token, token: secret.plaintext });
  }),
);

tokensRouter.get(
  '/:id/usage',
  requirePermission('tokens:read'),
  asyncHandler(async (req, res) => {
    const query = parseQuery(paginationSchema, req.query);
    const page = toPage(query);
    const token = await prisma.apiToken.findUnique({ where: { id: req.params.id }, select: tokenView });
    if (!token) throw notFound('API token not found');

    const where = { tokenId: req.params.id };
    const [items, total, summary] = await Promise.all([
      prisma.apiTokenUsage.findMany({
        where,
        skip: page.skip,
        take: page.take,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.apiTokenUsage.count({ where }),
      prisma.apiTokenUsage.groupBy({ by: ['statusCode'], where, _count: true }),
    ]);
    res.json({
      token,
      summary: { totalCalls: total, byStatus: summary },
      ...paginated(items, total, page),
    });
  }),
);

tokensRouter.post(
  '/:id/revoke',
  requirePermission('tokens:write'),
  asyncHandler(async (req, res) => {
    const token = await prisma.apiToken.findUnique({ where: { id: req.params.id } });
    if (!token) throw notFound('API token not found');
    if (token.revokedAt) throw conflict('Token is already revoked');

    const revoked = await prisma.apiToken.update({
      where: { id: token.id },
      data: { revokedAt: new Date() },
      select: tokenView,
    });
    await auditFromRequest(req, {
      action: 'token.revoke',
      targetType: 'ApiToken',
      targetId: token.id,
      targetLabel: token.name,
    });
    res.json(revoked);
  }),
);
