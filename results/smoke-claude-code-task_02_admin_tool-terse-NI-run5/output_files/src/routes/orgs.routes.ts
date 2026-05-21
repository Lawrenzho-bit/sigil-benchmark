/**
 * Customer organization browser: filter, search, view details and edit.
 */
import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { asyncHandler } from '../http/asyncHandler';
import { parseBody, parseQuery } from '../http/validate';
import { paginationSchema, toPage, paginated } from '../http/pagination';
import { requirePermission } from '../rbac/middleware';
import { auditFromRequest } from '../audit/audit';
import { computeDiff, hasChanges } from '../audit/diff';
import { notFound, forbidden } from '../errors';

export const orgsRouter = Router();

/** Reject access to an org outside the actor's org scope (API tokens). */
function assertOrgInScope(req: { actor?: { orgScopeId?: string | null } }, orgId: string): void {
  const scope = req.actor?.orgScopeId;
  if (scope && scope !== orgId) throw forbidden('This token is scoped to a different organization');
}

const listQuery = paginationSchema.extend({
  q: z.string().trim().max(200).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'CHURNED']).optional(),
  plan: z.string().trim().max(50).optional(),
  region: z.string().trim().max(50).optional(),
});

orgsRouter.get(
  '/',
  requirePermission('orgs:read'),
  asyncHandler(async (req, res) => {
    const query = parseQuery(listQuery, req.query);
    const page = toPage(query);

    const where: Prisma.OrganizationWhereInput = {
      ...(req.actor?.orgScopeId ? { id: req.actor.orgScopeId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.plan ? { plan: query.plan } : {}),
      ...(query.region ? { region: query.region } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { slug: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.organization.findMany({
        where,
        skip: page.skip,
        take: page.take,
        orderBy: { name: 'asc' },
        include: { _count: { select: { endUsers: true } } },
      }),
      prisma.organization.count({ where }),
    ]);
    res.json(paginated(items, total, page));
  }),
);

orgsRouter.get(
  '/:id',
  requirePermission('orgs:read'),
  asyncHandler(async (req, res) => {
    assertOrgInScope(req, req.params.id);
    const org = await prisma.organization.findUnique({
      where: { id: req.params.id },
      include: {
        _count: { select: { endUsers: true, apiTokens: true } },
        flagOverrides: { include: { flag: { select: { key: true } } } },
      },
    });
    if (!org) throw notFound('Organization not found');

    const activeUsers = await prisma.endUser.count({
      where: { orgId: org.id, status: 'ACTIVE' },
    });
    res.json({ ...org, activeUsers });
  }),
);

orgsRouter.get(
  '/:id/users',
  requirePermission('orgs:read', 'users:read'),
  asyncHandler(async (req, res) => {
    assertOrgInScope(req, req.params.id);
    const query = parseQuery(paginationSchema, req.query);
    const page = toPage(query);
    const where = { orgId: req.params.id };
    const [items, total] = await Promise.all([
      prisma.endUser.findMany({ where, skip: page.skip, take: page.take, orderBy: { name: 'asc' } }),
      prisma.endUser.count({ where }),
    ]);
    res.json(paginated(items, total, page));
  }),
);

const editSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    plan: z.string().trim().min(1).max(50).optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED', 'CHURNED']).optional(),
    region: z.string().trim().min(1).max(50).optional(),
    seats: z.number().int().min(0).max(100000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No editable fields supplied' });

orgsRouter.patch(
  '/:id',
  requirePermission('orgs:write'),
  asyncHandler(async (req, res) => {
    assertOrgInScope(req, req.params.id);
    const input = parseBody(editSchema, req.body);
    const before = await prisma.organization.findUnique({ where: { id: req.params.id } });
    if (!before) throw notFound('Organization not found');

    const after = await prisma.organization.update({ where: { id: before.id }, data: input });
    const diff = computeDiff(before, after, Object.keys(input));
    if (hasChanges(diff)) {
      await auditFromRequest(req, {
        action: 'org.edit',
        targetType: 'Organization',
        targetId: after.id,
        targetLabel: after.name,
        diff,
      });
    }
    res.json(after);
  }),
);
