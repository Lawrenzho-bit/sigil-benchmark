import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireAgent } from '../middleware/auth';
import {
  createArticle,
  getArticleBySlug,
  listArticles,
  searchArticles,
  updateArticle,
} from '../services/kbService';

/**
 * Knowledge base API. The public surface (search, read) is unauthenticated and
 * only ever exposes published articles; the management surface requires an
 * agent token and can see drafts.
 */
export const kbRouter = Router();

// --- Public (no auth) — published content only ---

/** Search published articles. GET /kb/search?q=password+reset */
kbRouter.get(
  '/search',
  asyncHandler(async (req, res) => {
    const q = z.string().max(200).default('').parse(req.query.q);
    res.json({ results: await searchArticles(q, true) });
  }),
);

/** List published articles. */
kbRouter.get(
  '/articles',
  asyncHandler(async (_req, res) => {
    res.json({ articles: await listArticles(true) });
  }),
);

/** Read one published article by slug. */
kbRouter.get(
  '/articles/:slug',
  asyncHandler(async (req, res) => {
    const slug = z.string().min(1).parse(req.params.slug);
    res.json({ article: await getArticleBySlug(slug, true) });
  }),
);

// --- Management (agent auth) — can see drafts ---

const articleInput = z.object({
  title: z.string().min(1).max(300),
  body: z.string().min(1).max(100_000),
  status: z.enum(['draft', 'published', 'archived']).optional(),
});

kbRouter.post(
  '/manage/articles',
  requireAgent,
  asyncHandler(async (req, res) => {
    const article = await createArticle(articleInput.parse(req.body), req.principal!);
    res.status(201).json({ article });
  }),
);

kbRouter.patch(
  '/manage/articles/:id',
  requireAgent,
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const changes = articleInput.partial().parse(req.body);
    res.json({ article: await updateArticle(id, changes, req.principal!) });
  }),
);

/** Agent-side search — includes drafts + archived. */
kbRouter.get(
  '/manage/search',
  requireAgent,
  asyncHandler(async (req, res) => {
    const q = z.string().max(200).default('').parse(req.query.q);
    res.json({ results: await searchArticles(q, false) });
  }),
);

export default kbRouter;
