/** Customer (requester) profiles, interaction history, and GDPR erasure. */
import type { PoolClient } from 'pg';
import { query, queryOne, withTransaction } from '../../db/pool';
import { conflict, notFound } from '../../http/errors';
import { audit } from '../../audit/audit';
import type { Principal } from '../../auth/tokens';
import { hashPassword } from '../../auth/tokens';

export interface Customer {
  id: number;
  email: string;
  name: string | null;
  phone: string | null;
  company: string | null;
  locale: string;
  notes: string | null;
  is_anonymised: boolean;
  created_at: string;
  updated_at: string;
}

const PUBLIC_COLUMNS =
  'id, email, name, phone, company, locale, notes, is_anonymised, created_at, updated_at';

/**
 * Resolve a customer by email, creating one if absent. Used by email ingestion
 * and the portal. Email is matched case-insensitively and stored lower-cased.
 */
export async function findOrCreateByEmail(
  client: PoolClient,
  email: string,
  name?: string | null,
): Promise<Customer> {
  const normalized = email.trim().toLowerCase();
  const existing = await client.query<Customer>(
    `SELECT ${PUBLIC_COLUMNS} FROM customers WHERE email = $1`,
    [normalized],
  );
  if (existing.rows[0]) return existing.rows[0];

  const created = await client.query<Customer>(
    `INSERT INTO customers (email, name) VALUES ($1, $2)
     RETURNING ${PUBLIC_COLUMNS}`,
    [normalized, name?.trim() || null],
  );
  return created.rows[0]!;
}

export async function getCustomer(id: number): Promise<Customer> {
  const row = await queryOne<Customer>(
    `SELECT ${PUBLIC_COLUMNS} FROM customers WHERE id = $1`,
    [id],
  );
  if (!row) throw notFound('Customer not found');
  return row;
}

export interface ListCustomersParams {
  q?: string;
  limit: number;
  offset: number;
}

export async function listCustomers(
  params: ListCustomersParams,
): Promise<{ items: Customer[]; total: number }> {
  const where: string[] = [];
  const args: unknown[] = [];
  if (params.q) {
    args.push(`%${params.q.toLowerCase()}%`);
    where.push(`(lower(email) LIKE $${args.length} OR lower(coalesce(name,'')) LIKE $${args.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const totalRow = await queryOne<{ count: string }>(
    `SELECT count(*)::text AS count FROM customers ${whereSql}`,
    args,
  );
  args.push(params.limit, params.offset);
  const items = await query<Customer>(
    `SELECT ${PUBLIC_COLUMNS} FROM customers ${whereSql}
     ORDER BY created_at DESC LIMIT $${args.length - 1} OFFSET $${args.length}`,
    args,
  );
  return { items, total: Number(totalRow?.count ?? 0) };
}

export interface CustomerUpsert {
  email: string;
  name?: string | null;
  phone?: string | null;
  company?: string | null;
  locale?: string;
  notes?: string | null;
  password?: string | null;
}

export async function createCustomer(input: CustomerUpsert, actor: Principal): Promise<Customer> {
  const email = input.email.trim().toLowerCase();
  const dupe = await queryOne(`SELECT id FROM customers WHERE email = $1`, [email]);
  if (dupe) throw conflict('A customer with this email already exists');

  const passwordHash = input.password ? await hashPassword(input.password) : null;
  const row = await queryOne<Customer>(
    `INSERT INTO customers (email, name, phone, company, locale, notes, password_hash)
     VALUES ($1, $2, $3, $4, coalesce($5,'en'), $6, $7)
     RETURNING ${PUBLIC_COLUMNS}`,
    [email, input.name ?? null, input.phone ?? null, input.company ?? null, input.locale ?? null, input.notes ?? null, passwordHash],
  );
  await audit({ actor, action: 'customer.create', entityType: 'customer', entityId: row!.id });
  return row!;
}

export async function updateCustomer(
  id: number,
  patch: Partial<CustomerUpsert>,
  actor: Principal,
): Promise<Customer> {
  await getCustomer(id); // 404 if missing

  const sets: string[] = [];
  const args: unknown[] = [];
  const assign = (col: string, val: unknown) => {
    args.push(val);
    sets.push(`${col} = $${args.length}`);
  };
  if (patch.name !== undefined) assign('name', patch.name);
  if (patch.phone !== undefined) assign('phone', patch.phone);
  if (patch.company !== undefined) assign('company', patch.company);
  if (patch.locale !== undefined) assign('locale', patch.locale);
  if (patch.notes !== undefined) assign('notes', patch.notes);
  if (patch.password) assign('password_hash', await hashPassword(patch.password));
  if (sets.length === 0) return getCustomer(id);

  args.push(id);
  const row = await queryOne<Customer>(
    `UPDATE customers SET ${sets.join(', ')}, updated_at = now()
     WHERE id = $${args.length} RETURNING ${PUBLIC_COLUMNS}`,
    args,
  );
  await audit({ actor, action: 'customer.update', entityType: 'customer', entityId: id });
  return row!;
}

export interface InteractionHistory {
  customer: Customer;
  tickets: Array<{
    id: number;
    number: number;
    subject: string;
    status: string;
    priority: string;
    channel: string;
    created_at: string;
    updated_at: string;
    message_count: number;
  }>;
  csat: { responses: number; average_score: number | null };
}

/** Full interaction history: every ticket plus aggregate CSAT for the customer. */
export async function getInteractionHistory(id: number): Promise<InteractionHistory> {
  const customer = await getCustomer(id);
  const tickets = await query<InteractionHistory['tickets'][number]>(
    `SELECT t.id, t.number, t.subject, t.status, t.priority, t.channel,
            t.created_at, t.updated_at,
            (SELECT count(*) FROM ticket_messages m WHERE m.ticket_id = t.id)::int AS message_count
       FROM tickets t
      WHERE t.requester_id = $1
      ORDER BY t.created_at DESC`,
    [id],
  );
  const csat = await queryOne<{ responses: string; average_score: string | null }>(
    `SELECT count(score)::text AS responses, avg(score)::numeric(3,2)::text AS average_score
       FROM csat_surveys WHERE customer_id = $1`,
    [id],
  );
  return {
    customer,
    tickets,
    csat: {
      responses: Number(csat?.responses ?? 0),
      average_score: csat?.average_score ? Number(csat.average_score) : null,
    },
  };
}

/**
 * GDPR right-to-erasure. Anonymises PII in place rather than deleting rows, so
 * ticket history and reporting aggregates stay intact. Message bodies authored
 * by the customer are scrubbed; agent replies are retained.
 */
export async function eraseCustomer(id: number, actor: Principal): Promise<void> {
  await getCustomer(id);
  await withTransaction(async (client) => {
    const placeholder = `erased-${id}@gdpr.invalid`;
    await client.query(
      `UPDATE customers
          SET email = $2, name = 'Erased', phone = NULL, company = NULL,
              notes = NULL, password_hash = NULL, is_anonymised = true, updated_at = now()
        WHERE id = $1`,
      [id, placeholder],
    );
    await client.query(
      `UPDATE ticket_messages
          SET body_text = '[erased at customer request]', body_html = NULL
        WHERE author_customer_id = $1`,
      [id],
    );
    await audit(
      { actor, action: 'customer.erase', entityType: 'customer', entityId: id },
      client,
    );
  });
}
