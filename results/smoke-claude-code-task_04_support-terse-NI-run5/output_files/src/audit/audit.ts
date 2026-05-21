/**
 * Append-only audit logging (SOC2). Every state-changing action records who did
 * what to which entity. Writes accept an optional transaction client so the audit
 * row commits atomically with the change it describes.
 */
import type { PoolClient } from 'pg';
import { pool } from '../db/pool';
import type { Principal } from '../auth/tokens';
import { logger } from '../logger';

export interface AuditEntry {
  actor: Principal | 'system';
  action: string;
  entityType: string;
  entityId?: number | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

export async function audit(entry: AuditEntry, client?: PoolClient): Promise<void> {
  const actorType = entry.actor === 'system' ? 'system' : entry.actor.type;
  const actorId = entry.actor === 'system' ? null : entry.actor.id;
  const runner = client ?? pool;
  try {
    await runner.query(
      `INSERT INTO audit_log (actor, actor_id, action, entity_type, entity_id, metadata, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        actorType,
        actorId,
        entry.action,
        entry.entityType,
        entry.entityId ?? null,
        JSON.stringify(entry.metadata ?? {}),
        entry.ip ?? null,
      ],
    );
  } catch (err) {
    // Audit failure must never mask the underlying operation, but it must be loud.
    logger.error({ err, action: entry.action }, 'failed to write audit log entry');
    if (client) throw err; // inside a txn, surface it so the caller can roll back
  }
}
