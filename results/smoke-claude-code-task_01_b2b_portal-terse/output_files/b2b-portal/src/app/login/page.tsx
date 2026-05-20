"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setBusy(false);
    if (res.ok) {
      router.push("/dashboard");
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Login failed");
    }
  }

  return (
    <div style={{ maxWidth: 360, margin: "10vh auto" }}>
      <h1>Sign in</h1>
      <form onSubmit={onSubmit}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={{ display: "block", width: "100%", padding: 8, marginBottom: 8 }}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={{ display: "block", width: "100%", padding: 8, marginBottom: 8 }}
        />
        <button type="submit" disabled={busy} style={{ padding: "8px 16px" }}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      {error && <p style={{ color: "#b00" }}>{error}</p>}
      <p style={{ marginTop: 16, fontSize: 13, color: "#666" }}>
        SSO via SAML is a configured integration point — see src/lib/saml.ts.
      </p>
    </div>
  );
}
