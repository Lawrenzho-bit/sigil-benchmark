"""Audit logging service.

Every security- or compliance-relevant action funnels through `record`, which
writes an append-only row to `audit_logs`. `export_csv` produces the file
handed to auditors.
"""

from __future__ import annotations

import csv
import io
import uuid
from collections.abc import Sequence
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.context import AuthContext
from app.enums import AuditAction
from app.models import AuditLog


async def record(
    db: AsyncSession,
    action: AuditAction,
    *,
    organization_id: uuid.UUID | None = None,
    actor_user_id: uuid.UUID | None = None,
    actor_email: str | None = None,
    target_type: str | None = None,
    target_id: str | uuid.UUID | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
    meta: dict[str, Any] | None = None,
) -> AuditLog:
    """Append one entry to the audit log and return it.

    The row is flushed (not committed) — it shares the request's transaction,
    so an audited action and its log entry commit or roll back together.
    """
    entry = AuditLog(
        action=action.value,
        organization_id=organization_id,
        actor_user_id=actor_user_id,
        actor_email=actor_email,
        target_type=target_type,
        target_id=str(target_id) if target_id is not None else None,
        ip_address=ip_address,
        user_agent=user_agent,
        meta=meta or {},
    )
    db.add(entry)
    await db.flush()
    return entry


async def record_for(
    db: AsyncSession,
    auth: AuthContext,
    action: AuditAction,
    *,
    ip_address: str | None = None,
    user_agent: str | None = None,
    target_type: str | None = None,
    target_id: str | uuid.UUID | None = None,
    meta: dict[str, Any] | None = None,
) -> AuditLog:
    """Convenience wrapper that fills actor/org fields from an AuthContext."""
    return await record(
        db,
        action,
        organization_id=auth.organization.id if auth.organization else None,
        actor_user_id=auth.user.id,
        actor_email=auth.user.email,
        ip_address=ip_address,
        user_agent=user_agent,
        target_type=target_type,
        target_id=target_id,
        meta=meta,
    )


async def list_for_organization(
    db: AsyncSession,
    organization_id: uuid.UUID,
    *,
    limit: int = 50,
    offset: int = 0,
    action_filter: str | None = None,
) -> tuple[Sequence[AuditLog], int]:
    """Return a page of audit entries (newest first) and the total count."""
    base = select(AuditLog).where(AuditLog.organization_id == organization_id)
    if action_filter:
        base = base.where(AuditLog.action == action_filter)

    total = await db.scalar(
        select(func.count()).select_from(base.subquery())
    )
    rows = await db.scalars(
        base.order_by(AuditLog.created_at.desc()).limit(limit).offset(offset)
    )
    return rows.all(), int(total or 0)


async def export_csv(db: AsyncSession, organization_id: uuid.UUID) -> str:
    """Return the organization's full audit history as CSV text."""
    rows = await db.scalars(
        select(AuditLog)
        .where(AuditLog.organization_id == organization_id)
        .order_by(AuditLog.created_at.asc())
    )
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        ["timestamp", "action", "actor_email", "target_type", "target_id", "ip_address"]
    )
    for row in rows:
        writer.writerow(
            [
                row.created_at.isoformat(),
                row.action,
                row.actor_email or "",
                row.target_type or "",
                row.target_id or "",
                row.ip_address or "",
            ]
        )
    return buffer.getvalue()
