import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { isRole, roleChangeForbiddenReason, type Role } from "@/lib/rbac";

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const auth = await requirePermission("users:change_role");
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => ({}));
  const newRole = String(body.role ?? "").toLowerCase();
  if (!isRole(newRole)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  // Scope the lookup to the actor's org — a user cannot touch memberships
  // in another tenant even with a valid id.
  const target = await db.membership.findFirst({
    where: { userId: params.id, orgId: auth.orgId },
  });
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (target.userId === auth.userId) {
    return NextResponse.json(
      { error: "You cannot change your own role" },
      { status: 403 },
    );
  }

  const currentRole = target.role.toLowerCase() as Role;
  const forbidden = roleChangeForbiddenReason(auth.role, currentRole, newRole);
  if (forbidden) {
    return NextResponse.json({ error: forbidden }, { status: 403 });
  }

  await db.membership.update({
    where: { id: target.id },
    data: { role: newRole.toUpperCase() as "OWNER" | "ADMIN" | "VIEWER" },
  });
  await audit(auth, "users.change_role", {
    targetUserId: params.id,
    from: currentRole,
    to: newRole,
  });

  return NextResponse.json({ ok: true });
}
