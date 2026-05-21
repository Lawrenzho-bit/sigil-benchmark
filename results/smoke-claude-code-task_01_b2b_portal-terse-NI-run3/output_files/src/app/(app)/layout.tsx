/** Authenticated shell — nav bar + page container. */
import { requireUser } from "@/lib/auth";
import { NavBar } from "@/components/nav-bar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, organization } = await requireUser();

  return (
    <div className="min-h-screen">
      <NavBar
        orgName={organization.name}
        userName={user.name}
        role={user.role}
      />
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
