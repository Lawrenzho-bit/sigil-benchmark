import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { inviteEmail } from "@/lib/email";
import { isRole } from "@/lib/rbac";

const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7;

export async function POST(req: Request) {
  const auth = await requirePermission("users:invite");
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? "").trim().toLowerCase();
  const role = String(body.role ?? "").toLowerCase();

  if (!email || !isRole(role)) {
    return NextResponse.json({ error: "Valid email and role required" }, { status: 400 });
  }
  // Only an owner may invite another owner (mirrors the role-change rule).
  if (role === "owner" && auth.role !== "owner") {
    return NextResponse.json(
      { error: "Only an owner may invite an owner" },
      { status: 403 },
    );
  }

  const token = randomBytes(32).toString("base64url");
  const invite = await db.invite.upsert({
    where: { orgId_email: { orgId: auth.orgId, email } },
    create: {
      email,
      role: role.toUpperCase() as "OWNER" | "ADMIN" | "VIEWER",
      orgId: auth.orgId,
      token,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    },
    update: {
      role: role.toUpperCase() as "OWNER" | "ADMIN" | "VIEWER",
      token,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      acceptedAt: null,
    },
  });

  await audit(auth, "users.invite", { email, role });

  const acceptUrl = `${process.env.APP_URL ?? ""}/invite/${token}`;
  await inviteEmail(email, "your organization", acceptUrl);

  return NextResponse.json({ ok: true, inviteId: invite.id });
}
