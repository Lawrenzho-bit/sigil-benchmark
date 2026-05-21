/**
 * Feature flag management. Flags have a global value plus optional per-org
 * overrides. Every change is audited with a before/after diff.
 */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { asyncHandler } from '../http/asyncHandler';
import { parseBody } from '../http/validate';
import { requirePermission } from '../rbac/middleware';
import { auditFromRequest } from '../audit/audit';
import { notFound, conflict } from '../errors';

export const flagsRouter = Router();

flagsRouter.get(
  '/',
  requirePermission('flags:read'),
  asyncHandler(async (_req, res) => {
    const flags = await prisma.featureFlag.findMany({
      orderBy: { key: 'asc' },
      include: {
        overrides: { include: { org: { select: { id: true, name: true, slug: true } } } },
      },
    });
    res.json({ items: flags });
  }),
);

const createSchema = z.object({
  key: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'Key must be lowercase kebab-case'),
  description: z.string().trim().max(500).default(''),
  globalEnabled: z.boolean().default(false),
});

flagsRouter.post(
  '/',
  requirePermission('flags:write'),
  asyncHandler(async (req, res) => {
    const input = parseBody(createSchema, req.body);
    const existing = await prisma.featureFlag.findUnique({ where: { key: input.key } });
    if (existing) throw conflict(`A flag with key "${input.key}" already exists`);

    const flag = await prisma.featureFlag.create({ data: input });
    await auditFromRequest(req, {
      action: 'flag.create',
      targetType: 'FeatureFlag',
      targetId: flag.id,
      targetLabel: flag.key,
      metadata: { globalEnabled: flag.globalEnabled },
    });
    res.status(201).json(flag);
  }),
);

const updateSchema = z
  .object({
    description: z.string().trim().max(500).optional(),
    globalEnabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields supplied' });

flagsRouter.patch(
  '/:id',
  requirePermission('flags:write'),
  asyncHandler(async (req, res) => {
    const input = parseBody(updateSchema, req.body);
    const before = await prisma.featureFlag.findUnique({ where: { id: req.params.id } });
    if (!before) throw notFound('Feature flag not found');

    const after = await prisma.featureFlag.update({ where: { id: before.id }, data: input });
    await auditFromRequest(req, {
      action: 'flag.update',
      targetType: 'FeatureFlag',
      targetId: after.id,
      targetLabel: after.key,
      diff: {
        ...(input.globalEnabled !== undefined && before.globalEnabled !== after.globalEnabled
          ? { globalEnabled: { before: before.globalEnabled, after: after.globalEnabled } }
          : {}),
        ...(input.description !== undefined && before.description !== after.description
          ? { description: { before: before.description, after: after.description } }
          : {}),
      },
    });
    res.json(after);
  }),
);

// --- Per-org overrides ---
const overrideSchema = z.object({ enabled: z.boolean() });

flagsRouter.put(
  '/:id/overrides/:orgId',
  requirePermission('flags:write'),
  asyncHandler(async (req, res) => {
    const input = parseBody(overrideSchema, req.body);
    const [flag, org] = await Promise.all([
      prisma.featureFlag.findUnique({ where: { id: req.params.id } }),
      prisma.organization.findUnique({ where: { id: req.params.orgId } }),
    ]);
    if (!flag) throw notFound('Feature flag not found');
    if (!org) throw notFound('Organization not found');

    const existing = await prisma.featureFlagOverride.findUnique({
      where: { flagId_orgId: { flagId: flag.id, orgId: org.id } },
    });
    const override = await prisma.featureFlagOverride.upsert({
      where: { flagId_orgId: { flagId: flag.id, orgId: org.id } },
      update: { enabled: input.enabled },
      create: { flagId: flag.id, orgId: org.id, enabled: input.enabled },
    });
    await auditFromRequest(req, {
      action: 'flag.override.set',
      targetType: 'FeatureFlag',
      targetId: flag.id,
      targetLabel: `${flag.key} @ ${org.name}`,
      diff: { enabled: { before: existing?.enabled ?? null, after: input.enabled } },
      metadata: { orgId: org.id },
    });
    res.json(override);
  }),
);

flagsRouter.delete(
  '/:id/overrides/:orgId',
  requirePermission('flags:write'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.featureFlagOverride.findUnique({
      where: { flagId_orgId: { flagId: req.params.id, orgId: req.params.orgId } },
      include: { flag: { select: { key: true } }, org: { select: { name: true } } },
    });
    if (!existing) throw notFound('Override not found');

    await prisma.featureFlagOverride.delete({ where: { id: existing.id } });
    await auditFromRequest(req, {
      action: 'flag.override.remove',
      targetType: 'FeatureFlag',
      targetId: req.params.id,
      targetLabel: `${existing.flag.key} @ ${existing.org.name}`,
      metadata: { orgId: req.params.orgId, previousValue: existing.enabled },
    });
    res.status(204).end();
  }),
);
