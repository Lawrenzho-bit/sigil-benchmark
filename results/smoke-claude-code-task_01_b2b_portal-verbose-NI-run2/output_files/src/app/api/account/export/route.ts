import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { handleRoute } from '@/lib/errors';
import { requireSession } from '@/lib/session';
import { audit } from '@/lib/audit';
import { clientIp } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * GET /api/account/export — GDPR data-portability endpoint. Returns all
 * personal data held about the authenticated user as a JSON download.
 * Secrets (password hash, TOTP secret, token hashes) are deliberately excluded.
 */
export const GET = handleRoute(async (req) => {
  const session = await requireSession();

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      status: true,
      mfaEnabled: true,
      emailVerifiedAt: true,
      lastLoginAt: true,
      createdAt: true,
      org: { select: { id: true, name: true } },
    },
  });

  const auditEntries = await prisma.auditLog.findMany({
    where: { actorId: session.userId },
    orderBy: { createdAt: 'desc' },
    select: { action: true, targetType: true, ip: true, createdAt: true },
  });

  await audit({
    orgId: session.orgId,
    actorId: session.userId,
    actorEmail: session.email,
    action: 'account.data_exported',
    targetType: 'user',
    targetId: session.userId,
    ip: clientIp(req),
  });

  return new NextResponse(
    JSON.stringify({ exportedAt: new Date().toISOString(), user, auditEntries }, null, 2),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="my-data-export.json"',
      },
    },
  );
});
