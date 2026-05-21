/** Knowledge base: articles, categories, and full-text search (Postgres FTS). */
import { query, queryOne } from '../../db/pool';
import { conflict, notFound } from '../../http/errors';
import { audit } from '../../audit/audit';
import type { Principal } from '../../auth/tokens';

export interface KbArticle {
  id: number;
  category_id: number | null;
  title: string;
  slug: string;
  body: string;
  status: 'draft' | 'published';
  author_id: number | null;
  view_count: number;
  created_at: string;
  updated_at: string;
}

const COLUMNS =
  'id, category_id, title, slug, body, status, author_id, view_count, created_at, updated_at';

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export async function listCategories(): Promise<Array<{ id: number; name: string; slug: string }>> {
  return query(`SELECT id, name, slug FROM kb_categories ORDER BY name ASC`);
}

export async function createCategory(
  name: string,
  actor: Principal,
): Promise<{ id: number; name: string; slug: string }> {
  const slug = slugify(name);
  const row = await queryOne<{ id: number; name: string; slug: string }>(
    `INSERT INTO kb_categories (name, slug) VALUES ($1, $2)
     ON CONFLICT (slug) DO NOTHING RETURNING id, name, slug`,
    [name, slug],
  );
  if (!row) throw conflict('A category with this slug already exists');
  await audit({ actor, action: 'kb.category.create', entityType: 'kb_category', entityId: row.id });
  return row;
}

export interface ArticleSearchResult extends KbArticle {
  rank: number;
}

/**
 * Full-text article search. Ranks by ts_rank over the title-weighted vector.
 * `publishedOnly` is forced true for portal/customer callers.
 */
export async function searchArticles(
  q: string,
  publishedOnly: boolean,
  limit: number,
): Promise<ArticleSearchResult[]> {
  const statusFilter = publishedOnly ? `AND status = 'published'` : '';
  return query<ArticleSearchResult>(
    `SELECT ${COLUMNS}, ts_rank(search_vector, websearch_to_tsquery('english', $1)) AS rank
       FROM kb_articles
      WHERE search_vector @@ websearch_to_tsquery('english', $1) ${statusFilter}
      ORDER BY rank DESC, updated_at DESC
      LIMIT $2`,
    [q, limit],
  );
}

export async function listArticles(publishedOnly: boolean): Promise<KbArticle[]> {
  const statusFilter = publishedOnly ? `WHERE status = 'published'` : '';
  return query<KbArticle>(
    `SELECT ${COLUMNS} FROM kb_articles ${statusFilter} ORDER BY updated_at DESC`,
  );
}

/** Fetch an article by id or slug. Increments view_count when `countView` is set. */
export async function getArticle(
  idOrSlug: number | string,
  publishedOnly: boolean,
  countView = false,
): Promise<KbArticle> {
  const byId = typeof idOrSlug === 'number';
  const statusFilter = publishedOnly ? `AND status = 'published'` : '';
  const row = await queryOne<KbArticle>(
    `SELECT ${COLUMNS} FROM kb_articles
      WHERE ${byId ? 'id' : 'slug'} = $1 ${statusFilter}`,
    [idOrSlug],
  );
  if (!row) throw notFound('Article not found');
  if (countView) {
    await query(`UPDATE kb_articles SET view_count = view_count + 1 WHERE id = $1`, [row.id]);
  }
  return row;
}

export interface ArticleInput {
  title: string;
  body: string;
  categoryId?: number | null;
  status?: 'draft' | 'published';
}

export async function createArticle(input: ArticleInput, actor: Principal): Promise<KbArticle> {
  if (actor.type !== 'agent') throw conflict('Only agents can author articles');
  let slug = slugify(input.title);
  // Disambiguate slug collisions with a short suffix.
  if (await queryOne(`SELECT 1 FROM kb_articles WHERE slug = $1`, [slug])) {
    slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
  }
  const row = await queryOne<KbArticle>(
    `INSERT INTO kb_articles (category_id, title, slug, body, status, author_id)
     VALUES ($1, $2, $3, $4, coalesce($5, 'draft'), $6) RETURNING ${COLUMNS}`,
    [input.categoryId ?? null, input.title, slug, input.body, input.status ?? null, actor.id],
  );
  await audit({ actor, action: 'kb.article.create', entityType: 'kb_article', entityId: row!.id });
  return row!;
}

export async function updateArticle(
  id: number,
  patch: Partial<ArticleInput>,
  actor: Principal,
): Promise<KbArticle> {
  await getArticle(id, false);
  const sets: string[] = [];
  const args: unknown[] = [];
  const assign = (col: string, val: unknown) => {
    args.push(val);
    sets.push(`${col} = $${args.length}`);
  };
  if (patch.title !== undefined) assign('title', patch.title);
  if (patch.body !== undefined) assign('body', patch.body);
  if (patch.categoryId !== undefined) assign('category_id', patch.categoryId);
  if (patch.status !== undefined) assign('status', patch.status);
  if (sets.length === 0) return getArticle(id, false);

  args.push(id);
  const row = await queryOne<KbArticle>(
    `UPDATE kb_articles SET ${sets.join(', ')}, updated_at = now()
     WHERE id = $${args.length} RETURNING ${COLUMNS}`,
    args,
  );
  await audit({ actor, action: 'kb.article.update', entityType: 'kb_article', entityId: id });
  return row!;
}

export async function deleteArticle(id: number, actor: Principal): Promise<void> {
  await getArticle(id, false);
  await query(`DELETE FROM kb_articles WHERE id = $1`, [id]);
  await audit({ actor, action: 'kb.article.delete', entityType: 'kb_article', entityId: id });
}
