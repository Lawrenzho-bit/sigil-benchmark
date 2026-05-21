/**
 * Bulk operations: validated CSV import of end users, and CSV export of users
 * and organizations. Imports are validated row-by-row; valid rows are applied
 * and invalid rows are reported without aborting the whole job.
 */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { asyncHandler } from '../http/asyncHandler';
import { parseBody, parseQuery } from '../http/validate';
import { paginationSchema, toPage, paginated } from '../http/pagination';
import { requirePermission, requireAnyPermission } from '../rbac/middleware';
import { auditFromRequest } from '../audit/audit';
import { parseCsv, toCsv } from '../util/csv';
import { badRequest } from '../errors';

export const bulkRouter = Router();

// --- Import end users -------------------------------------------------------

const importSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  csv: z.string().min(1).max(5_000_000), // ~5 MB ceiling for an internal tool
});

// Per-row shape. Unknown columns are ignored; missing required columns fail.
const rowSchema = z.object({
  orgSlug: z.string().trim().min(1),
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(1).max(200),
  orgRole: z.string().trim().max(50).optional(),
  status: z.enum(['ACTIVE', 'INVITED', 'DEACTIVATED']).optional(),
});

bulkRouter.post(
  '/import/users',
  requirePermission('bulk:import', 'users:write'),
  asyncHandler(async (req, res) => {
    const input = parseBody(importSchema, req.body);
    const rows = parseCsv(input.csv);
    if (rows.length === 0) throw badRequest('CSV contained no data rows');
    if (rows.length > 10_000) throw badRequest('Import limited to 10,000 rows per job');

    // Resolve org slugs up front so we do one lookup per distinct slug.
    const slugs = [...new Set(rows.map((r) => (r.orgSlug ?? '').trim()).filter(Boolean))];
    const orgs = await prisma.organization.findMany({ where: { slug: { in: slugs } } });
    const orgBySlug = new Map(orgs.map((o) => [o.slug, o]));

    const errors: { row: number; message: string }[] = [];
    let successRows = 0;

    for (let i = 0; i < rows.length; i++) {
      const lineNo = i + 2; // +1 for header, +1 for 1-based numbering
      const parsed = rowSchema.safeParse(rows[i]);
      if (!parsed.success) {
        errors.push({
          row: lineNo,
          message: Object.entries(parsed.error.flatten().fieldErrors)
            .map(([f, m]) => `${f}: ${m?.join(', ')}`)
            .join('; '),
        });
        continue;
      }
      const org = orgBySlug.get(parsed.data.orgSlug);
      if (!org) {
        errors.push({ row: lineNo, message: `Unknown organization slug "${parsed.data.orgSlug}"` });
        continue;
      }
      try {
        await prisma.endUser.upsert({
          where: { orgId_email: { orgId: org.id, email: parsed.data.email } },
          update: {
            name: parsed.data.name,
            orgRole: parsed.data.orgRole ?? undefined,
            status: parsed.data.status ?? undefined,
          },
          create: {
            orgId: org.id,
            email: parsed.data.email,
            name: parsed.data.name,
            orgRole: parsed.data.orgRole ?? 'member',
            status: parsed.data.status ?? 'ACTIVE',
          },
        });
        successRows++;
      } catch (err) {
        errors.push({ row: lineNo, message: `Database error: ${(err as Error).message}` });
      }
    }

    const job = await prisma.bulkJob.create({
      data: {
        type: 'end_user.import',
        status: errors.length > 0 && successRows === 0 ? 'FAILED' : 'COMPLETED',
        fileName: input.fileName,
        totalRows: rows.length,
        successRows,
        errorRows: errors.length,
        errors: errors.slice(0, 500), // cap stored detail
        createdById: req.actor!.adminUserId,
      },
    });

    await auditFromRequest(req, {
      action: 'bulk.import.users',
      targetType: 'BulkJob',
      targetId: job.id,
      targetLabel: input.fileName,
      metadata: { totalRows: rows.length, successRows, errorRows: errors.length },
    });

    res.status(errors.length > 0 ? 207 : 201).json(job);
  }),
);

// --- Exports ----------------------------------------------------------------

function sendCsv(res: import('express').Response, filename: string, body: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(body);
}

bulkRouter.get(
  '/export/users',
  requirePermission('bulk:export'),
  asyncHandler(async (req, res) => {
    const scope = req.actor?.orgScopeId;
    const users = await prisma.endUser.findMany({
      where: scope ? { orgId: scope } : {},
      include: { org: { select: { slug: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const cols = ['orgSlug', 'email', 'name', 'orgRole', 'status', 'createdAt'];
    const body = toCsv(
      users.map((u) => ({
        orgSlug: u.org.slug,
        email: u.email,
        name: u.name,
        orgRole: u.orgRole,
        status: u.status,
        createdAt: u.createdAt.toISOString(),
      })),
      cols,
    );
    await auditFromRequest(req, {
      action: 'bulk.export.users',
      metadata: { rowCount: users.length },
    });
    sendCsv(res, 'end-users.csv', body);
  }),
);

bulkRouter.get(
  '/export/orgs',
  requirePermission('bulk:export'),
  asyncHandler(async (req, res) => {
    const orgs = await prisma.organization.findMany({ orderBy: { name: 'asc' } });
    const cols = ['slug', 'name', 'plan', 'status', 'region', 'seats', 'createdAt'];
    const body = toCsv(
      orgs.map((o) => ({
        slug: o.slug,
        name: o.name,
        plan: o.plan,
        status: o.status,
        region: o.region,
        seats: o.seats,
        createdAt: o.createdAt.toISOString(),
      })),
      cols,
    );
    await auditFromRequest(req, { action: 'bulk.export.orgs', metadata: { rowCount: orgs.length } });
    sendCsv(res, 'organizations.csv', body);
  }),
);

// --- Job history ------------------------------------------------------------

bulkRouter.get(
  '/jobs',
  requireAnyPermission('bulk:import', 'bulk:export'),
  asyncHandler(async (req, res) => {
    const query = parseQuery(paginationSchema, req.query);
    const page = toPage(query);
    const [items, total] = await Promise.all([
      prisma.bulkJob.findMany({
        skip: page.skip,
        take: page.take,
        orderBy: { createdAt: 'desc' },
        include: { createdBy: { select: { email: true } } },
      }),
      prisma.bulkJob.count(),
    ]);
    res.json(paginated(items, total, page));
  }),
);
