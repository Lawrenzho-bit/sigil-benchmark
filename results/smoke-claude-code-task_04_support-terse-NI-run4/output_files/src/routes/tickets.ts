import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireAgent } from '../middleware/auth';
import {
  addMessage,
  getTicket,
  listMessages,
  mergeTickets,
  splitTicket,
  updateTicket,
} from '../services/ticketService';
import { getCustomer } from '../services/customerService';
import { applyMacroToReply } from '../services/macroApply';
import { sendTicketReply } from '../email/outbound';
import { createSurveyForTicket } from '../services/csatService';
import { sendCsatEmail } from '../email/outbound';
import { logger } from '../logger';

export const ticketsRouter = Router();
ticketsRouter.use(requireAgent); // every route here is agent-only

const ticketIdParam = z.coerce.number().int().positive();

/** Full ticket detail — agents see internal notes. */
ticketsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = ticketIdParam.parse(req.params.id);
    const ticket = await getTicket(id);
    const [messages, customer, sla, tags] = await Promise.all([
      listMessages(id, true),
      getCustomer(ticket.customer_id),
      queryOne('SELECT * FROM ticket_sla WHERE ticket_id = $1', [id]),
      query('SELECT g.name FROM ticket_tags tt JOIN tags g ON g.id = tt.tag_id WHERE tt.ticket_id = $1', [id]),
    ]);
    res.json({ ticket, customer, sla, tags: tags.map((t) => (t as { name: string }).name), messages });
  }),
);

/**
 * Post a public agent reply. Persists the message, then emails the customer.
 * If a macro is supplied its body is rendered and its actions applied.
 */
ticketsRouter.post(
  '/:id/reply',
  asyncHandler(async (req, res) => {
    const id = ticketIdParam.parse(req.params.id);
    // Body may be empty when a macro supplies the text; require one or the other.
    const body = z
      .object({
        body: z.string().max(50_000).default(''),
        macroId: z.string().uuid().optional(),
      })
      .refine((b) => b.body.trim().length > 0 || b.macroId, {
        message: 'Provide a reply body or a macro',
      })
      .parse(req.body);
    const agent = req.principal!;

    const ticket = await getTicket(id);
    let replyBody = body.body;

    if (body.macroId) {
      replyBody = await applyMacroToReply(body.macroId, ticket, agent, body.body);
    }

    const message = await addMessage({
      ticketId: id,
      authorType: 'agent',
      authorId: agent.id,
      body: replyBody,
      channel: 'email',
    });

    // Email the customer. A send failure is reported but the reply is saved.
    const customer = await getCustomer(ticket.customer_id);
    try {
      await sendTicketReply({
        ticketId: id,
        to: customer.email,
        subject: ticket.subject,
        text: replyBody,
      });
    } catch {
      return res.status(502).json({
        message,
        warning: 'Reply saved but the email could not be delivered; it will be retried.',
      });
    }
    res.status(201).json({ message });
  }),
);

/** Post an internal note — never emailed, never shown to the customer. */
ticketsRouter.post(
  '/:id/notes',
  asyncHandler(async (req, res) => {
    const id = ticketIdParam.parse(req.params.id);
    const { body } = z.object({ body: z.string().min(1).max(50_000) }).parse(req.body);
    const message = await addMessage({
      ticketId: id,
      authorType: 'agent',
      authorId: req.principal!.id,
      body,
      isInternalNote: true,
      channel: 'web',
    });
    res.status(201).json({ message });
  }),
);

/**
 * Update status / priority / assignee. Resolving a ticket also generates and
 * emails a CSAT survey to the customer.
 */
ticketsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = ticketIdParam.parse(req.params.id);
    const changes = z
      .object({
        status: z.enum(['new', 'open', 'pending', 'on_hold', 'resolved', 'closed']).optional(),
        priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
        assigneeId: z.string().uuid().nullable().optional(),
        teamId: z.string().uuid().nullable().optional(),
      })
      .parse(req.body);

    const before = await getTicket(id);
    const ticket = await updateTicket(id, changes, req.principal!, req.ip);

    // Newly resolved → trigger CSAT.
    if (ticket.status === 'resolved' && before.status !== 'resolved') {
      try {
        const { survey, url } = await createSurveyForTicket(id);
        const customer = await getCustomer(ticket.customer_id);
        await sendCsatEmail(customer.email, id, url);
        logger.info({ ticketId: id, surveyId: survey.id }, 'CSAT survey sent');
      } catch (err) {
        logger.error({ err, ticketId: id }, 'failed to issue CSAT survey');
      }
    }
    res.json({ ticket });
  }),
);

/** Assign (or unassign) a ticket — convenience over PATCH. */
ticketsRouter.post(
  '/:id/assign',
  asyncHandler(async (req, res) => {
    const id = ticketIdParam.parse(req.params.id);
    const { assigneeId } = z
      .object({ assigneeId: z.string().uuid().nullable() })
      .parse(req.body);
    const ticket = await updateTicket(id, { assigneeId }, req.principal!, req.ip);
    res.json({ ticket });
  }),
);

/** Merge this ticket into another. */
ticketsRouter.post(
  '/:id/merge',
  asyncHandler(async (req, res) => {
    const sourceId = ticketIdParam.parse(req.params.id);
    const { targetId } = z.object({ targetId: ticketIdParam }).parse(req.body);
    const target = await mergeTickets(sourceId, targetId, req.principal!, req.ip);
    res.json({ target });
  }),
);

/** Split selected messages off into a new ticket. */
ticketsRouter.post(
  '/:id/split',
  asyncHandler(async (req, res) => {
    const sourceId = ticketIdParam.parse(req.params.id);
    const { messageIds, subject } = z
      .object({
        messageIds: z.array(z.string().uuid()).min(1),
        subject: z.string().min(1).max(500),
      })
      .parse(req.body);
    const newTicket = await splitTicket(sourceId, messageIds, subject, req.principal!, req.ip);
    res.status(201).json({ ticket: newTicket });
  }),
);

/** Attach a tag (created on first use). */
ticketsRouter.post(
  '/:id/tags',
  asyncHandler(async (req, res) => {
    const id = ticketIdParam.parse(req.params.id);
    const { name } = z.object({ name: z.string().min(1).max(50) }).parse(req.body);
    await getTicket(id); // 404 if missing
    const tag = await queryOne<{ id: string }>(
      `INSERT INTO tags (name) VALUES ($1)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [name.trim().toLowerCase()],
    );
    await query(
      'INSERT INTO ticket_tags (ticket_id, tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [id, tag!.id],
    );
    res.status(201).json({ ok: true });
  }),
);

ticketsRouter.delete(
  '/:id/tags/:name',
  asyncHandler(async (req, res) => {
    const id = ticketIdParam.parse(req.params.id);
    const name = z.string().min(1).parse(req.params.name).toLowerCase();
    await query(
      `DELETE FROM ticket_tags
        WHERE ticket_id = $1 AND tag_id = (SELECT id FROM tags WHERE name = $2)`,
      [id, name],
    );
    res.json({ ok: true });
  }),
);

export default ticketsRouter;
