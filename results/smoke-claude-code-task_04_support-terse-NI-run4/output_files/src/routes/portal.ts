import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db';
import { forbidden } from '../errors';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireCustomer } from '../middleware/auth';
import {
  addMessage,
  createTicket,
  getTicketByPublicId,
  listMessages,
  Ticket,
  TicketMessage,
} from '../services/ticketService';

/**
 * Customer-facing web portal API.
 *
 * Tickets are addressed by `public_id` (a UUID) rather than the sequential
 * integer id, so customers can't enumerate other people's tickets. Every
 * handler additionally verifies the ticket belongs to the caller.
 */
export const portalRouter = Router();
portalRouter.use(requireCustomer);

/** Create a ticket from the portal. */
portalRouter.post(
  '/tickets',
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        subject: z.string().min(1).max(500),
        body: z.string().min(1).max(50_000),
        priority: z.enum(['low', 'normal']).optional(), // customers can't self-escalate
      })
      .parse(req.body);
    const ticket = await createTicket(
      {
        subject: input.subject,
        body: input.body,
        customerId: req.principal!.id,
        channel: 'web',
        priority: input.priority,
      },
      req.principal,
      req.ip,
    );
    res.status(201).json({ ticket: publicView(ticket) });
  }),
);

/** List the caller's own tickets. */
portalRouter.get(
  '/tickets',
  asyncHandler(async (req, res) => {
    const tickets = await query(
      `SELECT public_id, subject, status, priority, created_at, updated_at
         FROM tickets
        WHERE customer_id = $1 AND merged_into_id IS NULL
        ORDER BY updated_at DESC`,
      [req.principal!.id],
    );
    res.json({ tickets });
  }),
);

/** View one ticket — internal notes are excluded. */
portalRouter.get(
  '/tickets/:publicId',
  asyncHandler(async (req, res) => {
    const ticket = await getTicketByPublicId(z.string().uuid().parse(req.params.publicId));
    if (ticket.customer_id !== req.principal!.id) throw forbidden();
    // includeInternal MUST be false here — never expose agent notes.
    const messages = await listMessages(ticket.id, false);
    res.json({ ticket: publicView(ticket), messages: messages.map(publicMessage) });
  }),
);

/** Customer reply to their own ticket. */
portalRouter.post(
  '/tickets/:publicId/reply',
  asyncHandler(async (req, res) => {
    const ticket = await getTicketByPublicId(z.string().uuid().parse(req.params.publicId));
    if (ticket.customer_id !== req.principal!.id) throw forbidden();
    const { body } = z.object({ body: z.string().min(1).max(50_000) }).parse(req.body);
    const message = await addMessage({
      ticketId: ticket.id,
      authorType: 'customer',
      authorId: req.principal!.id,
      body,
      channel: 'web',
    });
    res.status(201).json({ message: publicMessage(message) });
  }),
);

/** Strip internal-only ticket fields before returning to a customer. */
function publicView(ticket: Ticket) {
  return {
    publicId: ticket.public_id,
    subject: ticket.subject,
    status: ticket.status,
    priority: ticket.priority,
    createdAt: ticket.created_at,
    updatedAt: ticket.updated_at,
  };
}

function publicMessage(m: TicketMessage) {
  return {
    id: m.id,
    authorType: m.author_type, // 'customer' | 'agent' | 'system'
    body: m.body,
    createdAt: m.created_at,
  };
}

export default portalRouter;
