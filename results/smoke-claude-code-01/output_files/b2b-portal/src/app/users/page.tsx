import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { can } from "@/lib/rbac";
import { db } from "@/lib/db";
import { Nav } from "../dashboard/page";
import { UserRow, InviteForm } from "./ui";

export default async function UsersPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!can(session.role, "users:view")) redirect("/dashboard");

  const members = await db.membership.findMany({
    where: { orgId: session.orgId },
    include: { user: true },
    orderBy: { role: "asc" },
  });

  const canManage = can(session.role, "users:change_role");

  return (
    <div>
      <Nav role={session.role} email={session.email} />
      <h1>Users</h1>

      {can(session.role, "users:invite") && (
        <InviteForm canInviteOwner={session.role === "owner"} />
      )}

      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 16 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
            <th style={{ padding: 8 }}>Email</th>
            <th style={{ padding: 8 }}>Role</th>
            <th style={{ padding: 8 }}>Status</th>
            {canManage && <th style={{ padding: 8 }}>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <UserRow
              key={m.id}
              userId={m.userId}
              email={m.user.email}
              role={m.role.toLowerCase()}
              active={m.user.isActive}
              isSelf={m.userId === session.userId}
              actorRole={session.role}
              canManage={canManage}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
