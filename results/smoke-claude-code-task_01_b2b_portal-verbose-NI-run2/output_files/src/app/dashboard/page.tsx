import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { prisma } from '@/lib/db';
import { can } from '@/lib/rbac';
import { PLANS } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

/**
 * Main dashboard. Server-rendered: the session and all data are resolved on
 * the server, and billing is only queried/shown when the role permits it —
 * the same RBAC matrix the API uses.
 */
export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect('/');

  const orgId = session.orgId;
  const [org, activeUsers, deactivatedUsers, recent] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: orgId } }),
    prisma.user.count({ where: { orgId, status: 'ACTIVE' } }),
    prisma.user.count({ where: { orgId, status: 'DEACTIVATED' } }),
    prisma.auditLog.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  ]);

  const showBilling = can(session.role, 'billing.view');

  return (
    <main className="container">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ marginBottom: 0 }}>{org.name}</h1>
          <p className="muted">
            Signed in as {session.email} · {session.role}
          </p>
        </div>
        <form action="/api/auth/logout" method="post">
          <button type="submit">Sign out</button>
        </form>
      </header>

      <section className="grid" style={{ marginTop: '1.5rem' }}>
        <div className="panel">
          <p className="muted">Active users</p>
          <p style={{ fontSize: '2rem', margin: 0 }}>{activeUsers}</p>
        </div>
        <div className="panel">
          <p className="muted">Deactivated users</p>
          <p style={{ fontSize: '2rem', margin: 0 }}>{deactivatedUsers}</p>
        </div>
        {showBilling && (
          <div className="panel">
            <p className="muted">Plan</p>
            <p style={{ fontSize: '1.5rem', margin: 0 }}>
              {PLANS[org.plan].label}
            </p>
            <p className="muted" style={{ fontSize: '0.8rem' }}>
              {org.subscriptionStatus}
              {org.currentPeriodEnd
                ? ` · renews ${org.currentPeriodEnd.toISOString().slice(0, 10)}`
                : ''}
            </p>
          </div>
        )}
      </section>

      <section className="panel" style={{ marginTop: '1.5rem' }}>
        <h2 style={{ marginTop: 0 }}>Recent activity</h2>
        {recent.length === 0 ? (
          <p className="muted">No activity yet.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {recent.map((e) => (
              <li
                key={e.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '0.4rem 0',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <span>
                  <strong>{e.action}</strong>{' '}
                  <span className="muted">by {e.actorEmail}</span>
                </span>
                <span className="muted" style={{ fontSize: '0.8rem' }}>
                  {e.createdAt.toISOString().replace('T', ' ').slice(0, 16)} UTC
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
