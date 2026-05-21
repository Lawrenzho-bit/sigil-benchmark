/**
 * System health dashboard: database latency, work-queue depths, error rates
 * and a derived SLA status.
 *
 * `GET /api/health` is permission-gated for the rich dashboard. `GET /healthz`
 * (wired in app.ts) is an unauthenticated liveness probe for orchestrators.
 */
import { Router } from 'express';
import { prisma } from '../db';
import { asyncHandler } from '../http/asyncHandler';
import { requirePermission } from '../rbac/middleware';
import { metricsSnapshot } from '../metrics';

export const healthRouter = Router();

/** Measure a trivial round-trip to Postgres. */
async function dbProbe(): Promise<{ ok: boolean; latencyMs: number }> {
  const t0 = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch {
    return { ok: false, latencyMs: Date.now() - t0 };
  }
}

/** Derive an overall SLA status from the component signals. */
function deriveStatus(signals: {
  dbOk: boolean;
  dbLatencyMs: number;
  errorRate: number;
  pendingJobs: number;
}): 'healthy' | 'degraded' | 'down' {
  if (!signals.dbOk) return 'down';
  if (signals.errorRate > 0.1 || signals.dbLatencyMs > 500 || signals.pendingJobs > 100) return 'degraded';
  if (signals.errorRate > 0.02 || signals.dbLatencyMs > 200 || signals.pendingJobs > 25) return 'degraded';
  return 'healthy';
}

healthRouter.get(
  '/',
  requirePermission('health:read'),
  asyncHandler(async (_req, res) => {
    const db = await dbProbe();
    const metrics = metricsSnapshot();

    const since = new Date(Date.now() - 60 * 60 * 1000);
    const [pendingJobs, failedJobs, recentAuditCount, orgCount, userCount] = await Promise.all([
      prisma.bulkJob.count({ where: { status: 'PENDING' } }),
      prisma.bulkJob.count({ where: { status: 'FAILED' } }),
      prisma.auditLog.count({ where: { createdAt: { gte: since } } }),
      prisma.organization.count(),
      prisma.endUser.count(),
    ]);

    const status = deriveStatus({
      dbOk: db.ok,
      dbLatencyMs: db.latencyMs,
      errorRate: metrics.window.errorRate,
      pendingJobs,
    });

    res.status(status === 'down' ? 503 : 200).json({
      status,
      checkedAt: new Date().toISOString(),
      database: db,
      queues: {
        // Bulk jobs are this tool's only real work queue.
        bulkJobsPending: pendingJobs,
        bulkJobsFailed: failedJobs,
      },
      errors: metrics.window,
      sla: {
        // Simple internal target; treat "degraded" as a paging condition.
        target: '99.5% / month',
        currentStatus: status,
      },
      activity: { auditEntriesLastHour: recentAuditCount },
      inventory: { organizations: orgCount, endUsers: userCount },
      process: { uptimeSeconds: metrics.uptimeSeconds, memory: metrics.memory },
    });
  }),
);
