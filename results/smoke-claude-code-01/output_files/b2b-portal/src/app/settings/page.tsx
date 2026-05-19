import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { can } from "@/lib/rbac";
import { db } from "@/lib/db";
import { Nav } from "../dashboard/page";
import { OrgSettingsForm, SelfSettingsForm } from "./ui";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!can(session.role, "org:view_settings")) redirect("/dashboard");

  const [org, user] = await Promise.all([
    db.organization.findUnique({ where: { id: session.orgId } }),
    db.user.findUnique({ where: { id: session.userId } }),
  ]);

  return (
    <div>
      <Nav role={session.role} email={session.email} />
      <h1>Settings</h1>

      <section style={{ marginBottom: 32 }}>
        <h2>Organization</h2>
        <OrgSettingsForm
          name={org?.name ?? ""}
          plan={org?.plan ?? "STARTER"}
          canEdit={can(session.role, "org:edit_settings")}
        />
        <p style={{ fontSize: 13, color: "#666" }}>
          Plan changes route through Stripe checkout — billing is a defined
          integration point (src/lib/stripe.ts), not yet live.
        </p>
      </section>

      <section>
        <h2>Your account</h2>
        <SelfSettingsForm name={user?.name ?? ""} email={user?.email ?? ""} />
      </section>
    </div>
  );
}
