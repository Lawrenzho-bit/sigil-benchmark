/** Settings — organization settings (ADMIN+) and personal settings (everyone). */
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { ssoConfigured } from "@/lib/env";
import { OrgSettings, UserSettings } from "./settings-client";

export default async function SettingsPage() {
  const { user, organization } = await requireUser();
  const canManageOrg = can(user.role, "settings:manage_org");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900">Settings</h1>
        <p className="text-sm text-zinc-500">
          Organization and personal preferences.
        </p>
      </div>

      <OrgSettings
        canManage={canManageOrg}
        ssoConfigured={ssoConfigured}
        org={{
          name: organization.name,
          slug: organization.slug,
          timezone: organization.timezone,
          ssoEnabled: organization.ssoEnabled,
          ssoEnforced: organization.ssoEnforced,
        }}
      />

      <UserSettings
        hasPassword={!!user.passwordHash}
        user={{
          name: user.name,
          email: user.email,
          notifyBilling: user.notifyBilling,
          notifyProduct: user.notifyProduct,
        }}
      />
    </div>
  );
}
