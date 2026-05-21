import { redirect } from "next/navigation";
import { completeSsoLogin } from "../actions";

/**
 * SSO completion step. The SAML ACS endpoint verifies the IdP assertion and
 * redirects here with a short-lived bridge ticket; submitting the form
 * exchanges that ticket for an application session.
 */
export default function SsoCompletePage({
  searchParams,
}: {
  searchParams: { ticket?: string };
}) {
  const ticket = searchParams.ticket;
  if (!ticket) redirect("/login?error=sso");

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-sm text-center">
        <h1 className="mb-2 text-lg font-semibold">Single sign-on verified</h1>
        <p className="mb-5 text-sm text-gray-500">
          Your identity provider confirmed your identity. Continue to finish signing in.
        </p>
        <form action={completeSsoLogin}>
          <input type="hidden" name="ticket" value={ticket} />
          <button type="submit" className="btn-primary w-full">Continue</button>
        </form>
      </div>
    </main>
  );
}
