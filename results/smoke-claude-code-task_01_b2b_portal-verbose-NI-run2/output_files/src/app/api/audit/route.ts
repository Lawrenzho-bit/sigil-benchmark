import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { handleRoute } from '@/lib/errors';
import { authorize } from '@/lib/authz';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  action: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * GET /api/audit — paginated, read-only view of the org's audit log.
 * Cursor-based pagination keeps it efficient over the 7-year retention window.
 */
export const GET = handleRoute(async (req) => {
  const session = await authorize('audit.view');
  const url = new URL(req.url);
  const q = querySchema.parse(Object.fromEntries(url.searchParams));

  const entries = await prisma.auditLog.findMany({
    where: { orgId: session.orgId, ...(q.action ? { action: q.action } : {}) },
    orderBy: { createdAt: 'desc' },
    take: q.limit + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });

  const hasMore = entries.length > q.limit;
  const page = hasMore ? entries.slice(0, q.limit) : entries;

  return NextResponse.json({
    entries: page,
    nextCursor: hasMore ? page[page.length - 1]!.id : null,
  });
});
