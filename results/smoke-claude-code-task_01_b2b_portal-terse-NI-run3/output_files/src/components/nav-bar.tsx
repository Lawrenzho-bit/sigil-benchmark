"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { apiFetch } from "@/components/forms";
import type { Role } from "@prisma/client";

interface NavItem {
  href: string;
  label: string;
  /** Minimum role to see this link; omitted = everyone. */
  minRole?: Role;
}

const RANK: Record<Role, number> = { VIEWER: 1, ADMIN: 2, OWNER: 3 };

const ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/users", label: "Users" },
  { href: "/billing", label: "Billing", minRole: "ADMIN" },
  { href: "/audit", label: "Audit log", minRole: "ADMIN" },
  { href: "/settings", label: "Settings" },
];

export function NavBar({
  orgName,
  userName,
  role,
}: {
  orgName: string;
  userName: string;
  role: Role;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await apiFetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const visible = ITEMS.filter(
    (i) => !i.minRole || RANK[role] >= RANK[i.minRole],
  );

  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-6">
          <span className="font-semibold text-brand-700">{orgName}</span>
          <nav className="flex gap-1">
            {visible.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                    active
                      ? "bg-brand-50 text-brand-700"
                      : "text-zinc-600 hover:bg-zinc-100"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-zinc-500">
            {userName}{" "}
            <span className="badge bg-zinc-100 text-zinc-600">
              {role.toLowerCase()}
            </span>
          </span>
          <button onClick={logout} className="btn-secondary !px-3 !py-1.5">
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
