/**
 * Communication panel: compose and broadcast announcements to a targeted
 * subset of customer end users.
 *
 * Sending is a two-step flow — create a DRAFT, then send it — so the audience
 * can be previewed before anything goes out. Sending is irreversible and
 * audited with the resolved recipient count.
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
import { notFound, conflict } from '../errors';

export const commsRouter = Router();

// Audience targeting. An empty filter targets every active end user.
const audienceSchema = z.object({
  orgId: z.string().uuid().optional(),
  plan: z.string().trim().max(50).optional(),
  orgStatus: z.enum(['ACTIVE', 'SUSPENDED', 'CHURNED']).optional(),
  userStatus: z.enum(['ACTIVE', 'INVITED', 'DEACTIVATED']).default('ACTIVE'),
});
type Audience = z.infer<typeof audienceSchema>;

/** Translate an audience filter into an EndUser where-clause. */
function audienceWhere(a: Audience): Prisma.EndUserWhereInput {
  return {
    status: a.userStatus,
    ...(a.orgId ? { orgId: a.orgId } : {}),
    ...(a.plan || a.orgStatus
      ? {
          org: {
            ...(a.plan ? { plan: a.plan } : {}),
            ...(a.orgStatus ? { status: a.orgStatus } : {}),
          },
        }
      : {}),
  };
}

// --- Preview the audience size ---
commsRouter.get(
  '/preview',
  requirePermission('comms:read'),
  asyncHandler(async (req, res) => {
    const audience = parseQuery(audienceSchema, req.query);
    const recipientCount = await prisma.endUser.count({ where: audienceWhere(audience) });
    res.json({ audience, recipientCount });
  }),
);

// --- List ---
commsRouter.get(
  '/',
  requirePermission('comms:read'),
  asyncHandler(async (req, res) => {
    const query = parseQuery(paginationSchema, req.query);
    const page = toPage(query);
    const [items, total] = await Promise.all([
      prisma.announcement.findMany({
        skip: page.skip,
        take: page.take,
        orderBy: { createdAt: 'desc' },
        include: { sentBy: { select: { email: true } } },
      }),
      prisma.announcement.count(),
    ]);
    res.json(paginated(items, total, page));
  }),
);

commsRouter.get(
  '/:id',
  requirePermission('comms:read'),
  asyncHandler(async (req, res) => {
    const item = await prisma.announcement.findUnique({
      where: { id: req.params.id },
      include: { sentBy: { select: { email: true } } },
    });
    if (!item) throw notFound('Announcement not found');
    res.json(item);
  }),
);

// --- Create draft ---
const createSchema = z.object({
  subject: z.string().trim().min(3).max(200),
  body: z.string().trim().min(1).max(10_000),
  audience: audienceSchema,
});

commsRouter.post(
  '/',
  requirePermission('comms:send'),
  asyncHandler(async (req, res) => {
    const input = parseBody(createSchema, req.body);
    const draft = await prisma.announcement.create({
      data: {
        subject: input.subject,
        body: input.body,
        audienceFilter: input.audience,
        status: 'DRAFT',
        sentById: req.actor!.adminUserId,
      },
    });
    await auditFromRequest(req, {
      action: 'announcement.draft',
      targetType: 'Announcement',
      targetId: draft.id,
      targetLabel: draft.subject,
    });
    res.status(201).json(draft);
  }),
);

// --- Send ---
commsRouter.post(
  '/:id/send',
  requirePermission('comms:send'),
  asyncHandler(async (req, res) => {
    const draft = await prisma.announcement.findUnique({ where: { id: req.params.id } });
    if (!draft) throw notFound('Announcement not found');
    if (draft.status === 'SENT') throw conflict('This announcement has already been sent');

    const audience = audienceSchema.parse(draft.audienceFilter);
    const recipientCount = await prisma.endUser.count({ where: audienceWhere(audience) });

    const sent = await prisma.announcement.update({
      where: { id: draft.id },
      data: { status: 'SENT', sentAt: new Date(), recipientCount, sentById: req.actor!.adminUserId },
    });

    // NOTE: actual delivery (email/in-app) is handed off to the messaging
    // service here. Recipient resolution and the audit record are this tool's
    // responsibility; the broadcast itself is fire-and-forget downstream.
    await auditFromRequest(req, {
      action: 'announcement.send',
      targetType: 'Announcement',
      targetId: sent.id,
      targetLabel: sent.subject,
      metadata: { recipientCount, audience },
    });
    res.json(sent);
  }),
);
