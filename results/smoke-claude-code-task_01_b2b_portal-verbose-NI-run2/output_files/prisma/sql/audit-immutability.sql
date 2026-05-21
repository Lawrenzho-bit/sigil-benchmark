-- Audit log immutability hardening.
--
-- The AuditLog table is append-only by application convention; this enforces
-- it at the DATABASE level so a bug — or a compromised app credential — cannot
-- silently rewrite history. Run ONCE, after migrations, against your database.
--
-- Replace `portal_app` with the role your application connects as (this should
-- NOT be the same superuser/owner role used to run migrations).
--
--   psql "$DATABASE_URL" -v app_role=portal_app -f prisma/sql/audit-immutability.sql

REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "AuditLog" FROM :app_role;
GRANT INSERT, SELECT ON TABLE "AuditLog" TO :app_role;

-- Belt-and-suspenders: a trigger that rejects UPDATE/DELETE from ANY role.
CREATE OR REPLACE FUNCTION audit_log_is_immutable()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'AuditLog is append-only; % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_no_mutate ON "AuditLog";
CREATE TRIGGER audit_log_no_mutate
    BEFORE UPDATE OR DELETE ON "AuditLog"
    FOR EACH ROW EXECUTE FUNCTION audit_log_is_immutable();

-- NOTE: organization deletion intentionally cascades to AuditLog (see schema).
-- If you must keep audit logs after org deletion, drop the ON DELETE CASCADE
-- on AuditLog_orgId_fkey and archive rows to cold storage before deletion.
