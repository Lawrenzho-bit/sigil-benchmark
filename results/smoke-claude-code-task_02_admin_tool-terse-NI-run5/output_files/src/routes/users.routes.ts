/**
 * Customer end-user management: search, view, edit, deactivate/reactivate and
 * impersonate. Every mutation is audited; impersonation is double-audited
 * (start and end) and requires a stated reason.
 */
import { Router } from 'express';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { asyncHandler } from '../http/asyncHandler';
import { parseBody, parseQuery } from '../http/validate';
import { paginationSchema, toPage, paginated } from '../http/pagination';
import { requirePermission } from '../rbac/middleware';
import { auditFromRequest } from '../audit/audit';
import { computeDiff, hasChanges } from '../audit/diff';
import { notFound } from '../errors';

export const usersRouter = Router();

/** Restrict a where-clause to the actor's org scope, if any (API tokens). */
function scopedWhere(req: { actor?: { orgScopeId?: string | null } }, where: Prisma.EndUserWhereInput) {
  const scope = req.actor?.orgScopeId;
  return scope ? { ...where, orgId: scope } : where;
}

// --- List / search ---
const listQuery = paginationSchema.extend({
  q: z.string().trim().max(200).optional(),
  status: z.enum(['ACTIVE', 'INVITED', 'DEACTIVATED']).optional(),
  orgId: z.string().uuid().optional(),
});

usersRouter.get(
  '/',
  requirePermission('users:read'),
  asyncHandler(async (req, res) => {
    const query = parseQuery(listQuery, req.query);
    const page = toPage(query);

    const where: Prisma.EndUserWhereInput = scopedWhere(req, {
      ...(query.status ? { status: query.status } : {}),
      ...(query.orgId ? { orgId: query.orgId } : {}),
      ...(query.q
        ? {
            OR: [
              { email: { contains: query.q, mode: 'insensitive' } },
              { name: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    });

    const [items, total] = await Promise.all([
      prisma.endUser.findMany({
        where,
        skip: page.skip,
        take: page.take,
        orderBy: { createdAt: 'desc' },
        include: { org: { select: { id: true, name: true, slug: true } } },
      }),
      prisma.endUser.count({ where }),
    ]);
    res.json(paginated(items, total, page));
  }),
);

// --- View one ---
usersRouter.get(
  '/:id',
  requirePermission('users:read'),
  asyncHandler(async (req, res) => {
    const user = await prisma.endUser.findFirst({
      where: scopedWhere(req, { id: req.params.id }),
      include: {
        org: { select: { id: true, name: true, slug: true, plan: true, status: true } },
        impersonations: { orderBy: { startedAt: 'desc' }, take: 10 },
      },
    });
    if (!user) throw notFound('End user not found');
    res.json(user);
  }),
);

// --- Edit ---
const editSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    orgRole: z.string().trim().min(1).max(50).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No editable fields supplied' });

usersRouter.patch(
  '/:id',
  requirePermission('users:write'),
  asyncHandler(async (req, res) => {
    const input = parseBody(editSchema, req.body);
    const before = await prisma.endUser.findFirst({ where: scopedWhere(req, { id: req.params.id }) });
    if (!before) throw notFound('End user not found');

    const after = await prisma.endUser.update({ where: { id: before.id }, data: input });
    const diff = computeDiff(before, after, Object.keys(input));
    if (hasChanges(diff)) {
      await auditFromRequest(req, {
        action: 'user.edit',
        targetType: 'EndUser',
        targetId: after.id,
        targetLabel: after.email,
        diff,
      });
    }
    res.json(after);
  }),
);

// --- Deactivate ---
usersRouter.post(
  '/:id/deactivate',
  requirePermission('users:deactivate'),
  asyncHandler(async (req, res) => {
    const before = await prisma.endUser.findFirst({ where: scopedWhere(req, { id: req.params.id }) });
    if (!before) throw notFound('End user not found');
    if (before.status === 'DEACTIVATED') return res.json(before);

    const after = await prisma.endUser.update({
      where: { id: before.id },
      data: { status: 'DEACTIVATED' },
    });
    await auditFromRequest(req, {
      action: 'user.deactivate',
      targetType: 'EndUser',
      targetId: after.id,
      targetLabel: after.email,
      diff: computeDiff(before, after, ['status']),
    });
    res.json(after);
  }),
);

// --- Reactivate ---
usersRouter.post(
  '/:id/reactivate',
  requirePermission('users:deactivate'),
  asyncHandler(async (req, res) => {
    const before = await prisma.endUser.findFirst({ where: scopedWhere(req, { id: req.params.id }) });
    if (!before) throw notFound('End user not found');

    const after = await prisma.endUser.update({ where: { id: before.id }, data: { status: 'ACTIVE' } });
    await auditFromRequest(req, {
      action: 'user.reactivate',
      targetType: 'EndUser',
      targetId: after.id,
      targetLabel: after.email,
      diff: computeDiff(before, after, ['status']),
    });
    res.json(after);
  }),
);

// --- Impersonate ---
// Records the impersonation, emits an audit entry, and returns a short-lived
// opaque token the customer-facing app would exchange for an impersonated
// session. A reason is mandatory and stored on the trail.
const impersonateSchema = z.object({ reason: z.string().trim().min(5).max(500) });

usersRouter.post(
  '/:id/impersonate',
  requirePermission('users:impersonate'),
  asyncHandler(async (req, res) => {
    const input = parseBody(impersonateSchema, req.body);
    const endUser = await prisma.endUser.findFirst({ where: scopedWhere(req, { id: req.params.id }) });
    if (!endUser) throw notFound('End user not found');

    const record = await prisma.impersonation.create({
      data: { adminId: req.actor!.adminUserId, endUserId: endUser.id, reason: input.reason },
    });
    await auditFromRequest(req, {
      action: 'user.impersonate.start',
      targetType: 'EndUser',
      targetId: endUser.id,
      targetLabel: endUser.email,
      metadata: { impersonationId: record.id, reason: input.reason },
    });

    res.status(201).json({
      impersonationId: record.id,
      endUser: { id: endUser.id, email: endUser.email },
      reason: input.reason,
      startedAt: record.startedAt,
      // Opaque, single-use handoff token. Not persisted server-side.
      impersonationToken: `imp_${randomBytes(24).toString('hex')}`,
      expiresInSeconds: 300,
    });
  }),
);

usersRouter.post(
  '/impersonations/:id/end',
  requirePermission('users:impersonate'),
  asyncHandler(async (req, res) => {
    const record = await prisma.impersonation.findUnique({
      where: { id: req.params.id },
      include: { endUser: true },
    });
    if (!record) throw notFound('Impersonation session not found');
    if (record.endedAt) return res.json(record);

    const ended = await prisma.impersonation.update({
      where: { id: record.id },
      data: { endedAt: new Date() },
    });
    await auditFromRequest(req, {
      action: 'user.impersonate.end',
      targetType: 'EndUser',
      targetId: record.endUserId,
      targetLabel: record.endUser.email,
      metadata: { impersonationId: record.id },
    });
    res.json(ended);
  }),
);
