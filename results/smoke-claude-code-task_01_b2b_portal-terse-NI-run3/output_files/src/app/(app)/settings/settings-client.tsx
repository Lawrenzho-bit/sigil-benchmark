"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/components/forms";

function useFlash() {
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );
  function flash(kind: "ok" | "err", text: string) {
    setMsg({ kind, text });
    setTimeout(() => setMsg(null), 4000);
  }
  const node = msg ? (
    <div
      className={`rounded-lg px-3 py-2 text-sm ${
        msg.kind === "ok"
          ? "bg-green-50 text-green-700"
          : "bg-red-50 text-red-700"
      }`}
    >
      {msg.text}
    </div>
  ) : null;
  return { flash, node };
}

/* -------------------------------------------------------------------------- */
/* Organization settings                                                      */
/* -------------------------------------------------------------------------- */

export function OrgSettings({
  canManage,
  ssoConfigured,
  org,
}: {
  canManage: boolean;
  ssoConfigured: boolean;
  org: {
    name: string;
    slug: string;
    timezone: string;
    ssoEnabled: boolean;
    ssoEnforced: boolean;
  };
}) {
  const router = useRouter();
  const { flash, node } = useFlash();
  const [form, setForm] = useState(org);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await apiFetch("/api/settings/org", {
      method: "PATCH",
      body: {
        name: form.name,
        timezone: form.timezone,
        ssoEnabled: form.ssoEnabled,
        ssoEnforced: form.ssoEnforced,
      },
    });
    setBusy(false);
    if (res.ok) {
      flash("ok", "Organization settings saved.");
      router.refresh();
    } else flash("err", res.error ?? "Could not save settings.");
  }

  return (
    <div className="card">
      <h2 className="font-semibold text-zinc-900">Organization</h2>
      {!canManage && (
        <p className="mt-1 text-xs text-zinc-400">
          Only admins and owners can change these settings.
        </p>
      )}
      <form onSubmit={save} className="mt-4 space-y-4">
        <div className="mt-2">{node}</div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="org-name">
              Name
            </label>
            <input
              id="org-name"
              className="input"
              disabled={!canManage}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor="org-slug">
              Slug
            </label>
            <input
              id="org-slug"
              className="input bg-zinc-50"
              value={form.slug}
              disabled
              readOnly
            />
          </div>
          <div>
            <label className="label" htmlFor="org-tz">
              Timezone
            </label>
            <input
              id="org-tz"
              className="input"
              disabled={!canManage}
              value={form.timezone}
              onChange={(e) => setForm({ ...form, timezone: e.target.value })}
            />
          </div>
        </div>

        <fieldset className="space-y-2" disabled={!canManage}>
          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={form.ssoEnabled}
              disabled={!ssoConfigured || !canManage}
              onChange={(e) =>
                setForm({ ...form, ssoEnabled: e.target.checked })
              }
            />
            Enable SAML single sign-on
            {!ssoConfigured && (
              <span className="text-xs text-zinc-400">
                (not configured on this deployment)
              </span>
            )}
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={form.ssoEnforced}
              disabled={!form.ssoEnabled || !canManage}
              onChange={(e) =>
                setForm({ ...form, ssoEnforced: e.target.checked })
              }
            />
            Require SSO for all members
          </label>
        </fieldset>

        {canManage && (
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Save organization settings"}
          </button>
        )}
      </form>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Personal settings                                                          */
/* -------------------------------------------------------------------------- */

export function UserSettings({
  hasPassword,
  user,
}: {
  hasPassword: boolean;
  user: {
    name: string;
    email: string;
    notifyBilling: boolean;
    notifyProduct: boolean;
  };
}) {
  const router = useRouter();
  const { flash, node } = useFlash();
  const [form, setForm] = useState({
    name: user.name,
    notifyBilling: user.notifyBilling,
    notifyProduct: user.notifyProduct,
  });
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const body: Record<string, unknown> = { ...form };
    if (newPassword) {
      body.currentPassword = currentPassword;
      body.newPassword = newPassword;
    }
    const res = await apiFetch("/api/settings/user", {
      method: "PATCH",
      body,
    });
    setBusy(false);
    if (res.ok) {
      flash("ok", "Your settings were saved.");
      setCurrentPassword("");
      setNewPassword("");
      router.refresh();
    } else flash("err", res.error ?? "Could not save settings.");
  }

  return (
    <div className="card">
      <h2 className="font-semibold text-zinc-900">Your profile</h2>
      <form onSubmit={save} className="mt-4 space-y-4">
        <div className="mt-2">{node}</div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="me-name">
              Name
            </label>
            <input
              id="me-name"
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor="me-email">
              Email
            </label>
            <input
              id="me-email"
              className="input bg-zinc-50"
              value={user.email}
              disabled
              readOnly
            />
          </div>
        </div>

        <div className="space-y-2">
          <p className="label">Email notifications</p>
          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={form.notifyBilling}
              onChange={(e) =>
                setForm({ ...form, notifyBilling: e.target.checked })
              }
            />
            Billing updates
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={form.notifyProduct}
              onChange={(e) =>
                setForm({ ...form, notifyProduct: e.target.checked })
              }
            />
            Product news
          </label>
        </div>

        {hasPassword && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="cur-pw">
                Current password
              </label>
              <input
                id="cur-pw"
                type="password"
                autoComplete="current-password"
                className="input"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="new-pw">
                New password
              </label>
              <input
                id="new-pw"
                type="password"
                autoComplete="new-password"
                className="input"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <p className="mt-1 text-xs text-zinc-400">
                Leave blank to keep your current password.
              </p>
            </div>
          </div>
        )}

        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Saving…" : "Save my settings"}
        </button>
      </form>
    </div>
  );
}
