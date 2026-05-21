/**
 * Admin user & role management — the controls for the RBAC system itself.
 *
 * Reading the admin roster needs `admins:read`; changing a role or active
 * state needs `admins:manage` (effectively SUPER_ADMIN only). Guard rails
 * prevent an operator from locking the organization out of its own tool.
 */
import { Router } from 'express';
import { z } from 'zod';
import { AdminRole } from '@prisma/client';
import { prisma } from '../db';
import { asyncHandler } from '../http/asyncHandler';
import { parseBody, parseQuery } from '../http/validate';
import { paginationSchema, toPage, paginated } from '../http/pagination';
import { requirePermission } from '../rbac/middleware';
import { auditFromRequest } from '../audit/audit';
import { computeDiff } from '../audit/diff';
import { notFound, badRequest, conflict } from '../errors';

export const adminsRouter = Router();

/** Guard: refuse to remove the final route back into the tool. */
async function assertNotLastSuperAdmin(adminId: string): Promise<void> {
  const remaining = await prisma.adminUser.count({
    where: { role: 'SUPER_ADMIN', isActive: true, id: { not: adminId } },
  });
  if (remaining === 0) {
    throw conflict('This is the last active Super Admin — promote another before changing this one');
  }
}

adminsRouter.get(
  '/',
  requirePermission('admins:read'),
  asyncHandler(async (req, res) => {
    const query = parseQuery(paginationSchema.extend({ q: z.string().trim().max(200).optional() }), req.query);
    const page = toPage(query);
    const where = query.q
      ? {
          OR: [
            { email: { contains: query.q, mode: 'insensitive' as const } },
            { name: { contains: query.q, mode: 'insensitive' as const } },
          ],
        }
      : {};
    const [items, total] = await Promise.all([
      prisma.adminUser.findMany({
        where,
        skip: page.skip,
        take: page.take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          ssoProvider: true,
          lastLoginAt: true,
          createdAt: true,
        },
      }),
      prisma.adminUser.count({ where }),
    ]);
    res.json(paginated(items, total, page));
  }),
);

const roleSchema = z.object({ role: z.nativeEnum(AdminRole) });

adminsRouter.patch(
  '/:id/role',
  requirePermission('admins:manage'),
  asyncHandler(async (req, res) => {
    const input = parseBody(roleSchema, req.body);
    const before = await prisma.adminUser.findUnique({ where: { id: req.params.id } });
    if (!before) throw notFound('Admin user not found');
    if (before.role === input.role) return res.json(before);

    // Demoting the last Super Admin would orphan the tool.
    if (before.role === 'SUPER_ADMIN' && input.role !== 'SUPER_ADMIN') {
      await assertNotLastSuperAdmin(before.id);
    }

    const after = await prisma.adminUser.update({ where: { id: before.id }, data: { role: input.role } });
    await auditFromRequest(req, {
      action: 'admin.role.change',
      targetType: 'AdminUser',
      targetId: after.id,
      targetLabel: after.email,
      diff: computeDiff(before, after, ['role']),
    });
    res.json(after);
  }),
);

adminsRouter.post(
  '/:id/deactivate',
  requirePermission('admins:manage'),
  asyncHandler(async (req, res) => {
    const target = await prisma.adminUser.findUnique({ where: { id: req.params.id } });
    if (!target) throw notFound('Admin user not found');
    if (target.id === req.actor!.adminUserId) throw badRequest('You cannot deactivate your own account');
    if (!target.isActive) return res.json(target);
    if (target.role === 'SUPER_ADMIN') await assertNotLastSuperAdmin(target.id);

    const after = await prisma.adminUser.update({ where: { id: target.id }, data: { isActive: false } });
    await auditFromRequest(req, {
      action: 'admin.deactivate',
      targetType: 'AdminUser',
      targetId: after.id,
      targetLabel: after.email,
    });
    res.json(after);
  }),
);

adminsRouter.post(
  '/:id/reactivate',
  requirePermission('admins:manage'),
  asyncHandler(async (req, res) => {
    const target = await prisma.adminUser.findUnique({ where: { id: req.params.id } });
    if (!target) throw notFound('Admin user not found');
    if (target.isActive) return res.json(target);

    const after = await prisma.adminUser.update({ where: { id: target.id }, data: { isActive: true } });
    await auditFromRequest(req, {
      action: 'admin.reactivate',
      targetType: 'AdminUser',
      targetId: after.id,
      targetLabel: after.email,
    });
    res.json(after);
  }),
);
