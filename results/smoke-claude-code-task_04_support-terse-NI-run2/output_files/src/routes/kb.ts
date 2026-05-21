import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { requireAgent } from '../auth.js';
import { audit } from '../audit.js';

const r = Router();

// Public search: scoped to published, public articles unless caller is an agent.
r.get('/search', async (req, res) => {
  const q = z.object({
    q:      z.string().min(1).max(200),
    org_id: z.string().uuid().optional(),
    limit:  z.coerce.number().int().min(1).max(50).default(20),
  }).parse(req.query);

  const isAgent = req.subject?.kind === 'agent';
  const orgId = req.subject?.orgId ?? q.org_id;
  if (!orgId) return res.status(400).json({ error: 'org_required' });

  const visClause = isAgent ? '' : `AND visibility = 'public' AND published_at IS NOT NULL`;

  const rows = (await query(
    `SELECT id, slug, title, ts_headline('english', body_md, plainto_tsquery('english', $2),
              'MaxFragments=2,MinWords=5,MaxWords=20') AS snippet,
            ts_rank(search_tsv, plainto_tsquery('english', $2)) AS rank,
            views, helpful_yes, helpful_no, updated_at
       FROM kb_articles
      WHERE org_id = $1 ${visClause}
        AND search_tsv @@ plainto_tsquery('english', $2)
   ORDER BY rank DESC, views DESC
      LIMIT $3`,
    [orgId, q.q, q.limit],
  )).rows;

  res.json({ results: rows });
});

r.get('/articles/:slug', async (req, res) => {
  const orgId = req.subject?.orgId ?? (req.query.org_id as string | undefined);
  if (!orgId) return res.status(400).json({ error: 'org_required' });

  const isAgent = req.subject?.kind === 'agent';
  const visClause = isAgent ? '' : `AND visibility = 'public' AND published_at IS NOT NULL`;

  const a = await query(
    `SELECT * FROM kb_articles WHERE org_id = $1 AND slug = $2 ${visClause}`,
    [orgId, req.params.slug],
  );
  if (a.rowCount === 0) return res.status(404).json({ error: 'not_found' });

  // Fire-and-forget view increment.
  query(`UPDATE kb_articles SET views = views + 1 WHERE id = $1`, [a.rows[0].id])
    .catch(() => {});
  res.json({ article: a.rows[0] });
});

r.post('/articles', requireAgent('admin','manager','agent'), async (req, res) => {
  const body = z.object({
    title:        z.string().min(1).max(300),
    slug:         z.string().min(1).max(200).regex(/^[a-z0-9-]+$/),
    body_md:      z.string().min(1),
    category_id:  z.string().uuid().optional(),
    visibility:   z.enum(['public','internal']).default('public'),
    publish:      z.boolean().default(false),
  }).parse(req.body);

  const a = await query<{ id: string }>(
    `INSERT INTO kb_articles (org_id, category_id, slug, title, body_md, visibility, author_id, published_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [req.subject!.orgId, body.category_id ?? null, body.slug, body.title, body.body_md,
     body.visibility, req.subject!.id, body.publish ? new Date() : null],
  );
  audit({ actor: req.subject!, action: 'kb.create', target: { kind: 'kb_article', id: a.rows[0].id }, req });
  res.status(201).json({ id: a.rows[0].id });
});

r.post('/articles/:id/helpful', async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const { helpful } = z.object({ helpful: z.boolean() }).parse(req.body);
  await query(
    helpful
      ? `UPDATE kb_articles SET helpful_yes = helpful_yes + 1 WHERE id = $1`
      : `UPDATE kb_articles SET helpful_no  = helpful_no  + 1 WHERE id = $1`,
    [id],
  );
  res.json({ ok: true });
});

export default r;
