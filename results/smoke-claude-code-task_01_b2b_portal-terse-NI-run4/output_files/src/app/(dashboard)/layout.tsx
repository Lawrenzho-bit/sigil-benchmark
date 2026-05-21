import { requireUser } from "@/lib/session";
import { Nav } from "@/components/nav";

/** Shared chrome for every authenticated page. */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="flex min-h-screen">
      <Nav
        user={{ name: user.name, email: user.email, role: user.role }}
        orgName={user.organization.name}
      />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-8 py-8">{children}</div>
      </main>
    </div>
  );
}
