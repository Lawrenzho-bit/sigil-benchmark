import Link from "next/link";
import { prisma } from "@/lib/db";
import { hashToken } from "@/lib/tokens";
import { AcceptForm } from "./accept-form";

/** Renders the invite-acceptance flow after validating the token server-side. */
export default async function InvitePage({
  params,
}: {
  params: { token: string };
}) {
  const invite = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(params.token) },
    include: { organization: { select: { name: true } } },
  });

  let problem: string | null = null;
  if (!invite) problem = "This invitation link is invalid.";
  else if (invite.acceptedAt) problem = "This invitation has already been used.";
  else if (invite.expiresAt < new Date())
    problem = "This invitation has expired. Ask an admin to send a new one.";

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-10">
      <div className="w-full max-w-sm">
        {problem ? (
          <div className="card text-center">
            <h1 className="text-lg font-semibold text-zinc-900">
              Invitation unavailable
            </h1>
            <p className="mt-2 text-sm text-zinc-500">{problem}</p>
            <Link href="/login" className="btn-secondary mt-4">
              Go to sign in
            </Link>
          </div>
        ) : (
          <>
            <h1 className="mb-1 text-2xl font-bold text-zinc-900">
              Join {invite!.organization.name}
            </h1>
            <p className="mb-6 text-sm text-zinc-500">
              Set up your account for{" "}
              <span className="font-medium">{invite!.email}</span> (role:{" "}
              {invite!.role.toLowerCase()}).
            </p>
            <AcceptForm token={params.token} />
          </>
        )}
      </div>
    </main>
  );
}
