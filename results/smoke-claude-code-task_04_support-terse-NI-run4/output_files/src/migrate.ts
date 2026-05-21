import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pool } from './db';
import { logger } from './logger';

/**
 * Minimal forward-only migration runner. Each .sql file in db/migrations is
 * applied once, in filename order, inside its own transaction. Applied files
 * are recorded in schema_migrations so re-running is a no-op.
 */
async function migrate(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const dir = join(__dirname, '..', 'db', 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  const applied = new Set(
    (await pool.query<{ filename: string }>('SELECT filename FROM schema_migrations')).rows.map(
      (r) => r.filename,
    ),
  );

  for (const file of files) {
    if (applied.has(file)) {
      logger.debug({ file }, 'migration already applied, skipping');
      continue;
    }
    const sql = readFileSync(join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      logger.info({ file }, 'migration applied');
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error({ file, err }, 'migration failed — aborting');
      throw err;
    } finally {
      client.release();
    }
  }
  logger.info('migrations up to date');
}

migrate()
  .then(() => pool.end())
  .catch((err) => {
    logger.error({ err }, 'migration run failed');
    process.exit(1);
  });
