"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Role } from "@prisma/client";
import { apiFetch } from "@/components/forms";

interface Member {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: "ACTIVE" | "INVITED" | "DEACTIVATED";
  lastLoginAt: string | null;
}
interface Invite {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
}

const RANK: Record<Role, number> = { VIEWER: 1, ADMIN: 2, OWNER: 3 };

export function UsersClient({
  currentUserId,
  currentRole,
  canManage,
  members,
  invitations,
}: {
  currentUserId: string;
  currentRole: Role;
  canManage: boolean;
  members: Member[];
  invitations: Invite[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );

  // Invite form state.
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("VIEWER");

  function flash(kind: "ok" | "err", text: string) {
    setMsg({ kind, text });
    setTimeout(() => setMsg(null), 4000);
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy("invite");
    const res = await apiFetch("/api/users", {
      method: "POST",
      body: { email: inviteEmail, role: inviteRole },
    });
    setBusy(null);
    if (res.ok) {
      flash("ok", `Invitation sent to ${inviteEmail}.`);
      setInviteEmail("");
      router.refresh();
    } else {
      flash("err", res.error ?? "Could not send invitation.");
    }
  }

  async function changeRole(id: string, role: Role) {
    setBusy(id);
    const res = await apiFetch(`/api/users/${id}`, {
      method: "PATCH",
      body: { role },
    });
    setBusy(null);
    if (res.ok) {
      flash("ok", "Role updated.");
      router.refresh();
    } else flash("err", res.error ?? "Could not update role.");
  }

  async function setStatus(id: string, status: "ACTIVE" | "DEACTIVATED") {
    setBusy(id);
    const res = await apiFetch(`/api/users/${id}`, {
      method: "PATCH",
      body: { status },
    });
    setBusy(null);
    if (res.ok) {
      flash("ok", status === "ACTIVE" ? "User reactivated." : "User deactivated.");
      router.refresh();
    } else flash("err", res.error ?? "Could not update user.");
  }

  async function revoke(id: string) {
    setBusy(id);
    const res = await apiFetch(`/api/users/${id}`, { method: "DELETE" });
    setBusy(null);
    if (res.ok) {
      flash("ok", "Invitation revoked.");
      router.refresh();
    } else flash("err", res.error ?? "Could not revoke invitation.");
  }

  /** Whether the current user may act on this member. */
  function canActOn(m: Member): boolean {
    if (!canManage) return false;
    if (m.id === currentUserId) return false;
    if (m.role === "OWNER" && currentRole !== "OWNER") return false;
    return true;
  }

  // Owners may assign any role; admins may not grant OWNER.
  const assignableRoles: Role[] =
    currentRole === "OWNER" ? ["OWNER", "ADMIN", "VIEWER"] : ["ADMIN", "VIEWER"];

  return (
    <div className="space-y-6">
      {msg && (
        <div
          className={`rounded-lg px-3 py-2 text-sm ${
            msg.kind === "ok"
              ? "bg-green-50 text-green-700"
              : "bg-red-50 text-red-700"
          }`}
        >
          {msg.text}
        </div>
      )}

      {canManage && (
        <div className="card">
          <h2 className="font-semibold text-zinc-900">Invite a teammate</h2>
          <form onSubmit={invite} className="mt-3 flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[220px]">
              <label className="label" htmlFor="invite-email">
                Email
              </label>
              <input
                id="invite-email"
                type="email"
                required
                className="input"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="invite-role">
                Role
              </label>
              <select
                id="invite-role"
                className="input"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as Role)}
              >
                <option value="VIEWER">Viewer</option>
                <option value="ADMIN">Admin</option>
              </select>
            </div>
            <button
              type="submit"
              className="btn-primary"
              disabled={busy === "invite"}
            >
              {busy === "invite" ? "Sending…" : "Send invite"}
            </button>
          </form>
        </div>
      )}

      <div className="card overflow-x-auto">
        <h2 className="font-semibold text-zinc-900">
          Members ({members.length})
        </h2>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left text-zinc-500">
              <th className="py-2">Name</th>
              <th>Role</th>
              <th>Status</th>
              <th>Last login</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-t border-zinc-100">
                <td className="py-2">
                  <div className="font-medium text-zinc-900">{m.name}</div>
                  <div className="text-zinc-400">{m.email}</div>
                </td>
                <td>
                  {canActOn(m) ? (
                    <select
                      className="input !py-1 !w-auto"
                      value={m.role}
                      disabled={busy === m.id}
                      onChange={(e) => changeRole(m.id, e.target.value as Role)}
                    >
                      {/* Show current role even if not normally assignable. */}
                      {Array.from(
                        new Set<Role>([m.role, ...assignableRoles]),
                      ).map((r) => (
                        <option key={r} value={r}>
                          {r.toLowerCase()}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="badge bg-zinc-100 text-zinc-600">
                      {m.role.toLowerCase()}
                    </span>
                  )}
                </td>
                <td>
                  <span
                    className={`badge ${
                      m.status === "ACTIVE"
                        ? "bg-green-100 text-green-700"
                        : m.status === "DEACTIVATED"
                          ? "bg-red-100 text-red-700"
                          : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {m.status.toLowerCase()}
                  </span>
                </td>
                <td className="text-zinc-500">
                  {m.lastLoginAt
                    ? new Date(m.lastLoginAt).toLocaleDateString()
                    : "—"}
                </td>
                <td className="text-right">
                  {canActOn(m) &&
                    (m.status === "DEACTIVATED" ? (
                      <button
                        className="btn-secondary !py-1 !px-2"
                        disabled={busy === m.id}
                        onClick={() => setStatus(m.id, "ACTIVE")}
                      >
                        Reactivate
                      </button>
                    ) : (
                      <button
                        className="btn-danger !py-1 !px-2"
                        disabled={busy === m.id}
                        onClick={() => setStatus(m.id, "DEACTIVATED")}
                      >
                        Deactivate
                      </button>
                    ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {invitations.length > 0 && (
        <div className="card overflow-x-auto">
          <h2 className="font-semibold text-zinc-900">
            Pending invitations ({invitations.length})
          </h2>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-zinc-500">
                <th className="py-2">Email</th>
                <th>Role</th>
                <th>Expires</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {invitations.map((inv) => (
                <tr key={inv.id} className="border-t border-zinc-100">
                  <td className="py-2 text-zinc-900">{inv.email}</td>
                  <td className="text-zinc-500">{inv.role.toLowerCase()}</td>
                  <td className="text-zinc-500">
                    {new Date(inv.expiresAt).toLocaleDateString()}
                  </td>
                  <td className="text-right">
                    {canManage && (
                      <button
                        className="btn-danger !py-1 !px-2"
                        disabled={busy === inv.id}
                        onClick={() => revoke(inv.id)}
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
