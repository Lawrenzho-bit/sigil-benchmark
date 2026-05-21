import Link from "next/link";
import type { Role } from "@prisma/client";
import { can, ROLE_LABELS } from "@/lib/rbac";
import { SignOutButton } from "@/components/sign-out-button";

interface NavProps {
  user: { name: string; email: string; role: Role };
  orgName: string;
}

interface NavItem {
  href: string;
  label: string;
  visible: boolean;
}

/** Sidebar navigation. Links are filtered by the viewer's capabilities. */
export function Nav({ user, orgName }: NavProps) {
  const items: NavItem[] = [
    { href: "/dashboard", label: "Dashboard", visible: true },
    { href: "/users", label: "Users", visible: can.manageUsers(user.role) },
    { href: "/billing", label: "Billing", visible: can.manageBilling(user.role) },
    { href: "/audit", label: "Audit log", visible: can.viewAuditLog(user.role) },
    { href: "/settings", label: "Settings", visible: true },
  ];

  return (
    <aside className="flex w-60 flex-col border-r border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Workspace</p>
        <p className="truncate font-semibold text-gray-900">{orgName}</p>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {items
          .filter((i) => i.visible)
          .map((i) => (
            <Link
              key={i.href}
              href={i.href}
              className="block rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              {i.label}
            </Link>
          ))}
      </nav>

      <div className="border-t border-gray-200 px-4 py-4">
        <p className="truncate text-sm font-medium text-gray-900">{user.name}</p>
        <p className="truncate text-xs text-gray-500">{user.email}</p>
        <span className="badge mt-2 bg-brand-100 text-brand-700">{ROLE_LABELS[user.role]}</span>
        <div className="mt-3">
          <SignOutButton />
        </div>
      </div>
    </aside>
  );
}
