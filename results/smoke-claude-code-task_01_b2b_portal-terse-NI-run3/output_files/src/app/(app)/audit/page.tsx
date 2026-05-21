/** Audit log — append-only record of privileged actions. ADMIN+ to view. */
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";

const PAGE_SIZE = 50;

/** Human-readable label for each audit action. */
const ACTION_LABEL: Record<string, string> = {
  "auth.login": "Signed in",
  "auth.login_sso": "Signed in (SSO)",
  "auth.logout": "Signed out",
  "auth.signup": "Created organization",
  "user.invited": "Invited a user",
  "user.invite_accepted": "Accepted an invitation",
  "user.invite_revoked": "Revoked an invitation",
  "user.role_changed": "Changed a user's role",
  "user.deactivated": "Deactivated a user",
  "user.reactivated": "Reactivated a user",
  "billing.checkout_started": "Started checkout",
  "billing.plan_changed": "Plan changed",
  "billing.subscription_canceled": "Subscription canceled",
  "settings.org_updated": "Updated org settings",
  "settings.user_updated": "Updated profile",
};

export default async function AuditPage({
  searchParams,
}: {
  searchParams: { cursor?: string };
}) {
  const { organization } = await requirePermission("audit:view");

  const rows = await prisma.auditLog.findMany({
    where: { organizationId: organization.id },
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE + 1,
    ...(searchParams.cursor
      ? { cursor: { id: searchParams.cursor }, skip: 1 }
      : {}),
  });

  const hasMore = rows.length > PAGE_SIZE;
  const items = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  const nextCursor = hasMore ? items[items.length - 1]!.id : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900">Audit log</h1>
        <p className="text-sm text-zinc-500">
          Every privileged action in {organization.name}, newest first.
        </p>
      </div>

      <div className="card overflow-x-auto">
        {items.length === 0 ? (
          <p className="text-sm text-zinc-500">No activity recorded yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-zinc-500">
                <th className="py-2">When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Target</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id} className="border-t border-zinc-100">
                  <td className="py-2 text-zinc-500">
                    {row.createdAt.toLocaleString()}
                  </td>
                  <td className="text-zinc-900">{row.actorEmail}</td>
                  <td>
                    <span className="badge bg-zinc-100 text-zinc-700">
                      {ACTION_LABEL[row.action] ?? row.action}
                    </span>
                  </td>
                  <td className="text-zinc-500">
                    {row.targetType
                      ? `${row.targetType}${row.targetId ? ` · ${row.targetId.slice(0, 8)}` : ""}`
                      : "—"}
                  </td>
                  <td className="text-zinc-400">{row.ip ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {nextCursor && (
        <div className="flex justify-end">
          <Link
            href={`/audit?cursor=${nextCursor}`}
            className="btn-secondary"
          >
            Next page →
          </Link>
        </div>
      )}
    </div>
  );
}
