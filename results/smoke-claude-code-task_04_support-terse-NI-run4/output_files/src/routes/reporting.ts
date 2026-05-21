import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireAgent } from '../middleware/auth';
import { requireTeamLead } from '../middleware/rbac';
import {
  agentPerformance,
  backlogSnapshot,
  slaCompliance,
  ticketVolumeTrend,
} from '../services/reportingService';

/**
 * Reporting API. Aggregated reports are restricted to team leads and admins
 * (SOC2 access controls); the live backlog snapshot is open to any agent.
 */
export const reportingRouter = Router();
reportingRouter.use(requireAgent);

/** Parse ?from / ?to, defaulting to the last 30 days. */
const rangeSchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .transform(({ from, to }) => {
    const end = to ?? new Date();
    const start = from ?? new Date(end.getTime() - 30 * 24 * 3600 * 1000);
    return { from: start, to: end };
  });

reportingRouter.get(
  '/agent-performance',
  requireTeamLead,
  asyncHandler(async (req, res) => {
    res.json({ rows: await agentPerformance(rangeSchema.parse(req.query)) });
  }),
);

reportingRouter.get(
  '/sla-compliance',
  requireTeamLead,
  asyncHandler(async (req, res) => {
    res.json(await slaCompliance(rangeSchema.parse(req.query)));
  }),
);

reportingRouter.get(
  '/ticket-volume',
  requireTeamLead,
  asyncHandler(async (req, res) => {
    res.json({ trend: await ticketVolumeTrend(rangeSchema.parse(req.query)) });
  }),
);

/** Current open backlog by status + priority — available to all agents. */
reportingRouter.get(
  '/backlog',
  asyncHandler(async (_req, res) => {
    res.json({ backlog: await backlogSnapshot() });
  }),
);

export default reportingRouter;
