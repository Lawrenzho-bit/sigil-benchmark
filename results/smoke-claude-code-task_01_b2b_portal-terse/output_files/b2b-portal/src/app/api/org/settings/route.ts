import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/guard";
import { audit } from "@/lib/audit";

export async function POST(req: Request) {
  const auth = await requirePermission("org:edit_settings");
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  if (!name || name.length > 200) {
    return NextResponse.json({ error: "Invalid name" }, { status: 400 });
  }

  await db.organization.update({
    where: { id: auth.orgId },
    data: { name },
  });
  await audit(auth, "org.update_settings", { name });

  return NextResponse.json({ ok: true });
}
