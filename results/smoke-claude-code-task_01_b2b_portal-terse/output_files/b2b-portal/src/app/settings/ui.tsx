"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function OrgSettingsForm({
  name,
  plan,
  canEdit,
}: {
  name: string;
  plan: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [orgName, setOrgName] = useState(name);
  const [msg, setMsg] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/org/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: orgName }),
    });
    const data = await res.json().catch(() => ({}));
    setMsg(res.ok ? "Saved." : data.error ?? "Failed");
    if (res.ok) router.refresh();
  }

  return (
    <form onSubmit={save}>
      <label style={{ display: "block", marginBottom: 8 }}>
        Org name{" "}
        <input
          value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
          disabled={!canEdit}
          style={{ padding: 6 }}
        />
      </label>
      <p style={{ fontSize: 13 }}>Current plan: {plan}</p>
      {canEdit && <button type="submit">Save</button>}
      {!canEdit && (
        <p style={{ fontSize: 13, color: "#999" }}>
          Read-only for your role.
        </p>
      )}
      {msg && <span style={{ marginLeft: 8, fontSize: 13 }}>{msg}</span>}
    </form>
  );
}

export function SelfSettingsForm({
  name,
  email,
}: {
  name: string;
  email: string;
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(name);
  const [msg, setMsg] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/me/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: displayName }),
    });
    setMsg(res.ok ? "Saved." : "Failed");
    if (res.ok) router.refresh();
  }

  return (
    <form onSubmit={save}>
      <p style={{ fontSize: 13, color: "#666" }}>{email}</p>
      <label style={{ display: "block", marginBottom: 8 }}>
        Display name{" "}
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          style={{ padding: 6 }}
        />
      </label>
      <button type="submit">Save</button>
      {msg && <span style={{ marginLeft: 8, fontSize: 13 }}>{msg}</span>}
    </form>
  );
}
