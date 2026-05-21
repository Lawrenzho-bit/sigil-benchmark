import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        status: true,
        countryCode: true,
        emailVerified: true,
        createdAt: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateProfile(userId: string, data: { displayName?: string; countryCode?: string }) {
    return this.prisma.user.update({
      where: { id: userId },
      data,
      select: { id: true, displayName: true, countryCode: true },
    });
  }

  /**
   * GDPR Art. 20 — data portability. Exports everything tied to the subject.
   * In production this is queued and delivered as a downloadable archive.
   */
  async exportData(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        orderGroups: { include: { orders: { include: { items: true } } } },
        reviewsWritten: true,
        messages: true,
        sellerProfile: { include: { listings: true, payouts: true } },
      },
    });
  }

  /**
   * GDPR Art. 17 — right to erasure. Orders, payments and tax records must be
   * retained for legal/accounting obligations, so we pseudonymise the user
   * row rather than hard-deleting it, and revoke all access.
   */
  async eraseAccount(userId: string) {
    await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.oAuthAccount.deleteMany({ where: { userId } }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          email: `erased+${userId}@deleted.invalid`,
          displayName: 'Deleted user',
          passwordHash: null,
          countryCode: null,
          status: 'DEACTIVATED',
          deletedAt: new Date(),
        },
      }),
      this.prisma.auditLog.create({
        data: { actorId: userId, action: 'user.erased', targetType: 'user', targetId: userId },
      }),
    ]);
    return { erased: true };
  }
}
