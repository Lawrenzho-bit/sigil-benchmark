import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { audit } from '../audit.js';

const r = Router();

// GET /csat/:token — public landing for the survey.
r.get('/:token', async (req, res) => {
  const token = z.string().min(8).max(200).parse(req.params.token);
  const s = await query(
    `SELECT cs.id, cs.ticket_id, cs.responded_at, t.number, t.subject
       FROM csat_surveys cs
       JOIN tickets t ON t.id = cs.ticket_id
      WHERE cs.token = $1`,
    [token],
  );
  if (s.rowCount === 0) return res.status(404).json({ error: 'not_found' });
  res.json({ survey: s.rows[0] });
});

// POST /csat/:token — submit response.
r.post('/:token', async (req, res) => {
  const token = z.string().min(8).max(200).parse(req.params.token);
  const body = z.object({
    rating:  z.number().int().min(1).max(5).optional(),
    thumb:   z.number().int().min(0).max(1).optional(),
    comment: z.string().max(2000).optional(),
  }).refine(b => b.rating !== undefined || b.thumb !== undefined, 'rating_or_thumb_required')
    .parse(req.body);

  const result = await query(
    `UPDATE csat_surveys
        SET rating = COALESCE($2::smallint, rating),
            thumb  = COALESCE($3::smallint, thumb),
            comment = COALESCE($4, comment),
            responded_at = COALESCE(responded_at, now())
      WHERE token = $1
   RETURNING ticket_id`,
    [token, body.rating ?? null, body.thumb ?? null, body.comment ?? null],
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'not_found' });

  audit({ actor: { kind: 'system' }, action: 'csat.response',
          target: { kind: 'ticket', id: result.rows[0].ticket_id },
          meta: { rating: body.rating, thumb: body.thumb }, req });
  res.json({ ok: true });
});

export default r;
