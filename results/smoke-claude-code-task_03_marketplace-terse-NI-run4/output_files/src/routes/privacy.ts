// GDPR data-subject endpoints: access (Art. 15 export) and erasure (Art. 17).
//
// Erasure is a *scrub*, not a row delete: financial records (orders, payments,
// payouts, tax) must be retained for statutory accounting periods, so we null
// the PII and mark the account DELETED rather than cascading a hard delete.
import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

export async function privacyRoutes(app: FastifyInstance): Promise<void> {
  // Art. 15 — machine-readable export of the requester's personal data.
  app.get('/api/privacy/export', async (req) => {
    const auth = await requireAuth(req);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: auth.userId },
      include: {
        addresses: true,
        oauthAccounts: { select: { provider: true, createdAt: true } },
        listings: { select: { id: true, title: true, status: true } },
        buyerOrders: { select: { id: true, status: true, totalAmount: true, createdAt: true } },
        reviewsWritten: { select: { id: true, rating: true, body: true } },
        messagesSent: { select: { id: true, body: true, createdAt: true } },
      },
    });
    return { exportedAt: new Date().toISOString(), subject: user };
  });

  // Art. 17 — right to erasure. PII is scrubbed; the row is retained DELETED.
  app.post('/api/privacy/erase', async (req, reply) => {
    const auth = await requireAuth(req);
    const anon = `deleted-${auth.userId}@example.invalid`;
    await prisma.$transaction([
      prisma.user.update({
        where: { id: auth.userId },
        data: {
          email: anon,
          passwordHash: null,
          displayName: 'Deleted user',
          status: 'DELETED',
          deletedAt: new Date(),
        },
      }),
      prisma.address.deleteMany({ where: { userId: auth.userId } }),
      prisma.oAuthAccount.deleteMany({ where: { userId: auth.userId } }),
      // Revoke every session so the account cannot be used post-erasure.
      prisma.session.updateMany({
        where: { userId: auth.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      // Free-text user content is scrubbed; structural rows are kept.
      prisma.message.updateMany({
        where: { senderId: auth.userId },
        data: { body: '[removed]' },
      }),
    ]);
    return reply.code(202).send({ status: 'erased' });
  });
}
