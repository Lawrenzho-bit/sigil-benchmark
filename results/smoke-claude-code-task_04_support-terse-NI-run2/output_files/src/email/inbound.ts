// Inbound email webhook. Designed for Postmark / SES / SendGrid inbound:
// they POST the raw RFC822 message in `rawEmail` (or as a file part).
//
// SPF / DKIM / DMARC validation is the responsibility of the upstream
// provider; we trust their verdict via headers and reject failed messages.

import { Router, raw } from 'express';
import { parseRawEmail } from './parser.js';
import { tx, query } from '../db.js';
import { applySlaToTicket } from '../sla/policies.js';
import { audit } from '../audit.js';

const r = Router();

// Accept either application/json (provider posts envelope) or raw RFC822.
r.post('/', raw({ type: ['message/rfc822', 'application/octet-stream'], limit: '25mb' }),
        async (req, res) => {
  // SES / Postmark put auth verdicts in headers; reject anything that didn't
  // pass DMARC.
  const dmarc = req.header('x-spam-dmarc') ?? req.header('x-amzses-dmarc-verdict');
  if (dmarc && /fail/i.test(dmarc)) {
    return res.status(202).json({ dropped: true, reason: 'dmarc_fail' });
  }

  // Either raw body or { raw: base64 } JSON envelope.
  let raw: Buffer | string;
  if (Buffer.isBuffer(req.body)) {
    raw = req.body;
  } else if (typeof req.body === 'object' && req.body?.raw) {
    raw = Buffer.from(req.body.raw, 'base64');
  } else if (typeof req.body === 'string') {
    raw = req.body;
  } else {
    return res.status(400).json({ error: 'missing_raw_email' });
  }

  const email = await parseRawEmail(raw);
  if (!email.from?.address) return res.status(400).json({ error: 'missing_from' });

  // Resolve target channel: the support address the email was delivered to.
  // (Strip plus-tags: support+billing@x.com -> support@x.com)
  const supportAddrs = email.to.map(a => a.replace(/\+[^@]+@/, '@').toLowerCase());
  const ch = await query<{ id: string; org_id: string }>(
    `SELECT id, org_id FROM channels
      WHERE kind = 'email' AND lower(address) = ANY($1::text[])
      LIMIT 1`,
    [supportAddrs],
  );
  if (ch.rowCount === 0) {
    // No mapped channel: 202 and drop so the provider doesn't retry forever.
    return res.status(202).json({ dropped: true, reason: 'unmapped_address' });
  }
  const { id: channelId, org_id: orgId } = ch.rows[0];

  // Idempotency: if we've already seen this Message-ID, do nothing.
  if (email.messageId) {
    const dup = await query(`SELECT 1 FROM messages WHERE message_id = $1`, [email.messageId]);
    if (dup.rowCount && dup.rowCount > 0) return res.json({ duplicate: true });
  }

  // Resolve customer.
  const c = await query<{ id: string }>(
    `INSERT INTO customers (org_id, email, full_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE
       SET org_id    = COALESCE(customers.org_id, EXCLUDED.org_id),
           full_name = COALESCE(customers.full_name, EXCLUDED.full_name)
     RETURNING id`,
    [orgId, email.from.address, email.from.name ?? null],
  );
  const customerId = c.rows[0].id;

  // Thread resolution priority:
  //   1. [#N] reference in subject
  //   2. In-Reply-To / References pointing to one of our message-ids
  // Otherwise, create a new ticket.
  const found = await tx(async (client) => {
    let ticketId: string | null = null;

    if (email.ticketRef !== null) {
      const t = await client.query<{ id: string }>(
        `SELECT id FROM tickets WHERE org_id = $1 AND number = $2`,
        [orgId, email.ticketRef],
      );
      if (t.rowCount && t.rowCount > 0) ticketId = t.rows[0].id;
    }
    if (!ticketId) {
      const refs = [email.inReplyTo, ...email.references].filter(Boolean) as string[];
      if (refs.length > 0) {
        const t = await client.query<{ ticket_id: string }>(
          `SELECT ticket_id FROM messages WHERE message_id = ANY($1::text[]) LIMIT 1`,
          [refs],
        );
        if (t.rowCount && t.rowCount > 0) ticketId = t.rows[0].ticket_id;
      }
    }

    let isNew = false;
    if (!ticketId) {
      const t = await client.query<{ id: string; number: number }>(
        `INSERT INTO tickets (org_id, subject, requester_id, channel_id)
         VALUES ($1, $2, $3, $4) RETURNING id, number`,
        [orgId, email.subject || '(no subject)', customerId, channelId],
      );
      ticketId = t.rows[0].id;
      isNew = true;
    } else {
      // Customer replied: reopen if appropriate.
      await client.query(
        `UPDATE tickets
            SET status = CASE WHEN status IN ('solved','pending','on_hold')
                              THEN 'open'::ticket_status ELSE status END
          WHERE id = $1`,
        [ticketId],
      );
    }

    await client.query(
      `INSERT INTO messages (ticket_id, kind, body_text, body_html,
                              author_customer_id, message_id, in_reply_to,
                              email_from, email_to, email_cc, attachments)
       VALUES ($1, 'reply', $2, $3, $4, $5, $6, $7, $8::text[], $9::text[], $10::jsonb)
       ON CONFLICT (message_id) DO NOTHING`,
      [
        ticketId, email.text, email.html, customerId,
        email.messageId, email.inReplyTo, email.from!.address,
        email.to, email.cc, JSON.stringify(email.attachments),
      ],
    );
    return { ticketId, isNew };
  });

  if (found.isNew) await applySlaToTicket(found.ticketId!, orgId);
  audit({ actor: { kind: 'system' }, orgId, action: 'email.inbound',
          target: { kind: 'ticket', id: found.ticketId! },
          meta: { from: email.from.address, message_id: email.messageId, new_ticket: found.isNew } });

  res.json({ ticket_id: found.ticketId, new_ticket: found.isNew });
});

export default r;
