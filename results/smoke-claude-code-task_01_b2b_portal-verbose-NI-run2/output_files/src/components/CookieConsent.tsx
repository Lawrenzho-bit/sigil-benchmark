'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'cookie-consent';

/**
 * GDPR cookie consent banner. Non-essential cookies (analytics, etc.) must
 * only be set AFTER an explicit opt-in — this is a functional opt-in, not a
 * pre-checked "by using this site you agree" notice.
 *
 * The strictly-necessary session cookie is exempt and is always set.
 * Code that loads analytics should gate on `hasAnalyticsConsent()`.
 */
export function CookieConsent() {
  const [decided, setDecided] = useState(true);

  useEffect(() => {
    setDecided(localStorage.getItem(STORAGE_KEY) !== null);
  }, []);

  if (decided) return null;

  const record = (analytics: boolean) => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ analytics, at: new Date().toISOString() }),
    );
    setDecided(true);
  };

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      style={{
        position: 'fixed',
        bottom: 16,
        left: 16,
        right: 16,
        maxWidth: 560,
        margin: '0 auto',
        background: 'var(--panel)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: '1rem 1.25rem',
      }}
    >
      <p style={{ marginTop: 0 }}>
        We use a strictly-necessary cookie to keep you signed in. With your
        consent we also use analytics cookies to improve the product. See our{' '}
        <a href="/privacy">Privacy Policy</a>.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => record(true)}>Accept analytics</button>
        <button
          onClick={() => record(false)}
          style={{ background: 'transparent', border: '1px solid var(--border)' }}
        >
          Necessary only
        </button>
      </div>
    </div>
  );
}

/** Read consent elsewhere before loading non-essential scripts. */
export function hasAnalyticsConsent(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw).analytics === true : false;
  } catch {
    return false;
  }
}
