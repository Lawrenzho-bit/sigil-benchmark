import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { can } from "@/lib/rbac";
import { db } from "@/lib/db";

export default async function Dashboard() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!can(session.role, "dashboard:view")) redirect("/login");

  const [memberCount, activeCount, org, recentInvites] = await Promise.all([
    db.membership.count({ where: { orgId: session.orgId } }),
    db.user.count({
      where: { isActive: true, membership: { orgId: session.orgId } },
    }),
    db.organization.findUnique({ where: { id: session.orgId } }),
    db.invite.count({
      where: { orgId: session.orgId, acceptedAt: null },
    }),
  ]);

  const metrics = [
    { label: "Members", value: memberCount },
    { label: "Active users", value: activeCount },
    { label: "Pending invites", value: recentInvites },
    { label: "Plan", value: org?.plan ?? "—" },
  ];

  return (
    <div>
      <Nav role={session.role} email={session.email} />
      <h1>Dashboard</h1>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {metrics.map((m) => (
          <div
            key={m.label}
            style={{
              background: "#fff",
              border: "1px solid #e5e5e5",
              borderRadius: 8,
              padding: 20,
              minWidth: 160,
            }}
          >
            <div style={{ fontSize: 13, color: "#666" }}>{m.label}</div>
            <div style={{ fontSize: 28, fontWeight: 600 }}>{m.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Nav({ role, email }: { role: string; email: string }) {
  const links: Array<[string, string]> = [
    ["/dashboard", "Dashboard"],
    ["/users", "Users"],
    ["/settings", "Settings"],
    ["/audit", "Audit log"],
  ];
  return (
    <nav
      style={{
        display: "flex",
        gap: 16,
        alignItems: "center",
        borderBottom: "1px solid #e5e5e5",
        paddingBottom: 12,
        marginBottom: 24,
      }}
    >
      {links.map(([href, label]) => (
        <Link key={href} href={href} style={{ textDecoration: "none", color: "#0366d6" }}>
          {label}
        </Link>
      ))}
      <span style={{ marginLeft: "auto", fontSize: 13, color: "#666" }}>
        {email} ({role})
      </span>
      <form action="/api/auth/logout" method="post">
        <button type="submit" style={{ fontSize: 13 }}>
          Sign out
        </button>
      </form>
    </nav>
  );
}
