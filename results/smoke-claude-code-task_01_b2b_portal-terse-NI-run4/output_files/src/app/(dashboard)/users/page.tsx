import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/db";
import { ROLE_LABELS } from "@/lib/rbac";
import { InviteForm } from "@/components/invite-form";
import { changeRole, setUserActive, revokeInvite } from "./actions";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const actor = await requireRole("ADMIN");
  const isOwner = actor.role === "OWNER";

  const [members, invites] = await Promise.all([
    prisma.user.findMany({ where: { orgId: actor.orgId }, orderBy: { createdAt: "asc" } }),
    prisma.invite.findMany({
      where: { orgId: actor.orgId, acceptedAt: null },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Users</h1>
        <p className="text-sm text-gray-500">Invite teammates and manage roles and access.</p>
      </div>

      <div className="card">
        <h2 className="mb-3 font-semibold text-gray-900">Invite a teammate</h2>
        <InviteForm canInviteOwner={isOwner} />
      </div>

      {invites.length > 0 && (
        <div className="card">
          <h2 className="mb-3 font-semibold text-gray-900">Pending invitations</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-gray-400">
              <tr>
                <th className="pb-2">Email</th>
                <th className="pb-2">Role</th>
                <th className="pb-2">Expires</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {invites.map((inv) => (
                <tr key={inv.id}>
                  <td className="py-2">{inv.email}</td>
                  <td className="py-2">{ROLE_LABELS[inv.role]}</td>
                  <td className="py-2 text-gray-500">{inv.expiresAt.toLocaleDateString()}</td>
                  <td className="py-2 text-right">
                    <form action={revokeInvite}>
                      <input type="hidden" name="inviteId" value={inv.id} />
                      <button type="submit" className="text-sm text-red-600 hover:underline">
                        Revoke
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h2 className="mb-3 font-semibold text-gray-900">Members ({members.length})</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-gray-400">
            <tr>
              <th className="pb-2">Member</th>
              <th className="pb-2">Role</th>
              <th className="pb-2">Status</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {members.map((m) => {
              const isSelf = m.id === actor.id;
              // Admins cannot edit owners; only owners can.
              const canEdit = !isSelf && (isOwner || m.role !== "OWNER");
              return (
                <tr key={m.id}>
                  <td className="py-3">
                    <p className="font-medium text-gray-900">{m.name}</p>
                    <p className="text-xs text-gray-500">{m.email}</p>
                  </td>
                  <td className="py-3">
                    {canEdit ? (
                      <form action={changeRole} className="flex items-center gap-2">
                        <input type="hidden" name="userId" value={m.id} />
                        <select name="role" defaultValue={m.role} className="input w-32 py-1">
                          <option value="VIEWER">Viewer</option>
                          <option value="ADMIN">Admin</option>
                          {isOwner && <option value="OWNER">Owner</option>}
                        </select>
                        <button type="submit" className="text-xs text-brand-600 hover:underline">
                          Save
                        </button>
                      </form>
                    ) : (
                      <span>{ROLE_LABELS[m.role]}</span>
                    )}
                  </td>
                  <td className="py-3">
                    <span
                      className={`badge ${
                        m.active ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-600"
                      }`}
                    >
                      {m.active ? "Active" : "Deactivated"}
                    </span>
                  </td>
                  <td className="py-3 text-right">
                    {canEdit && (
                      <form action={setUserActive}>
                        <input type="hidden" name="userId" value={m.id} />
                        <input type="hidden" name="active" value={m.active ? "false" : "true"} />
                        <button
                          type="submit"
                          className={`text-sm hover:underline ${
                            m.active ? "text-red-600" : "text-green-600"
                          }`}
                        >
                          {m.active ? "Deactivate" : "Reactivate"}
                        </button>
                      </form>
                    )}
                    {isSelf && <span className="text-xs text-gray-400">You</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
