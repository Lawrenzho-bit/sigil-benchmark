"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const ROLES = ["owner", "admin", "viewer"] as const;

export function InviteForm({ canInviteOwner }: { canInviteOwner: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("viewer");
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const res = await fetch("/api/users/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setEmail("");
      setMsg("Invitation sent.");
      router.refresh();
    } else {
      setMsg(data.error ?? "Failed to invite");
    }
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <input
        type="email"
        placeholder="invitee@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        style={{ padding: 6 }}
      />
      <select value={role} onChange={(e) => setRole(e.target.value)}>
        {ROLES.filter((r) => r !== "owner" || canInviteOwner).map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <button type="submit">Invite</button>
      {msg && <span style={{ fontSize: 13, color: "#666" }}>{msg}</span>}
    </form>
  );
}

export function UserRow(props: {
  userId: string;
  email: string;
  role: string;
  active: boolean;
  isSelf: boolean;
  actorRole: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function changeRole(role: string) {
    setBusy(true);
    await fetch(`/api/users/${props.userId}/role`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    setBusy(false);
    router.refresh();
  }

  async function deactivate() {
    setBusy(true);
    await fetch(`/api/users/${props.userId}/deactivate`, { method: "POST" });
    setBusy(false);
    router.refresh();
  }

  const canEditThis =
    props.canManage &&
    !props.isSelf &&
    (props.actorRole === "owner" || props.role !== "owner");

  return (
    <tr style={{ borderBottom: "1px solid #eee" }}>
      <td style={{ padding: 8 }}>{props.email}</td>
      <td style={{ padding: 8 }}>{props.role}</td>
      <td style={{ padding: 8 }}>{props.active ? "active" : "deactivated"}</td>
      {props.canManage && (
        <td style={{ padding: 8 }}>
          {canEditThis ? (
            <span style={{ display: "flex", gap: 8 }}>
              <select
                defaultValue={props.role}
                disabled={busy}
                onChange={(e) => changeRole(e.target.value)}
              >
                {ROLES.filter(
                  (r) => r !== "owner" || props.actorRole === "owner",
                ).map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              {props.active && (
                <button onClick={deactivate} disabled={busy}>
                  Deactivate
                </button>
              )}
            </span>
          ) : (
            <span style={{ color: "#999", fontSize: 13 }}>—</span>
          )}
        </td>
      )}
    </tr>
  );
}
