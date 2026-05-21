import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db.js';
import { audit } from '../audit.js';
import { sendReplyEmail } from '../email/outbound.js';
import { mirrorToSlack } from '../slack/webhook.js';

const r = Router();

// POST /api/messages — reply or internal note on a ticket.
const createSchema = z.object({
  ticket_id:    z.string().uuid(),
  body:         z.string().min(1),
  is_internal:  z.boolean().optional(),
  // When an agent replies, attachments are URIs to objects in S3/equivalent.
  attachments:  z.array(z.object({
    filename: z.string(),
    url:      z.string().url(),
    size:     z.number().int().nonnegative(),
    mime:     z.string(),
  })).optional(),
});

r.post('/', async (req, res) => {
  const body = createSchema.parse(req.body);
  const subj = req.subject!;
  const isInternal = body.is_internal ?? false;

  // Customers cannot post internal notes.
  if (subj.kind === 'customer' && isInternal) {
    return res.status(403).json({ error: 'internal_notes_agent_only' });
  }

  // Resolve ticket and check authorization.
  const t = await query<{ org_id: string; requester_id: string; status: string; subject: string }>(
    `SELECT org_id, requester_id, status, subject FROM tickets WHERE id = $1`,
    [body.ticket_id],
  );
  if (t.rowCount === 0) return res.status(404).json({ error: 'not_found' });
  const ticket = t.rows[0];
  if (subj.kind === 'customer' && ticket.requester_id !== subj.id) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const messageId = await tx(async (client) => {
    const msg = await client.query<{ id: string }>(
      `INSERT INTO messages (ticket_id, kind, body_text, is_internal, attachments,
                             author_agent_id, author_customer_id)
       VALUES ($1, $2::message_kind, $3, $4, $5::jsonb, $6, $7)
       RETURNING id`,
      [
        body.ticket_id,
        isInternal ? 'note' : 'reply',
        body.body,
        isInternal,
        JSON.stringify(body.attachments ?? []),
        subj.kind === 'agent'    ? subj.id : null,
        subj.kind === 'customer' ? subj.id : null,
      ],
    );

    // First-response watermark: only set on an agent reply (not a note).
    if (subj.kind === 'agent' && !isInternal) {
      await client.query(
        `UPDATE tickets SET first_response_at = COALESCE(first_response_at, now()),
                            status = CASE WHEN status = 'new' THEN 'open'::ticket_status ELSE status END
          WHERE id = $1`,
        [body.ticket_id],
      );
    }
    // A customer reply on a solved/pending ticket reopens it.
    if (subj.kind === 'customer' && ['solved','pending','on_hold'].includes(ticket.status)) {
      await client.query(
        `UPDATE tickets SET status = 'open'::ticket_status WHERE id = $1`,
        [body.ticket_id],
      );
    }
    return msg.rows[0].id;
  });

  audit({ actor: subj, action: isInternal ? 'message.note' : 'message.reply',
          target: { kind: 'ticket', id: body.ticket_id }, req });

  // Side-effects: email out + Slack mirror only for non-internal agent replies.
  if (subj.kind === 'agent' && !isInternal) {
    sendReplyEmail(body.ticket_id, messageId).catch(err =>
      console.error('[email.outbound]', err));
    mirrorToSlack(body.ticket_id, messageId, body.body).catch(err =>
      console.error('[slack.mirror]', err));
  }

  res.status(201).json({ id: messageId });
});

export default r;
