import { PoolClient } from 'pg';
import { pool, query, queryOne } from '../db';
import { notFound } from '../errors';

export interface Customer {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  attributes: Record<string, unknown>;
  anonymized_at: Date | null;
  created_at: Date;
}

type Executor = Pick<PoolClient, 'query'>;

/**
 * Look up a customer by email, creating one if absent. Inbound email and the
 * web portal both funnel through here so a person always maps to one record.
 */
export async function findOrCreateCustomer(
  email: string,
  name: string | null,
  exec: Executor = pool,
): Promise<Customer> {
  const normalized = email.trim().toLowerCase();
  const existing = await exec.query<Customer>(
    'SELECT * FROM customers WHERE email = $1',
    [normalized],
  );
  if (existing.rows[0]) {
    // Backfill a name if we learn it later but didn't have it at creation.
    if (!existing.rows[0].name && name) {
      await exec.query('UPDATE customers SET name = $1 WHERE id = $2', [
        name,
        existing.rows[0].id,
      ]);
      existing.rows[0].name = name;
    }
    return existing.rows[0];
  }
  const created = await exec.query<Customer>(
    'INSERT INTO customers (email, name) VALUES ($1, $2) RETURNING *',
    [normalized, name],
  );
  return created.rows[0];
}

export async function getCustomer(id: string): Promise<Customer> {
  const row = await queryOne<Customer>('SELECT * FROM customers WHERE id = $1', [id]);
  if (!row) throw notFound('Customer not found');
  return row;
}

/** Full interaction history: every ticket the customer has ever opened. */
export async function getCustomerHistory(customerId: string): Promise<{
  customer: Customer;
  tickets: Array<Record<string, unknown>>;
  csat: { responses: number; average: number | null };
}> {
  const customer = await getCustomer(customerId);
  const tickets = await query(
    `SELECT id, subject, status, priority, channel, created_at, resolved_at
       FROM tickets
      WHERE customer_id = $1
      ORDER BY created_at DESC`,
    [customerId],
  );
  const csat = await queryOne<{ responses: string; average: string | null }>(
    `SELECT count(score) AS responses, avg(score) AS average
       FROM csat_surveys s
       JOIN tickets t ON t.id = s.ticket_id
      WHERE t.customer_id = $1`,
    [customerId],
  );
  return {
    customer,
    tickets,
    csat: {
      responses: Number(csat?.responses ?? 0),
      average: csat?.average ? Number(csat.average) : null,
    },
  };
}

/**
 * GDPR erasure: scrub direct identifiers but keep the ticket records for
 * SLA/reporting integrity. Idempotent — safe to call twice.
 */
export async function anonymizeCustomer(id: string, exec: Executor = pool): Promise<void> {
  await exec.query(
    `UPDATE customers
        SET email = 'anonymized+' || id || '@deleted.invalid',
            name = NULL, phone = NULL, attributes = '{}',
            anonymized_at = now()
      WHERE id = $1 AND anonymized_at IS NULL`,
    [id],
  );
}
