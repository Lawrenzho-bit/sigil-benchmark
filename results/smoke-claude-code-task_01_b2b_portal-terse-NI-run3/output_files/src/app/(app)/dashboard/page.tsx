/** Dashboard — key metrics for the organization. */
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PLANS, seatLimit } from "@/lib/plans";

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="card">
      <p className="text-sm text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-zinc-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-zinc-400">{hint}</p>}
    </div>
  );
}

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-700",
  TRIALING: "bg-blue-100 text-blue-700",
  PAST_DUE: "bg-amber-100 text-amber-700",
  CANCELED: "bg-red-100 text-red-700",
  INCOMPLETE: "bg-zinc-100 text-zinc-600",
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { denied?: string };
}) {
  const { user, organization } = await requireUser();
  const orgId = organization.id;
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [activeMembers, pendingInvites, recentEvents, recentLogins] =
    await Promise.all([
      prisma.user.count({
        where: { organizationId: orgId, status: { not: "DEACTIVATED" } },
      }),
      prisma.invitation.count({
        where: { organizationId: orgId, acceptedAt: null },
      }),
      prisma.auditLog.count({
        where: { organizationId: orgId, createdAt: { gte: weekAgo } },
      }),
      prisma.user.count({
        where: { organizationId: orgId, lastLoginAt: { gte: weekAgo } },
      }),
    ]);

  const limit = seatLimit(organization.plan);
  const seatLabel =
    limit === Infinity
      ? `${activeMembers} / unlimited`
      : `${activeMembers} / ${limit}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900">Dashboard</h1>
        <p className="text-sm text-zinc-500">
          Overview of {organization.name}.
        </p>
      </div>

      {searchParams.denied && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          You don&apos;t have permission to view that page.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Active members" value={activeMembers} />
        <Metric label="Seat usage" value={seatLabel} hint={`${organization.plan} plan`} />
        <Metric label="Pending invites" value={pendingInvites} />
        <Metric
          label="Active this week"
          value={recentLogins}
          hint="signed in within 7 days"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <h2 className="font-semibold text-zinc-900">Subscription</h2>
          <div className="mt-3 flex items-center gap-3">
            <span className="text-lg font-medium">
              {PLANS[organization.plan].name}
            </span>
            <span
              className={`badge ${
                STATUS_STYLE[organization.subscriptionStatus] ??
                "bg-zinc-100 text-zinc-600"
              }`}
            >
              {organization.subscriptionStatus.toLowerCase().replace("_", " ")}
            </span>
          </div>
          <p className="mt-2 text-sm text-zinc-500">
            {organization.currentPeriodEnd
              ? `Renews ${organization.currentPeriodEnd.toLocaleDateString()}`
              : "No active billing period."}
          </p>
          {(user.role === "OWNER" || user.role === "ADMIN") && (
            <Link href="/billing" className="btn-secondary mt-4">
              Manage billing
            </Link>
          )}
        </div>

        <div className="card">
          <h2 className="font-semibold text-zinc-900">Activity</h2>
          <p className="mt-3 text-3xl font-semibold text-brand-700">
            {recentEvents}
          </p>
          <p className="text-sm text-zinc-500">audit events in the last 7 days</p>
          {(user.role === "OWNER" || user.role === "ADMIN") && (
            <Link href="/audit" className="btn-secondary mt-4">
              View audit log
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
