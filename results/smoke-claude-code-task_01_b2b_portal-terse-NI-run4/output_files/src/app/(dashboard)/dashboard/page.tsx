import Link from "next/link";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { PLANS } from "@/lib/plans";
import { ROLE_LABELS } from "@/lib/rbac";

export const dynamic = "force-dynamic";

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-1 text-3xl font-semibold text-gray-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

export default async function DashboardPage() {
  const user = await requireUser();
  const orgId = user.orgId;

  // Key metrics for the workspace.
  const [totalUsers, activeUsers, pendingInvites, recentEvents] = await Promise.all([
    prisma.user.count({ where: { orgId } }),
    prisma.user.count({ where: { orgId, active: true } }),
    prisma.invite.count({ where: { orgId, acceptedAt: null } }),
    prisma.auditLog.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  const plan = PLANS[user.organization.plan];
  const seatLabel = plan.seatLimit ? `${activeUsers} / ${plan.seatLimit}` : `${activeUsers}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500">Welcome back, {user.name.split(" ")[0]}.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Active users" value={seatLabel} hint={plan.seatLimit ? "Seats used" : "Unlimited seats"} />
        <Metric label="Total accounts" value={String(totalUsers)} />
        <Metric label="Pending invites" value={String(pendingInvites)} />
        <Metric label="Current plan" value={plan.name} hint={user.organization.subscriptionStatus} />
      </div>

      <div className="card">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Recent activity</h2>
          <Link href="/audit" className="text-sm text-brand-600 hover:underline">
            View audit log
          </Link>
        </div>
        {recentEvents.length === 0 ? (
          <p className="text-sm text-gray-500">No activity yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {recentEvents.map((e) => (
              <li key={e.id} className="flex items-center justify-between py-2 text-sm">
                <span className="font-medium text-gray-700">{e.action}</span>
                <span className="text-gray-400">
                  {e.actorEmail} · {e.createdAt.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-xs text-gray-400">
        Signed in as {ROLE_LABELS[user.role]} · {user.organization.name}
      </p>
    </div>
  );
}
