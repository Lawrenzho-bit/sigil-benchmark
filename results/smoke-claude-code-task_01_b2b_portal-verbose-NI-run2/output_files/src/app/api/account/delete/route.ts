import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { handleRoute, Errors } from '@/lib/errors';
import { requireSession, destroySession } from '@/lib/session';
import { verifyPassword } from '@/lib/password';
import { clientIp } from '@/lib/http';
import { logger } from '@/lib/logger';

const bodySchema = z.object({
  // Re-authenticate before this destructive action.
  password: z.string().min(1).max(128),
  confirm: z.literal('DELETE'),
});

/**
 * POST /api/account/delete — GDPR right-to-erasure.
 *
 * Behaviour depends on the caller's role:
 *  - An OWNER who is the org's last Owner deletes the ENTIRE organization,
 *    which cascades to all users, sessions, invitations and audit logs
 *    (onDelete: Cascade in the schema).
 *  - Any other user deletes only their own account.
 *
 * Audit history is intentionally cascaded with the org per the spec's
 * "cascading account deletion" requirement. If your compliance posture
 * requires retaining audit logs beyond org deletion, archive them to
 * cold storage in the transaction below before the cascade.
 */
export const POST = handleRoute(async (req) => {
  const session = await requireSession();
  const body = bodySchema.parse(await req.json());

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.userId },
  });
  if (!user.passwordHash || !(await verifyPassword(user.passwordHash, body.password))) {
    throw Errors.unauthorized('Password confirmation failed.');
  }

  const isLastOwner =
    user.role === 'OWNER' &&
    (await prisma.user.count({
      where: { orgId: session.orgId, role: 'OWNER', status: 'ACTIVE' },
    })) <= 1;

  if (isLastOwner) {
    logger.warn(
      { orgId: session.orgId, actor: session.email },
      'Organization deletion requested by last owner',
    );
    await prisma.organization.delete({ where: { id: session.orgId } });
  } else {
    await prisma.user.delete({ where: { id: session.userId } });
  }

  await destroySession();
  logger.info(
    { actor: session.email, scope: isLastOwner ? 'organization' : 'user', ip: clientIp(req) },
    'Account deletion completed',
  );

  return NextResponse.json({ ok: true, deleted: isLastOwner ? 'organization' : 'account' });
});
