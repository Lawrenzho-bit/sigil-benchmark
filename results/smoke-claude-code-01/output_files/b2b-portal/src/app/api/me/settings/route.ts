import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/guard";

// self:edit_settings is granted to all roles — every user may edit their own
// profile. No audit entry: this is not an admin action over others.
export async function POST(req: Request) {
  const auth = await requirePermission("self:edit_settings");
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  if (name.length > 200) {
    return NextResponse.json({ error: "Name too long" }, { status: 400 });
  }

  await db.user.update({
    where: { id: auth.userId },
    data: { name: name || null },
  });
  return NextResponse.json({ ok: true });
}
