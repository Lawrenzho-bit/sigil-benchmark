import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { handleRoute } from '@/lib/errors';
import { authorize } from '@/lib/authz';
import { can } from '@/lib/rbac';
import { PLANS } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

/**
 * GET /api/dashboard — the main dashboard payload: user counts, recent
 * activity, billing status and health indicators. Billing fields are omitted
 * for roles without `billing.view` so the API never over-shares.
 */
export const GET = handleRoute(async () => {
  const session = await authorize('dashboard.view');
  const orgId = session.orgId;

  const [org, activeUsers, deactivatedUsers, recentActivity] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: orgId } }),
    prisma.user.count({ where: { orgId, status: 'ACTIVE' } }),
    prisma.user.count({ where: { orgId, status: 'DEACTIVATED' } }),
    prisma.auditLog.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        action: true,
        actorEmail: true,
        targetType: true,
        createdAt: true,
      },
    }),
  ]);

  const showBilling = can(session.role, 'billing.view');

  return NextResponse.json({
    users: { active: activeUsers, deactivated: deactivatedUsers },
    recentActivity,
    billing: showBilling
      ? {
          plan: org.plan,
          planLabel: PLANS[org.plan].label,
          status: org.subscriptionStatus,
          nextInvoiceDate: org.currentPeriodEnd,
          seatLimit: PLANS[org.plan].userLimit,
        }
      : null,
    health: {
      // Placeholder health signals. Wire real integration checks here.
      subscriptionHealthy:
        org.subscriptionStatus === 'ACTIVE' || org.subscriptionStatus === 'TRIALING',
      alerts: [] as string[],
    },
  });
});
