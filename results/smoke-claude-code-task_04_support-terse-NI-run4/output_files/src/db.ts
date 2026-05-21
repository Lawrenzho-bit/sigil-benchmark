import { Pool, PoolClient, QueryResultRow } from 'pg';
import { config } from './config';
import { logger } from './logger';

/**
 * Single shared connection pool. At 10k agents the API runs many replicas;
 * keep PG_POOL_MAX modest per replica so total connections stay under the
 * Postgres `max_connections` ceiling (use PgBouncer in front for real scale).
 */
export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: config.pgPoolMax,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  logger.error({ err }, 'idle postgres client error');
});

/** Run a parameterised query. Always pass values as params — never interpolate. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

/** Convenience for queries expected to return exactly one row (or none). */
export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/**
 * Run `fn` inside a transaction, committing on success and rolling back on
 * any thrown error. Used for multi-step mutations (merge, split, macro apply).
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
