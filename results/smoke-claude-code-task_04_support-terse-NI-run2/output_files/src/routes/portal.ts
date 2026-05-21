import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';

const r = Router();

// GET /api/portal/tickets — all tickets owned by the calling customer.
r.get('/tickets', async (req, res) => {
  const customerId = req.subject!.id;
  const rows = (await query(
    `SELECT id, number, subject, status, priority, created_at, updated_at,
            resolved_at, closed_at
       FROM tickets
      WHERE requester_id = $1
   ORDER BY updated_at DESC
      LIMIT 200`,
    [customerId],
  )).rows;
  res.json({ tickets: rows });
});

r.get('/tickets/:id', async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const customerId = req.subject!.id;

  const t = await query(
    `SELECT id, number, subject, status, priority, created_at, updated_at,
            resolved_at, closed_at
       FROM tickets WHERE id = $1 AND requester_id = $2`,
    [id, customerId],
  );
  if (t.rowCount === 0) return res.status(404).json({ error: 'not_found' });

  // Hide internal notes from customers.
  const msgs = await query(
    `SELECT id, kind, body_text, body_html, author_agent_id, author_customer_id,
            attachments, created_at
       FROM messages
      WHERE ticket_id = $1 AND is_internal = false
   ORDER BY created_at ASC`,
    [id],
  );
  res.json({ ticket: t.rows[0], messages: msgs.rows });
});

export default r;
