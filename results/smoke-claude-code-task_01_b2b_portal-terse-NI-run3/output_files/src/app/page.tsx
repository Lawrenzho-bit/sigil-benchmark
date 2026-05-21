/** Landing page: send signed-in users to the dashboard, others to login. */
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";

export default async function HomePage() {
  const ctx = await getCurrentUser();
  if (ctx) redirect("/dashboard");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="max-w-md text-center">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900">
          B2B Portal
        </h1>
        <p className="mt-3 text-zinc-600">
          Authentication, role-based access, subscription billing and a full
          audit trail — everything your team needs in one place.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/signup" className="btn-primary">
            Create an organization
          </Link>
          <Link href="/login" className="btn-secondary">
            Sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
