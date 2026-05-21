// Admin panel API: moderation, fraud review, and dispute resolution.
//
// DSA notes: listing removals must carry a "statement of reasons" (Art. 17),
// and every privileged action is written to the append-only AdminAction log
// for transparency reporting.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';
import { BadRequest, NotFound } from '../lib/errors.js';
import { paginationQuery, buildPage } from '../lib/pagination.js';
import { refundPayment } from '../lib/stripe.js';

/** Records a privileged action for the audit trail. */
async function audit(
  adminId: string,
  action: string,
  targetType: string,
  targetId: string,
  note?: string,
) {
  await prisma.adminAction.create({
    data: { adminId, action, targetType, targetId, note },
  });
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  // --- Moderation queue (DSA notice-and-action) ----------------------------
  app.get('/api/admin/flags', async (req) => {
    const auth = await requireAdmin(req);
    const q = paginationQuery
      .extend({ status: z.enum(['OPEN', 'REVIEWING', 'ACTIONED', 'DISMISSED']).optional() })
      .parse(req.query);
    const rows = await prisma.moderationFlag.findMany({
      where: q.status ? { status: q.status } : { status: 'OPEN' },
      orderBy: { createdAt: 'asc' },
      take: q.limit + 1,
      ...(q.cursor && { cursor: { id: q.cursor }, skip: 1 }),
      include: { listing: { select: { id: true, title: true, sellerId: true } } },
    });
    void auth;
    return buildPage(rows, q.limit);
  });

  // Anyone can file a flag (DSA Art. 16); no admin auth required to report.
  app.post('/api/listings/:id/flag', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z
      .object({
        reason: z.string().min(3).max(200),
        detail: z.string().max(4000).optional(),
        reporterId: z.string().optional(),
      })
      .parse(req.body);
    const listing = await prisma.listing.findUnique({ where: { id } });
    if (!listing) throw NotFound('Listing not found');
    const flag = await prisma.moderationFlag.create({
      data: { listingId: id, ...body },
    });
    return reply.code(201).send({ flagId: flag.id });
  });

  // Resolve a flag: remove the listing (with statement of reasons) or dismiss.
  app.post('/api/admin/flags/:flagId/resolve', async (req) => {
    const auth = await requireAdmin(req);
    const { flagId } = z.object({ flagId: z.string() }).parse(req.params);
    const body = z
      .object({
        action: z.enum(['remove_listing', 'dismiss']),
        statementOfReasons: z.string().max(4000).optional(),
      })
      .parse(req.body);

    const flag = await prisma.moderationFlag.findUnique({ where: { id: flagId } });
    if (!flag) throw NotFound('Flag not found');

    if (body.action === 'remove_listing') {
      if (!body.statementOfReasons) {
        throw BadRequest('A statement of reasons is required to remove a listing', 'dsa_sor_required');
      }
      await prisma.$transaction([
        prisma.listing.update({ where: { id: flag.listingId }, data: { status: 'REMOVED' } }),
        prisma.moderationFlag.update({
          where: { id: flagId },
          data: {
            status: 'ACTIONED',
            statementOfReasons: body.statementOfReasons,
            resolvedAt: new Date(),
          },
        }),
      ]);
      await audit(auth.userId, 'remove_listing', 'Listing', flag.listingId, body.statementOfReasons);
    } else {
      await prisma.moderationFlag.update({
        where: { id: flagId },
        data: { status: 'DISMISSED', resolvedAt: new Date() },
      });
      await audit(auth.userId, 'dismiss_flag', 'ModerationFlag', flagId);
    }
    return { ok: true };
  });

  // --- Fraud review --------------------------------------------------------
  app.post('/api/admin/sellers/:sellerId/suspend', async (req) => {
    const auth = await requireAdmin(req);
    const { sellerId } = z.object({ sellerId: z.string() }).parse(req.params);
    const { note } = z.object({ note: z.string().max(2000) }).parse(req.body);
    const profile = await prisma.sellerProfile.findUnique({ where: { id: sellerId } });
    if (!profile) throw NotFound('Seller not found');

    await prisma.$transaction([
      prisma.sellerProfile.update({
        where: { id: sellerId },
        data: { status: 'SUSPENDED', payoutsEnabled: false },
      }),
      // Hide the seller's listings while suspended.
      prisma.listing.updateMany({
        where: { sellerId: profile.userId, status: 'ACTIVE' },
        data: { status: 'PAUSED' },
      }),
    ]);
    await audit(auth.userId, 'suspend_seller', 'SellerProfile', sellerId, note);
    return { ok: true };
  });

  // --- Dispute resolution --------------------------------------------------
  app.get('/api/admin/disputes', async (req) => {
    await requireAdmin(req);
    const q = paginationQuery.parse(req.query);
    const rows = await prisma.dispute.findMany({
      where: { status: 'ESCALATED' },
      orderBy: { updatedAt: 'asc' },
      take: q.limit + 1,
      ...(q.cursor && { cursor: { id: q.cursor }, skip: 1 }),
      include: { order: true },
    });
    return buildPage(rows, q.limit);
  });

  app.post('/api/admin/disputes/:id/resolve', async (req) => {
    const auth = await requireAdmin(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z
      .object({
        outcome: z.enum(['refund_buyer', 'release_seller']),
        note: z.string().max(4000),
        // Partial refunds supported; defaults to the full order total.
        refundAmount: z.number().int().positive().optional(),
      })
      .parse(req.body);

    const dispute = await prisma.dispute.findUnique({
      where: { id },
      include: { order: { include: { payment: true } } },
    });
    if (!dispute) throw NotFound('Dispute not found');

    if (body.outcome === 'refund_buyer') {
      const payment = dispute.order.payment;
      if (!payment?.stripeChargeId) throw BadRequest('Order has no captured charge');
      const amount = body.refundAmount ?? dispute.order.totalAmount;
      await refundPayment(payment.stripeChargeId, amount);
      await prisma.$transaction([
        prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: amount >= payment.amount ? 'REFUNDED' : 'SUCCEEDED',
            refundedAmount: { increment: amount },
          },
        }),
        prisma.order.update({
          where: { id: dispute.orderId },
          data: { status: 'REFUNDED' },
        }),
        prisma.dispute.update({
          where: { id },
          data: {
            status: 'RESOLVED_REFUND',
            resolutionNote: body.note,
            resolvedAt: new Date(),
          },
        }),
      ]);
    } else {
      await prisma.dispute.update({
        where: { id },
        data: {
          status: 'RESOLVED_RELEASE',
          resolutionNote: body.note,
          resolvedAt: new Date(),
        },
      });
    }
    await audit(auth.userId, 'resolve_dispute', 'Dispute', id, body.note);
    return { ok: true };
  });

  // Append-only audit log, for DSA transparency reporting.
  app.get('/api/admin/audit-log', async (req) => {
    await requireAdmin(req);
    const q = paginationQuery.parse(req.query);
    const rows = await prisma.adminAction.findMany({
      orderBy: { createdAt: 'desc' },
      take: q.limit + 1,
      ...(q.cursor && { cursor: { id: q.cursor }, skip: 1 }),
    });
    return buildPage(rows, q.limit);
  });
}
