import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { LoginForm } from '@/components/LoginForm';

/**
 * Landing / sign-in page. If already authenticated, go straight to the
 * dashboard. This is a server component so the session check happens before
 * any HTML is sent.
 */
export default async function HomePage() {
  const session = await getSession();
  if (session) redirect('/dashboard');

  return (
    <main className="container">
      <h1>B2B SaaS Portal</h1>
      <p className="muted">
        Sign in to manage your organization, users, and billing.
      </p>
      <div className="panel" style={{ maxWidth: 380, marginTop: '1.5rem' }}>
        <LoginForm />
      </div>
      <p className="muted" style={{ marginTop: '2rem', fontSize: '0.85rem' }}>
        <a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms of Service</a>
      </p>
    </main>
  );
}
