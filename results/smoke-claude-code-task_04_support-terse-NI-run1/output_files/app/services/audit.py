from typing import Any

from sqlalchemy.orm import Session

from app.models.audit import AuditEvent


def record(
    db: Session,
    *,
    actor_type: str,
    actor_id: str | None,
    action: str,
    target_type: str,
    target_id: str | None,
    metadata: dict[str, Any] | None = None,
    ip: str | None = None,
    user_agent: str | None = None,
) -> AuditEvent:
    """Write an append-only audit event. Caller must commit."""
    event = AuditEvent(
        actor_type=actor_type,
        actor_id=actor_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        metadata_=metadata or {},
        ip=ip,
        user_agent=user_agent,
    )
    db.add(event)
    return event
