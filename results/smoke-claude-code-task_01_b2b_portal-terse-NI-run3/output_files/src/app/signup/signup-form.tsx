"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/components/forms";

export function SignupForm() {
  const router = useRouter();
  const [form, setForm] = useState({
    orgName: "",
    name: "",
    email: "",
    password: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function set(key: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await apiFetch<{ redirectTo: string }>("/api/auth/signup", {
      method: "POST",
      body: form,
    });
    setLoading(false);
    if (res.ok) {
      router.push(res.data.redirectTo || "/dashboard");
      router.refresh();
    } else {
      setError(res.error ?? "Could not create your organization.");
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="label" htmlFor="orgName">
          Organization name
        </label>
        <input id="orgName" required className="input" value={form.orgName} onChange={set("orgName")} />
      </div>
      <div>
        <label className="label" htmlFor="name">
          Your name
        </label>
        <input id="name" required className="input" value={form.name} onChange={set("name")} />
      </div>
      <div>
        <label className="label" htmlFor="email">
          Work email
        </label>
        <input id="email" type="email" autoComplete="email" required className="input" value={form.email} onChange={set("email")} />
      </div>
      <div>
        <label className="label" htmlFor="password">
          Password
        </label>
        <input id="password" type="password" autoComplete="new-password" required className="input" value={form.password} onChange={set("password")} />
        <p className="mt-1 text-xs text-zinc-400">
          At least 10 characters, with upper, lower and a number.
        </p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" className="btn-primary w-full" disabled={loading}>
        {loading ? "Creating…" : "Create organization"}
      </button>
    </form>
  );
}
