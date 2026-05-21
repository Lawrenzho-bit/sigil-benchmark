import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireAgent } from '../middleware/auth';
import { InboxSort, queryInbox } from '../services/inboxService';

export const inboxRouter = Router();
inboxRouter.use(requireAgent);

/** Comma-separated query param → typed array (e.g. ?status=new,open). */
const csv = <T extends string>(values: readonly T[]) =>
  z
    .string()
    .optional()
    .transform((s) => (s ? (s.split(',').map((v) => v.trim()) as T[]) : undefined))
    .refine((arr) => !arr || arr.every((v) => values.includes(v)), 'invalid filter value');

const querySchema = z.object({
  status: csv(['new', 'open', 'pending', 'on_hold', 'resolved', 'closed'] as const),
  priority: csv(['low', 'normal', 'high', 'urgent'] as const),
  assignment: z.enum(['me', 'unassigned', 'any']).optional(),
  assigneeId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  tag: z.string().max(50).optional(),
  search: z.string().max(200).optional(),
  slaBreached: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  sort: z
    .enum(['updated_desc', 'created_desc', 'created_asc', 'priority_desc', 'sla_due_asc'])
    .default('updated_desc'),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * Agent inbox: filter, sort, paginate tickets.
 *
 * Example: GET /inbox?status=new,open&priority=urgent&assignment=me&sort=sla_due_asc
 */
inboxRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = querySchema.parse(req.query);
    const page = await queryInbox(
      {
        status: q.status,
        priority: q.priority,
        assignment: q.assignment,
        assigneeId: q.assigneeId,
        teamId: q.teamId,
        tag: q.tag,
        search: q.search,
        slaBreached: q.slaBreached,
      },
      q.sort as InboxSort,
      q.limit,
      q.offset,
      req.principal!.id,
    );
    res.json(page);
  }),
);

export default inboxRouter;
