import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import { features } from "@/lib/env";
import { loginWithPassword } from "./actions";

const ERRORS: Record<string, string> = {
  invalid: "Incorrect email or password.",
  missing: "Please enter your email and password.",
  sso: "Single sign-on failed. Contact your administrator.",
  forbidden: "You don't have access to that page.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  // Already signed in — skip the form.
  if (await currentUser()) redirect("/dashboard");

  const error = searchParams.error ? ERRORS[searchParams.error] : null;

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-center text-2xl font-bold text-gray-900">B2B Portal</h1>
        <p className="mb-6 text-center text-sm text-gray-500">Sign in to your workspace</p>

        <div className="card">
          {error && (
            <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}

          <form action={loginWithPassword} className="space-y-4">
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input id="email" name="email" type="email" autoComplete="email" required className="input" />
            </div>
            <div>
              <label className="label" htmlFor="password">Password</label>
              <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
            </div>
            <button type="submit" className="btn-primary w-full">Sign in</button>
          </form>

          {features.saml && (
            <>
              <div className="my-4 flex items-center gap-3 text-xs text-gray-400">
                <span className="h-px flex-1 bg-gray-200" />
                OR
                <span className="h-px flex-1 bg-gray-200" />
              </div>
              <Link href="/api/saml/login" className="btn-secondary w-full">
                Sign in with SSO
              </Link>
            </>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-gray-400">
          Have an invitation? Use the link in your invite email to set up your account.
        </p>
      </div>
    </main>
  );
}
