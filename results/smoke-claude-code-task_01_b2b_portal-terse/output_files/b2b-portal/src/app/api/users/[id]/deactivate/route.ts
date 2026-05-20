import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/guard";
import { audit } from "@/lib/audit";

export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const auth = await requirePermission("users:deactivate");
  if (auth instanceof NextResponse) return auth;

  if (params.id === auth.userId) {
    return NextResponse.json(
      { error: "You cannot deactivate yourself" },
      { status: 403 },
    );
  }

  const target = await db.membership.findFirst({
    where: { userId: params.id, orgId: auth.orgId },
    include: { user: true },
  });
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  // Don't allow removing the last owner — an org with no owner is unmanageable.
  if (target.role === "OWNER") {
    const owners = await db.membership.count({
      where: { orgId: auth.orgId, role: "OWNER" },
    });
    if (owners <= 1) {
      return NextResponse.json(
        { error: "Cannot deactivate the last owner" },
        { status: 409 },
      );
    }
  }

  await db.$transaction([
    db.user.update({ where: { id: params.id }, data: { isActive: false } }),
    // Revoke active sessions so deactivation takes effect immediately.
    db.session.deleteMany({ where: { userId: params.id } }),
  ]);
  await audit(auth, "users.deactivate", { targetUserId: params.id });

  return NextResponse.json({ ok: true });
}
