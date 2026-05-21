"""Dashboard metrics.

Aggregates raw `usage_events`, membership, session, and billing data into the
numbers shown on the dashboard. Time-series bucketing is done in Python so the
queries stay identical on PostgreSQL and SQLite.
"""

from __future__ import annotations

import uuid
from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.enums import MembershipStatus, Role
from app.models import AuditLog, Invitation, Membership, Session, Subscription, UsageEvent
from app.enums import InvitationStatus

_TREND_DAYS = 14


@dataclass(slots=True)
class DashboardMetrics:
    member_count: int = 0
    role_breakdown: dict[str, int] = field(default_factory=dict)
    seats_used: int = 0
    seats_allowed: int = 0
    pending_invitations: int = 0
    active_sessions: int = 0
    events_last_30d: int = 0
    audit_entries_last_30d: int = 0
    # (label, count) pairs, oldest first — the activity sparkline.
    activity_trend: list[tuple[str, int]] = field(default_factory=list)

    @property
    def seat_utilisation(self) -> int:
        if self.seats_allowed <= 0:
            return 0
        return round(100 * self.seats_used / self.seats_allowed)


async def record_usage(
    db: AsyncSession, org_id: uuid.UUID, event_type: str, quantity: int = 1
) -> None:
    """Append a usage event. Cheap and best-effort — feeds the dashboard."""
    db.add(UsageEvent(organization_id=org_id, event_type=event_type, quantity=quantity))
    await db.flush()


async def _count(db: AsyncSession, stmt) -> int:
    return int(await db.scalar(stmt) or 0)


async def compute_dashboard(
    db: AsyncSession, org_id: uuid.UUID, subscription: Subscription | None
) -> DashboardMetrics:
    """Build the full set of dashboard metrics for an organization."""
    now = datetime.now(UTC)
    since_30d = now - timedelta(days=30)
    metrics = DashboardMetrics()

    # Members + role breakdown.
    member_rows = await db.scalars(
        select(Membership.role).where(
            Membership.organization_id == org_id,
            Membership.status == MembershipStatus.ACTIVE,
        )
    )
    roles = Counter(member_rows.all())
    metrics.member_count = sum(roles.values())
    metrics.role_breakdown = {
        r.label: roles.get(r, 0) for r in (Role.OWNER, Role.ADMIN, Role.VIEWER)
    }

    # Seats.
    metrics.seats_used = metrics.member_count
    metrics.seats_allowed = subscription.seats if subscription else 0

    # Pending invitations.
    metrics.pending_invitations = await _count(
        db,
        select(func.count())
        .select_from(Invitation)
        .where(
            Invitation.organization_id == org_id,
            Invitation.status == InvitationStatus.PENDING,
        ),
    )

    # Active (non-expired, non-revoked) sessions for members of this org.
    metrics.active_sessions = await _count(
        db,
        select(func.count())
        .select_from(Session)
        .where(
            Session.active_organization_id == org_id,
            Session.revoked_at.is_(None),
            Session.expires_at > now,
        ),
    )

    # Audit volume in the last 30 days.
    metrics.audit_entries_last_30d = await _count(
        db,
        select(func.count())
        .select_from(AuditLog)
        .where(AuditLog.organization_id == org_id, AuditLog.created_at >= since_30d),
    )

    # Usage trend — fetch recent events and bucket them by day in Python.
    since_trend = now - timedelta(days=_TREND_DAYS)
    events = await db.scalars(
        select(UsageEvent).where(
            UsageEvent.organization_id == org_id,
            UsageEvent.created_at >= since_trend,
        )
    )
    per_day: Counter[str] = Counter()
    total_30d = 0
    events_list = events.all()
    for event in events_list:
        created = event.created_at
        if created.tzinfo is None:
            created = created.replace(tzinfo=UTC)
        per_day[created.strftime("%Y-%m-%d")] += event.quantity
        total_30d += event.quantity
    metrics.events_last_30d = total_30d

    trend: list[tuple[str, int]] = []
    for offset in range(_TREND_DAYS - 1, -1, -1):
        day = (now - timedelta(days=offset)).strftime("%Y-%m-%d")
        trend.append((day[5:], per_day.get(day, 0)))  # label as MM-DD
    metrics.activity_trend = trend
    return metrics
