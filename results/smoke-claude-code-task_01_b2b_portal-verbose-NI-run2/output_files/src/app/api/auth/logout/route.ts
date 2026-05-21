import { NextResponse } from 'next/server';
import { handleRoute } from '@/lib/errors';
import { getSession, destroySession } from '@/lib/session';
import { audit } from '@/lib/audit';
import { clientIp } from '@/lib/http';

export const POST = handleRoute(async (req) => {
  const session = await getSession();
  if (session) {
    await audit({
      orgId: session.orgId,
      actorId: session.userId,
      actorEmail: session.email,
      action: 'auth.logout',
      targetType: 'user',
      targetId: session.userId,
      ip: clientIp(req),
    });
  }
  await destroySession();
  return NextResponse.json({ ok: true });
});
