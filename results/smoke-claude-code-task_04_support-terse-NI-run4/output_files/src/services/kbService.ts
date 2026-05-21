import { query, queryOne } from '../db';
import { badRequest, notFound } from '../errors';
import { Principal } from '../types';
import { audit } from '../lib/audit';

export interface KbArticle {
  id: string;
  slug: string;
  title: string;
  body: string;
  status: 'draft' | 'published' | 'archived';
  author_id: string | null;
  created_at: Date;
  updated_at: Date;
}

/** URL-safe slug from a title; uniqueness suffix is added on collision. */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'article';
}

export async function createArticle(
  input: { title: string; body: string; status?: KbArticle['status'] },
  author: Principal,
): Promise<KbArticle> {
  if (!input.title.trim()) throw badRequest('Title is required');

  let slug = slugify(input.title);
  // Append a short random suffix if the slug is taken.
  if (await queryOne('SELECT 1 FROM kb_articles WHERE slug = $1', [slug])) {
    slug = `${slug}-${Math.random().toString(36).slice(2, 7)}`;
  }

  const article = await queryOne<KbArticle>(
    `INSERT INTO kb_articles (slug, title, body, status, author_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [slug, input.title.trim(), input.body, input.status ?? 'draft', author.id],
  );
  await audit({
    actorType: 'agent',
    actorId: author.id,
    action: 'kb.create',
    entityType: 'kb_article',
    entityId: article!.id,
  });
  return article!;
}

export async function updateArticle(
  id: string,
  changes: Partial<Pick<KbArticle, 'title' | 'body' | 'status'>>,
  actor: Principal,
): Promise<KbArticle> {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [col, val] of Object.entries(changes)) {
    if (val === undefined) continue;
    values.push(val);
    sets.push(`${col} = $${values.length}`);
  }
  if (sets.length === 0) throw badRequest('No fields to update');
  values.push(id);

  const article = await queryOne<KbArticle>(
    `UPDATE kb_articles SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`,
    values,
  );
  if (!article) throw notFound('Article not found');
  await audit({
    actorType: 'agent',
    actorId: actor.id,
    action: 'kb.update',
    entityType: 'kb_article',
    entityId: id,
    metadata: { fields: Object.keys(changes) },
  });
  return article;
}

export async function getArticleBySlug(slug: string, publishedOnly: boolean): Promise<KbArticle> {
  const article = await queryOne<KbArticle>(
    `SELECT * FROM kb_articles
      WHERE slug = $1 AND ($2::boolean = false OR status = 'published')`,
    [slug, publishedOnly],
  );
  if (!article) throw notFound('Article not found');
  return article;
}

export interface KbSearchHit {
  id: string;
  slug: string;
  title: string;
  /** Highlighted excerpt around the match. */
  snippet: string;
  rank: number;
}

/**
 * Full-text search over the knowledge base using Postgres FTS.
 *
 * `websearch_to_tsquery` accepts natural query syntax (quoted phrases, `or`,
 * `-exclude`) and never throws on malformed input — safe for raw user text.
 * `publishedOnly` is true for the customer portal, false for the agent UI.
 */
export async function searchArticles(
  term: string,
  publishedOnly: boolean,
  limit = 20,
): Promise<KbSearchHit[]> {
  if (!term.trim()) return [];
  return query<KbSearchHit>(
    `SELECT id, slug, title,
            ts_headline('english', body, websearch_to_tsquery('english', $1),
                        'MaxFragments=2, MinWords=5, MaxWords=18') AS snippet,
            ts_rank(search_vector, websearch_to_tsquery('english', $1)) AS rank
       FROM kb_articles
      WHERE search_vector @@ websearch_to_tsquery('english', $1)
        AND ($2::boolean = false OR status = 'published')
      ORDER BY rank DESC
      LIMIT $3`,
    [term, publishedOnly, limit],
  );
}

export async function listArticles(publishedOnly: boolean): Promise<KbArticle[]> {
  return query<KbArticle>(
    `SELECT * FROM kb_articles
      WHERE $1::boolean = false OR status = 'published'
      ORDER BY updated_at DESC`,
    [publishedOnly],
  );
}
