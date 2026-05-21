/**
 * Postgres access layer — a thin wrapper over `pg`'s connection pool.
 *
 * We deliberately use parameterized SQL rather than an ORM: the schema is
 * stable, the queries are reporting-heavy, and explicit SQL keeps the FTS and
 * SLA logic auditable. `tx()` runs a function inside a transaction.
 */
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { config } from './config';
import { logger } from './logger';

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => {
  logger.error({ err }, 'idle postgres client error');
});

/** Run a parameterized query and return the rows. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await pool.query<T>(text, params);
  return res.rows;
}

/** Run a query expected to return exactly one row, or undefined. */
export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  const rows = await query<T>(text, params);
  return rows[0];
}

/**
 * Execute `fn` inside a transaction. The callback receives a dedicated client;
 * commits on success, rolls back on any thrown error.
 */
export async function tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
