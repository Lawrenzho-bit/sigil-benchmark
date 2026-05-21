/**
 * GET /api/audit — paginated audit log for the org. ADMIN+.
 * Query params: ?action=<action>&cursor=<id>&limit=<n>
 */
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import { ok, error, handle } from "@/lib/http";

export function GET(req: NextRequest) {
  return handle(async () => {
    const ctx = await getCurrentUser();
    if (!ctx) return error("Unauthorized", 401);
    assertCan(ctx.user.role, "audit:view");

    const url = req.nextUrl;
    const action = url.searchParams.get("action") ?? undefined;
    const cursor = url.searchParams.get("cursor") ?? undefined;
    const limit = Math.min(
      Math.max(Number(url.searchParams.get("limit") ?? 50), 1),
      200,
    );

    const rows = await prisma.auditLog.findMany({
      where: { organizationId: ctx.organization.id, action },
      orderBy: { createdAt: "desc" },
      take: limit + 1, // fetch one extra to detect the next page
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    return ok({
      items,
      nextCursor: hasMore ? items[items.length - 1]!.id : null,
    });
  });
}
