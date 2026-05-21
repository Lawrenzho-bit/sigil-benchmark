"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { sendInviteEmail } from "@/lib/email";
import { PLANS } from "@/lib/plans";

export interface ActionResult {
  ok: boolean;
  message: string;
}

const roleSchema = z.enum(["OWNER", "ADMIN", "VIEWER"]);

/** Seats currently consumed = active users + outstanding invites. */
async function seatsAvailable(orgId: string, plan: keyof typeof PLANS): Promise<boolean> {
  const limit = PLANS[plan].seatLimit;
  if (limit === null) return true;
  const [active, pending] = await Promise.all([
    prisma.user.count({ where: { orgId, active: true } }),
    prisma.invite.count({ where: { orgId, acceptedAt: null } }),
  ]);
  return active + pending < limit;
}

// --- Invite a new user ------------------------------------------------------
export async function inviteUser(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const actor = await requireRole("ADMIN");

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const roleParse = roleSchema.safeParse(formData.get("role"));
  if (!z.string().email().safeParse(email).success) {
    return { ok: false, message: "Enter a valid email address." };
  }
  if (!roleParse.success) return { ok: false, message: "Select a valid role." };
  const role = roleParse.data;

  // Only owners can grant the owner role.
  if (role === "OWNER" && actor.role !== "OWNER") {
    return { ok: false, message: "Only an owner can invite another owner." };
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return { ok: false, message: "That email already has an account." };
  const dupeInvite = await prisma.invite.findUnique({
    where: { orgId_email: { orgId: actor.orgId, email } },
  });
  if (dupeInvite && !dupeInvite.acceptedAt) {
    return { ok: false, message: "An invitation is already pending for that email." };
  }

  if (!(await seatsAvailable(actor.orgId, actor.organization.plan))) {
    return { ok: false, message: "Seat limit reached for your plan. Upgrade in Billing." };
  }

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await prisma.invite.upsert({
    where: { orgId_email: { orgId: actor.orgId, email } },
    update: { role, token, expiresAt, acceptedAt: null, invitedById: actor.id },
    create: { email, role, token, expiresAt, orgId: actor.orgId, invitedById: actor.id },
  });

  await sendInviteEmail(email, actor.organization.name, token);
  await recordAudit({
    orgId: actor.orgId,
    actorId: actor.id,
    actorEmail: actor.email,
    action: "user.invited",
    targetType: "invite",
    metadata: { email, role },
  });

  revalidatePath("/users");
  return { ok: true, message: `Invitation sent to ${email}.` };
}

// --- Change a user's role ---------------------------------------------------
export async function changeRole(formData: FormData): Promise<void> {
  const actor = await requireRole("ADMIN");
  const userId = String(formData.get("userId") ?? "");
  const role = roleSchema.parse(formData.get("role"));

  const target = await prisma.user.findFirst({ where: { id: userId, orgId: actor.orgId } });
  if (!target || target.id === actor.id) return;

  // Owner role transitions are restricted to owners.
  if ((role === "OWNER" || target.role === "OWNER") && actor.role !== "OWNER") return;

  // Never leave the org without an owner.
  if (target.role === "OWNER" && role !== "OWNER") {
    const owners = await prisma.user.count({
      where: { orgId: actor.orgId, role: "OWNER", active: true },
    });
    if (owners <= 1) return;
  }

  await prisma.user.update({ where: { id: userId }, data: { role } });
  await recordAudit({
    orgId: actor.orgId,
    actorId: actor.id,
    actorEmail: actor.email,
    action: "user.role_changed",
    targetType: "user",
    targetId: userId,
    metadata: { email: target.email, from: target.role, to: role },
  });
  revalidatePath("/users");
}

// --- Activate / deactivate a user ------------------------------------------
export async function setUserActive(formData: FormData): Promise<void> {
  const actor = await requireRole("ADMIN");
  const userId = String(formData.get("userId") ?? "");
  const active = formData.get("active") === "true";

  const target = await prisma.user.findFirst({ where: { id: userId, orgId: actor.orgId } });
  if (!target || target.id === actor.id) return; // can't deactivate yourself

  if (!active && target.role === "OWNER") {
    const owners = await prisma.user.count({
      where: { orgId: actor.orgId, role: "OWNER", active: true },
    });
    if (owners <= 1) return; // keep at least one active owner
  }

  if (active && !(await seatsAvailable(actor.orgId, actor.organization.plan))) {
    return; // would exceed seat limit
  }

  await prisma.user.update({ where: { id: userId }, data: { active } });
  await recordAudit({
    orgId: actor.orgId,
    actorId: actor.id,
    actorEmail: actor.email,
    action: active ? "user.reactivated" : "user.deactivated",
    targetType: "user",
    targetId: userId,
    metadata: { email: target.email },
  });
  revalidatePath("/users");
}

// --- Revoke a pending invite ------------------------------------------------
export async function revokeInvite(formData: FormData): Promise<void> {
  const actor = await requireRole("ADMIN");
  const inviteId = String(formData.get("inviteId") ?? "");

  const invite = await prisma.invite.findFirst({ where: { id: inviteId, orgId: actor.orgId } });
  if (!invite) return;

  await prisma.invite.delete({ where: { id: inviteId } });
  await recordAudit({
    orgId: actor.orgId,
    actorId: actor.id,
    actorEmail: actor.email,
    action: "invite.revoked",
    targetType: "invite",
    targetId: inviteId,
    metadata: { email: invite.email },
  });
  revalidatePath("/users");
}
