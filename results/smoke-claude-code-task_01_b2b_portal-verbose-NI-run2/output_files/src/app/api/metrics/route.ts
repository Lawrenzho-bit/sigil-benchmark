import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { safeEqual } from '@/lib/crypto';

export const dynamic = 'force-dynamic';

/**
 * Prometheus-format metrics endpoint. Protected by a bearer token so it isn't
 * publicly scrapable — point your Prometheus scrape config's `authorization`
 * at METRICS_TOKEN.
 *
 * This exposes a few application-level gauges. Process/runtime metrics
 * (event loop lag, heap, GC) are best added via `prom-client` default
 * collectors — see the README operational notes.
 */
export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token || !safeEqual(token, env.METRICS_TOKEN)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const [orgs, activeUsers, deactivatedUsers, auditEvents] = await Promise.all([
    prisma.organization.count(),
    prisma.user.count({ where: { status: 'ACTIVE' } }),
    prisma.user.count({ where: { status: 'DEACTIVATED' } }),
    prisma.auditLog.count(),
  ]);

  const body = [
    '# HELP portal_organizations_total Number of customer organizations',
    '# TYPE portal_organizations_total gauge',
    `portal_organizations_total ${orgs}`,
    '# HELP portal_users_total Number of users by status',
    '# TYPE portal_users_total gauge',
    `portal_users_total{status="active"} ${activeUsers}`,
    `portal_users_total{status="deactivated"} ${deactivatedUsers}`,
    '# HELP portal_audit_events_total Number of audit log entries',
    '# TYPE portal_audit_events_total counter',
    `portal_audit_events_total ${auditEvents}`,
    '',
  ].join('\n');

  return new NextResponse(body, {
    status: 200,
    headers: { 'Content-Type': 'text/plain; version=0.0.4' },
  });
}
