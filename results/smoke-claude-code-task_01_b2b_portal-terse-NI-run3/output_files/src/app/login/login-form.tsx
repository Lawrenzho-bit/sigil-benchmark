"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/components/forms";

export function LoginForm({
  ssoEnabled,
  next,
}: {
  ssoEnabled: boolean;
  next?: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await apiFetch<{ redirectTo: string }>("/api/auth/login", {
      method: "POST",
      body: { email, password },
    });
    setLoading(false);
    if (res.ok) {
      router.push(next || res.data.redirectTo || "/dashboard");
      router.refresh();
    } else {
      setError(res.error ?? "Sign in failed.");
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" className="btn-primary w-full" disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>

      {ssoEnabled && (
        <>
          <div className="flex items-center gap-3 text-xs text-zinc-400">
            <span className="h-px flex-1 bg-zinc-200" />
            OR
            <span className="h-px flex-1 bg-zinc-200" />
          </div>
          <a href="/api/auth/saml/login" className="btn-secondary w-full">
            Sign in with SSO
          </a>
        </>
      )}
    </div>
  );
}
