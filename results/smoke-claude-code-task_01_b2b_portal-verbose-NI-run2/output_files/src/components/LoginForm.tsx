'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Client-side login form. Posts to /api/auth/login; handles the multi-step
 * cases the API can return (MFA required, multiple orgs).
 */
export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [mfaNeeded, setMfaNeeded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, totp: totp || undefined }),
      });
      const data = await res.json();

      if (res.ok) {
        router.push('/dashboard');
        return;
      }
      if (data.error === 'mfa_required') {
        setMfaNeeded(true);
        setError('Enter the 6-digit code from your authenticator app.');
        return;
      }
      setError(data.message ?? 'Sign-in failed.');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <label>
        Email
        <input
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </label>
      <label style={{ display: 'block', marginTop: '0.75rem' }}>
        Password
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </label>
      {mfaNeeded && (
        <label style={{ display: 'block', marginTop: '0.75rem' }}>
          Authentication code
          <input
            inputMode="numeric"
            pattern="\d{6}"
            value={totp}
            onChange={(e) => setTotp(e.target.value)}
            required
          />
        </label>
      )}
      {error && (
        <p style={{ color: '#ff9a9a', fontSize: '0.85rem' }}>{error}</p>
      )}
      <button type="submit" disabled={busy} style={{ marginTop: '1rem', width: '100%' }}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
