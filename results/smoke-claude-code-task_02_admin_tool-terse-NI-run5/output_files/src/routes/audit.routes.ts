/**
 * Audit log viewer. Read-only by design — there is no endpoint to mutate or
 * delete audit entries anywhere in this application.
 */
import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { asyncHandler } from '../http/asyncHandler';
import { parseQuery } from '../http/validate';
import { paginationSchema, toPage, paginated } from '../http/pagination';
import { requirePermission } from '../rbac/middleware';
import { notFound } from '../errors';

export const auditRouter = Router();

const listQuery = paginationSchema.extend({
  action: z.string().trim().max(100).optional(),
  actorEmail: z.string().trim().max(200).optional(),
  targetType: z.string().trim().max(100).optional(),
  targetId: z.string().trim().max(100).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

auditRouter.get(
  '/',
  requirePermission('audit:read'),
  asyncHandler(async (req, res) => {
    const query = parseQuery(listQuery, req.query);
    const page = toPage(query);

    const where: Prisma.AuditLogWhereInput = {
      ...(query.action ? { action: { contains: query.action, mode: 'insensitive' } } : {}),
      ...(query.actorEmail ? { actorEmail: { contains: query.actorEmail, mode: 'insensitive' } } : {}),
      ...(query.targetType ? { targetType: query.targetType } : {}),
      ...(query.targetId ? { targetId: query.targetId } : {}),
      ...(query.from || query.to
        ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip: page.skip,
        take: page.take,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.auditLog.count({ where }),
    ]);
    res.json(paginated(items, total, page));
  }),
);

// Distinct action names, to populate the filter dropdown in the UI.
auditRouter.get(
  '/actions',
  requirePermission('audit:read'),
  asyncHandler(async (_req, res) => {
    const rows = await prisma.auditLog.findMany({
      distinct: ['action'],
      select: { action: true },
      orderBy: { action: 'asc' },
    });
    res.json({ actions: rows.map((r) => r.action) });
  }),
);

auditRouter.get(
  '/:id',
  requirePermission('audit:read'),
  asyncHandler(async (req, res) => {
    const entry = await prisma.auditLog.findUnique({ where: { id: req.params.id } });
    if (!entry) throw notFound('Audit entry not found');
    res.json(entry);
  }),
);
