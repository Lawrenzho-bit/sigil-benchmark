"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/components/forms";

export function AcceptForm({ token }: { token: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await apiFetch<{ redirectTo: string }>(
      "/api/auth/accept-invite",
      { method: "POST", body: { token, name, password } },
    );
    setLoading(false);
    if (res.ok) {
      router.push(res.data.redirectTo || "/dashboard");
      router.refresh();
    } else {
      setError(res.error ?? "Could not accept the invitation.");
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="label" htmlFor="name">
          Your name
        </label>
        <input id="name" required className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="password">
          Choose a password
        </label>
        <input id="password" type="password" autoComplete="new-password" required className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
        <p className="mt-1 text-xs text-zinc-400">
          At least 10 characters, with upper, lower and a number.
        </p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" className="btn-primary w-full" disabled={loading}>
        {loading ? "Joining…" : "Accept invitation"}
      </button>
    </form>
  );
}
