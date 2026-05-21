import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  // --- Content moderation (DSA) ---

  /** Anyone can report a listing; this opens a moderation flag. */
  async reportListing(reporterId: string | null, listingId: string, reason: string) {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing) throw new NotFoundException('Listing not found');
    return this.prisma.moderationFlag.create({
      data: { listingId, reportedById: reporterId, reason, status: 'PENDING' },
    });
  }

  listModerationQueue(status = 'PENDING') {
    return this.prisma.moderationFlag.findMany({
      where: { status: status as any },
      orderBy: { createdAt: 'asc' },
      include: { listing: { select: { id: true, title: true, sellerId: true, status: true } } },
    });
  }

  /**
   * Admin decision on a flag. DSA Art. 17 requires a "statement of reasons"
   * for every restriction; when the listing is taken down it moves to
   * MODERATED and the statement is recorded for the trader + transparency DB.
   */
  async decideModeration(
    adminId: string,
    flagId: string,
    action: 'ACTIONED' | 'DISMISSED',
    statementOfReasons: string,
  ) {
    const flag = await this.prisma.moderationFlag.findUnique({ where: { id: flagId } });
    if (!flag) throw new NotFoundException('Flag not found');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.moderationFlag.update({
        where: { id: flagId },
        data: {
          status: action,
          statementOfReasons,
          decidedByAdminId: adminId,
          decidedAt: new Date(),
        },
      });
      if (action === 'ACTIONED' && flag.listingId) {
        await tx.listing.update({
          where: { id: flag.listingId },
          data: { status: 'MODERATED' },
        });
      }
      await tx.auditLog.create({
        data: {
          actorId: adminId,
          action: `moderation.${action.toLowerCase()}`,
          targetType: 'listing',
          targetId: flag.listingId ?? flagId,
          metadata: { flagId, statementOfReasons },
        },
      });
      // TODO: push the statement of reasons to the EU DSA Transparency Database.
      return updated;
    });
  }

  // --- Fraud review ---

  listFraudCases(status = 'OPEN') {
    return this.prisma.fraudCase.findMany({
      where: { status: status as any },
      orderBy: { riskScore: 'desc' },
    });
  }

  async reviewFraudCase(
    adminId: string,
    caseId: string,
    decision: 'CLEARED' | 'CONFIRMED',
    notes: string,
  ) {
    const fraudCase = await this.prisma.fraudCase.findUnique({ where: { id: caseId } });
    if (!fraudCase) throw new NotFoundException('Fraud case not found');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.fraudCase.update({
        where: { id: caseId },
        data: { status: decision, reviewedByAdminId: adminId, notes },
      });
      // A confirmed seller-fraud case suspends the seller account.
      if (decision === 'CONFIRMED' && fraudCase.subjectType === 'seller') {
        await tx.sellerProfile.update({
          where: { id: fraudCase.subjectId },
          data: { status: 'SUSPENDED' },
        });
      }
      await tx.auditLog.create({
        data: {
          actorId: adminId,
          action: `fraud.${decision.toLowerCase()}`,
          targetType: fraudCase.subjectType,
          targetId: fraudCase.subjectId,
          metadata: { caseId },
        },
      });
      return updated;
    });
  }

  // --- Account actions ---

  async suspendSeller(adminId: string, sellerId: string, reason: string) {
    const seller = await this.prisma.sellerProfile.findUnique({ where: { id: sellerId } });
    if (!seller) throw new NotFoundException('Seller not found');
    await this.prisma.$transaction([
      this.prisma.sellerProfile.update({
        where: { id: sellerId },
        data: { status: 'SUSPENDED' },
      }),
      // Hide all of the seller's live listings.
      this.prisma.listing.updateMany({
        where: { sellerId, status: { in: ['ACTIVE', 'OUT_OF_STOCK', 'PAUSED'] } },
        data: { status: 'MODERATED' },
      }),
      this.prisma.auditLog.create({
        data: {
          actorId: adminId,
          action: 'seller.suspended',
          targetType: 'seller',
          targetId: sellerId,
          metadata: { reason },
        },
      }),
    ]);
    return { suspended: true };
  }

  /** High-level marketplace counters for the admin dashboard. */
  async metrics() {
    const [users, sellers, listings, openDisputes, pendingFlags, openFraud] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.sellerProfile.count({ where: { status: 'ACTIVE' } }),
      this.prisma.listing.count({ where: { status: 'ACTIVE' } }),
      this.prisma.dispute.count({ where: { status: { in: ['OPEN', 'ESCALATED'] } } }),
      this.prisma.moderationFlag.count({ where: { status: 'PENDING' } }),
      this.prisma.fraudCase.count({ where: { status: 'OPEN' } }),
    ]);
    return { users, activeSellers: sellers, activeListings: listings, openDisputes, pendingFlags, openFraud };
  }
}
