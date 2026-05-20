"""Audit log helper. Every state-changing action calls `record`.

Required for SOC2 baseline: action, actor, target, timestamp, source IP.
"""
from __future__ import annotations

from typing import Any, Optional

from sqlalchemy.orm import Session

from app.models import AuditEvent, User


def record(
    db: Session,
    *,
    actor: Optional[User],
    action: str,
    entity_type: str,
    entity_id: Optional[str | int] = None,
    payload: Optional[dict[str, Any]] = None,
    ip: Optional[str] = None,
) -> AuditEvent:
    event = AuditEvent(
        actor_id=actor.id if actor else None,
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id is not None else None,
        payload=payload or {},
        ip=ip,
    )
    db.add(event)
    return event
