import type { Request } from 'express';
import { query } from './db.js';
import type { AuthSubject } from './auth.js';

export interface AuditEntry {
  orgId?: string | null;
  actor: AuthSubject | { kind: 'system'; id?: null };
  action: string;
  target?: { kind: string; id: string } | null;
  meta?: Record<string, unknown>;
  req?: Pick<Request, 'ip' | 'headers'>;
}

// Fire-and-log: a failed audit write must not silently break the app, but it
// also must not block the main request. Errors are logged.
export function audit(e: AuditEntry): void {
  const orgId = e.orgId ?? (e.actor.kind === 'agent' || e.actor.kind === 'customer' ? (e.actor as any).orgId ?? null : null);
  const actorId = e.actor.kind === 'system' ? null : (e.actor as any).id;
  const ip = e.req?.ip ?? null;
  const ua = (e.req?.headers?.['user-agent'] as string | undefined) ?? null;

  query(
    `INSERT INTO audit_log (org_id, actor_kind, actor_id, action,
                            target_kind, target_id, meta, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
    [
      orgId,
      e.actor.kind,
      actorId,
      e.action,
      e.target?.kind ?? null,
      e.target?.id ?? null,
      JSON.stringify(e.meta ?? {}),
      ip,
      ua,
    ],
  ).catch((err) => {
    // Audit log failure: surface to stderr; an external collector should alert.
    console.error('[audit] insert failed:', err);
  });
}
