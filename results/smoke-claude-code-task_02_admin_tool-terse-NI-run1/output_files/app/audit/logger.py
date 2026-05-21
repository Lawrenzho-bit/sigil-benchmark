"""Centralized audit logging. Every privileged admin action MUST go through `record()`."""
import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.auth.deps import CurrentAdmin
from app.models.audit import AuditLog

_SENSITIVE_KEYS = {"password", "token", "token_hash", "secret", "api_key"}


def _redact(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: ("***" if k.lower() in _SENSITIVE_KEYS else _redact(v)) for k, v in value.items()}
    if isinstance(value, list):
        return [_redact(v) for v in value]
    return value


def diff_dicts(before: dict | None, after: dict | None) -> dict | None:
    """Compute a JSON-serializable diff between two dict snapshots."""
    before = _redact(before or {})
    after = _redact(after or {})
    changes = {}
    keys = set(before) | set(after)
    for k in keys:
        b, a = before.get(k), after.get(k)
        if b != a:
            changes[k] = {"before": b, "after": a}
    return changes or None


def record(
    db: Session,
    *,
    actor: CurrentAdmin,
    action: str,
    target_type: str,
    target_id: str | uuid.UUID,
    before: dict | None = None,
    after: dict | None = None,
    extra: dict | None = None,
    impersonating_user_id: uuid.UUID | None = None,
) -> AuditLog:
    """Persist an audit log entry. Commits ARE deferred to the caller's UoW."""
    entry = AuditLog(
        actor_admin_id=actor.id,
        actor_email=actor.email,
        actor_role=actor.role.value,
        actor_ip=actor.ip,
        action=action,
        target_type=target_type,
        target_id=str(target_id),
        diff=diff_dicts(before, after),
        extra=_redact(extra) if extra else None,
        impersonating_user_id=impersonating_user_id,
    )
    db.add(entry)
    db.flush()
    return entry


def snapshot(obj: Any, fields: list[str]) -> dict:
    """Build a snapshot dict from a SQLAlchemy model for diffing."""
    return {f: _serialize(getattr(obj, f, None)) for f in fields}


def _serialize(v: Any) -> Any:
    if isinstance(v, uuid.UUID):
        return str(v)
    if hasattr(v, "value"):  # enums
        return v.value
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return v
