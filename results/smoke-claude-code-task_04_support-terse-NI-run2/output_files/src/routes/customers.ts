import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { audit } from '../audit.js';

const r = Router();

// GET /api/customers?search=...
r.get('/', async (req, res) => {
  const q = z.object({
    search: z.string().min(1).max(200).optional(),
    limit:  z.coerce.number().int().min(1).max(100).default(50),
  }).parse(req.query);

  const args: unknown[] = [req.subject!.orgId];
  let where = `org_id = $1 AND deleted_at IS NULL`;
  if (q.search) {
    args.push(`%${q.search}%`);
    where += ` AND (email ILIKE $2 OR full_name ILIKE $2)`;
  }
  args.push(q.limit);
  const rows = (await query(
    `SELECT id, email, full_name, phone, attributes, created_at
       FROM customers WHERE ${where}
   ORDER BY created_at DESC
      LIMIT $${args.length}`,
    args,
  )).rows;
  res.json({ customers: rows });
});

// GET /api/customers/:id — full profile with interaction history.
r.get('/:id', async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);

  const c = await query(
    `SELECT id, org_id, email, full_name, phone, attributes, created_at
       FROM customers WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  if (c.rowCount === 0) return res.status(404).json({ error: 'not_found' });

  const tickets = await query(
    `SELECT id, number, subject, status, priority, created_at, updated_at, resolved_at
       FROM tickets
      WHERE requester_id = $1
   ORDER BY created_at DESC
      LIMIT 200`,
    [id],
  );
  // Recent CSAT scores for context.
  const csat = await query(
    `SELECT cs.rating, cs.thumb, cs.responded_at, cs.comment, cs.ticket_id
       FROM csat_surveys cs
       JOIN tickets t ON t.id = cs.ticket_id
      WHERE t.requester_id = $1 AND cs.responded_at IS NOT NULL
   ORDER BY cs.responded_at DESC
      LIMIT 20`,
    [id],
  );
  res.json({ customer: c.rows[0], tickets: tickets.rows, csat: csat.rows });
});

// GDPR subject-access export.
r.get('/:id/gdpr-export', async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const customer = await query(`SELECT * FROM customers WHERE id = $1`, [id]);
  if (customer.rowCount === 0) return res.status(404).json({ error: 'not_found' });

  const tickets = await query(`SELECT * FROM tickets WHERE requester_id = $1`, [id]);
  const messages = await query(
    `SELECT m.* FROM messages m
       JOIN tickets t ON t.id = m.ticket_id
      WHERE t.requester_id = $1`,
    [id],
  );
  audit({ actor: req.subject!, action: 'gdpr.export',
          target: { kind: 'customer', id }, req });
  res.json({ customer: customer.rows[0], tickets: tickets.rows, messages: messages.rows });
});

// GDPR erasure: soft-delete customer, hard-redact PII in messages.
r.post('/:id/gdpr-erase', async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  // Erasure preserves ticket structure (org needs aggregate metrics) but
  // removes personal content.
  await query(
    `UPDATE customers SET deleted_at = now(),
                          email = NULL, full_name = NULL, phone = NULL,
                          attributes = '{}'::jsonb, portal_password_hash = NULL
      WHERE id = $1`,
    [id],
  );
  await query(
    `UPDATE messages SET body_text = '[redacted]', body_html = NULL,
                         email_from = NULL, email_to = '{}', email_cc = '{}',
                         attachments = '[]'::jsonb
      WHERE author_customer_id = $1`,
    [id],
  );
  audit({ actor: req.subject!, action: 'gdpr.erase',
          target: { kind: 'customer', id }, req });
  res.json({ ok: true });
});

export default r;
