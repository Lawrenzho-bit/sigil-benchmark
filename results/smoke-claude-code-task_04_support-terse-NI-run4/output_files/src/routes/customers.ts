import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireAgent } from '../middleware/auth';
import { requireAdmin } from '../middleware/rbac';
import { audit } from '../lib/audit';
import { anonymizeCustomer, getCustomerHistory } from '../services/customerService';

/** Customer profile + GDPR endpoints — agent only. */
export const customersRouter = Router();
customersRouter.use(requireAgent);

/** Fuzzy customer lookup by email/name for the agent UI. */
customersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const term = z.string().min(1).max(200).parse(req.query.q);
    const customers = await query(
      `SELECT id, email, name, created_at
         FROM customers
        WHERE anonymized_at IS NULL
          AND (email::text ILIKE $1 OR coalesce(name,'') ILIKE $1)
        ORDER BY created_at DESC
        LIMIT 25`,
      [`%${term}%`],
    );
    res.json({ customers });
  }),
);

/** Full customer profile: attributes + complete ticket history + CSAT. */
customersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    res.json(await getCustomerHistory(id));
  }),
);

/**
 * GDPR right-to-erasure. Admin-only and irreversible — direct identifiers are
 * scrubbed while ticket/SLA rows are retained for reporting integrity.
 */
customersRouter.post(
  '/:id/anonymize',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    await anonymizeCustomer(id);
    await audit({
      actorType: 'agent',
      actorId: req.principal!.id,
      action: 'customer.anonymize',
      entityType: 'customer',
      entityId: id,
      ip: req.ip,
    });
    res.json({ ok: true });
  }),
);

export default customersRouter;
