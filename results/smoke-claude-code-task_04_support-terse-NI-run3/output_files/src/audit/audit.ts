/**
 * Audit logging (SOC2 baseline). Every state-changing operation should call
 * `record()`. The audit_log table is append-only — see migration 003.
 */
import { PoolClient } from 'pg';
import { pool } from '../db';
import { logger } from '../logger';

export interface AuditActor {
  type: 'user' | 'customer' | 'system';
  id?: string;
  label?: string; // email or name, denormalized for human-readable history
  ip?: string;
  userAgent?: string;
}

export interface AuditEntry {
  actor: AuditActor;
  action: string;       // dotted verb, e.g. 'ticket.assign'
  entityType: string;   // 'ticket' | 'user' | 'kb_article' | ...
  entityId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Append an audit record. Accepts an optional transaction client so the audit
 * row commits atomically with the change it describes. Auditing must never
 * break the request: failures are logged, not thrown.
 */
export async function record(entry: AuditEntry, client?: PoolClient): Promise<void> {
  const runner = client ?? pool;
  try {
    await runner.query(
      `INSERT INTO audit_log
         (actor_type, actor_id, actor_label, action, entity_type, entity_id,
          metadata, ip_address, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        entry.actor.type,
        entry.actor.id ?? null,
        entry.actor.label ?? null,
        entry.action,
        entry.entityType,
        entry.entityId ?? null,
        JSON.stringify(entry.metadata ?? {}),
        entry.actor.ip ?? null,
        entry.actor.userAgent ?? null,
      ],
    );
  } catch (err) {
    logger.error({ err, action: entry.action }, 'failed to write audit log entry');
  }
}

export interface AuditQuery {
  entityType?: string;
  entityId?: string;
  actorId?: string;
  action?: string;
  limit?: number;
  before?: string; // ISO timestamp for keyset pagination
}

/** Read the audit trail with optional filters (admin-only at the route layer). */
export async function search(q: AuditQuery) {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (clause: string, value: unknown) => {
    params.push(value);
    where.push(clause.replace('?', `$${params.length}`));
  };
  if (q.entityType) add('entity_type = ?', q.entityType);
  if (q.entityId) add('entity_id = ?', q.entityId);
  if (q.actorId) add('actor_id = ?', q.actorId);
  if (q.action) add('action = ?', q.action);
  if (q.before) add('created_at < ?', q.before);

  params.push(Math.min(q.limit ?? 100, 500));
  const sql = `
    SELECT id, actor_type, actor_id, actor_label, action, entity_type,
           entity_id, metadata, ip_address, created_at
      FROM audit_log
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY created_at DESC
     LIMIT $${params.length}`;
  const res = await pool.query(sql, params);
  return res.rows;
}
