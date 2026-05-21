/**
 * Customer (end-user) records and their interaction history.
 */
import { PoolClient } from 'pg';
import { pool, query, queryOne } from '../db';

export interface Customer {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  attributes: Record<string, unknown>;
  anonymized_at: string | null;
  created_at: string;
}

/**
 * Find a customer by email, creating a minimal record if none exists.
 * This is the entry point for inbound email — an unknown sender becomes a
 * customer automatically. Safe under concurrency via ON CONFLICT.
 */
export async function findOrCreateByEmail(
  email: string,
  name?: string | null,
  client?: PoolClient,
): Promise<Customer> {
  const runner = client ?? pool;
  const res = await runner.query<Customer>(
    `INSERT INTO customers (email, name)
     VALUES ($1, $2)
     ON CONFLICT (lower(email)) DO UPDATE
       SET name = COALESCE(customers.name, EXCLUDED.name)
     RETURNING *`,
    [email.trim(), name?.trim() || null],
  );
  return res.rows[0];
}

export async function getById(id: string): Promise<Customer | undefined> {
  return queryOne<Customer>('SELECT * FROM customers WHERE id = $1', [id]);
}

export async function update(
  id: string,
  patch: { name?: string; phone?: string; attributes?: Record<string, unknown> },
): Promise<Customer | undefined> {
  return queryOne<Customer>(
    `UPDATE customers
        SET name       = COALESCE($2, name),
            phone      = COALESCE($3, phone),
            attributes = COALESCE($4, attributes)
      WHERE id = $1
      RETURNING *`,
    [id, patch.name ?? null, patch.phone ?? null,
     patch.attributes ? JSON.stringify(patch.attributes) : null],
  );
}

/**
 * Full interaction history: every ticket the customer has opened, with
 * counts and the most recent activity timestamp. Powers the agent-facing
 * customer profile panel.
 */
export async function interactionHistory(customerId: string) {
  const customer = await getById(customerId);
  if (!customer) return undefined;

  const tickets = await query(
    `SELECT t.id, t.number, t.subject, t.status, t.priority, t.channel,
            t.created_at, t.updated_at, t.resolved_at,
            (SELECT count(*) FROM ticket_messages m WHERE m.ticket_id = t.id) AS message_count
       FROM tickets t
      WHERE t.requester_id = $1
      ORDER BY t.created_at DESC`,
    [customerId],
  );

  const stats = await queryOne<{
    total: string; open: string; avg_csat: string | null;
  }>(
    `SELECT count(*)                                            AS total,
            count(*) FILTER (WHERE status NOT IN ('resolved','closed')) AS open,
            (SELECT round(avg(score)::numeric, 2)
               FROM csat_surveys c
               JOIN tickets t2 ON t2.id = c.ticket_id
              WHERE t2.requester_id = $1 AND c.score IS NOT NULL) AS avg_csat
       FROM tickets WHERE requester_id = $1`,
    [customerId],
  );

  return { customer, tickets, stats };
}

/**
 * GDPR erasure: anonymize a customer and scrub their message content while
 * keeping ticket rows for aggregate reporting integrity.
 */
export async function anonymize(customerId: string, client?: PoolClient): Promise<void> {
  const runner = client ?? pool;
  const anonEmail = `anonymized+${customerId}@invalid.local`;
  await runner.query(
    `UPDATE customers
        SET email = $2, name = 'Anonymized User', phone = NULL,
            password_hash = NULL, attributes = '{}'::jsonb, anonymized_at = now()
      WHERE id = $1`,
    [customerId, anonEmail],
  );
  await runner.query(
    `UPDATE ticket_messages m
        SET body_text = '[redacted]', body_html = NULL, email_message_id = NULL
      FROM tickets t
     WHERE m.ticket_id = t.id AND t.requester_id = $1 AND m.author_type = 'customer'`,
    [customerId],
  );
}
