import type { AdminActionType, ReportTargetType } from "@prisma/client";
import { prisma } from "../../db/client.js";
import { NotFound } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { setReviewHidden } from "../reviews/reviews.service.js";

// Writes an immutable audit-log entry for every privileged action.
async function audit(
  actorId: string,
  type: AdminActionType,
  targetId: string,
  note?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await prisma.adminAction.create({ data: { actorId, type, targetId, note, metadata } });
}

// ---- DSA "notice and action" (Article 16) ----

// Anyone may report content. Reports queue for moderator review.
export async function fileReport(input: {
  reporterId?: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: string;
  detail?: string;
}) {
  return prisma.contentReport.create({ data: input });
}

export async function listPendingReports() {
  return prisma.contentReport.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
  });
}

// Resolving a report records a DSA Article 17 "statement of reasons".
export async function resolveReport(input: {
  adminId: string;
  reportId: string;
  action: "ACTIONED" | "DISMISSED";
  statementOfReasons: string;
}) {
  const report = await prisma.contentReport.findUnique({ where: { id: input.reportId } });
  if (!report) throw NotFound("Report not found");

  // If actioned, take down the underlying content.
  if (input.action === "ACTIONED") {
    if (report.targetType === "LISTING") {
      await prisma.listing.update({ where: { id: report.targetId }, data: { status: "REMOVED" } });
      await audit(input.adminId, "REMOVE_LISTING", report.targetId, input.statementOfReasons);
    } else if (report.targetType === "REVIEW") {
      await setReviewHidden(report.targetId, true);
      await audit(input.adminId, "HIDE_REVIEW", report.targetId, input.statementOfReasons);
    }
  }

  const updated = await prisma.contentReport.update({
    where: { id: input.reportId },
    data: {
      status: input.action,
      statementOfReasons: input.statementOfReasons,
      reviewedById: input.adminId,
      reviewedAt: new Date(),
    },
  });
  await audit(input.adminId, "RESOLVE_REPORT", input.reportId, input.statementOfReasons);
  logger.info({ reportId: input.reportId, action: input.action }, "Content report resolved");
  return updated;
}

// ---- Direct moderation actions ----

export async function removeListing(adminId: string, listingId: string, reason: string) {
  const listing = await prisma.listing.update({
    where: { id: listingId },
    data: { status: "REMOVED" },
  });
  await audit(adminId, "REMOVE_LISTING", listingId, reason);
  return listing;
}

export async function suspendUser(adminId: string, userId: string, reason: string) {
  const user = await prisma.user.update({ where: { id: userId }, data: { status: "SUSPENDED" } });
  // Revoke active sessions so the suspension takes effect immediately.
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await audit(adminId, "SUSPEND_USER", userId, reason);
  return user;
}

export async function reinstateUser(adminId: string, userId: string, reason: string) {
  const user = await prisma.user.update({ where: { id: userId }, data: { status: "ACTIVE" } });
  await audit(adminId, "REINSTATE_USER", userId, reason);
  return user;
}
