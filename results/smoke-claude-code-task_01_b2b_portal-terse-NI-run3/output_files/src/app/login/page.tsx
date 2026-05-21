import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { ssoConfigured } from "@/lib/env";
import { LoginForm } from "./login-form";

const ERRORS: Record<string, string> = {
  sso_unavailable: "Single sign-on is not enabled for this deployment.",
  sso_failed: "Single sign-on failed. Please try again.",
  sso_no_email: "Your identity provider did not return an email address.",
  sso_no_account:
    "No account found for your SSO identity. Ask an admin to invite you.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string; next?: string };
}) {
  if (await getCurrentUser()) redirect("/dashboard");
  const errorMsg = searchParams.error ? ERRORS[searchParams.error] : undefined;

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-bold text-zinc-900">Sign in</h1>
        <p className="mb-6 text-sm text-zinc-500">
          Welcome back to B2B Portal.
        </p>
        {errorMsg && (
          <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {errorMsg}
          </div>
        )}
        <LoginForm ssoEnabled={ssoConfigured} next={searchParams.next} />
        <p className="mt-6 text-center text-sm text-zinc-500">
          Need an organization?{" "}
          <Link href="/signup" className="font-medium text-brand-600">
            Create one
          </Link>
        </p>
      </div>
    </main>
  );
}
