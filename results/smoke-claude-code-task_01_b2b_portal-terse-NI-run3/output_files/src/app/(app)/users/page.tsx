/** User management — members list, invitations, role + status controls. */
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { UsersClient } from "./users-client";

export default async function UsersPage() {
  const { user, organization } = await requireUser();

  const [members, invitations] = await Promise.all([
    prisma.user.findMany({
      where: { organizationId: organization.id },
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        lastLoginAt: true,
      },
    }),
    prisma.invitation.findMany({
      where: { organizationId: organization.id, acceptedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, role: true, expiresAt: true },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900">Users</h1>
        <p className="text-sm text-zinc-500">
          Manage who has access to {organization.name}.
        </p>
      </div>
      <UsersClient
        currentUserId={user.id}
        currentRole={user.role}
        canManage={can(user.role, "users:invite")}
        members={members.map((m) => ({
          ...m,
          lastLoginAt: m.lastLoginAt ? m.lastLoginAt.toISOString() : null,
        }))}
        invitations={invitations.map((i) => ({
          ...i,
          expiresAt: i.expiresAt.toISOString(),
        }))}
      />
    </div>
  );
}
