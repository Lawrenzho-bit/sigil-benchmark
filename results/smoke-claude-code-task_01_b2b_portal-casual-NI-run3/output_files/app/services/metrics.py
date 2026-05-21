"""Dashboard metrics.

All counts are tenant-scoped: every query filters by the organization id taken
from the authenticated session, never from request input.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog
from app.models.base import utcnow
from app.models.enums import PLAN_PRICE_USD, PLAN_SEATS, Plan
from app.models.invitation import Invitation
from app.models.membership import Membership
from app.models.organization import Organization
from app.models.session import AuthSession


@dataclass
class DashboardMetrics:
    member_count: int
    seat_limit: int
    pending_invites: int
    active_sessions: int
    plan: Plan
    monthly_cost_usd: int
    logins_last_7d: int
    recent_activity: list[AuditLog]

    @property
    def seats_used_pct(self) -> int:
        if self.seat_limit <= 0:
            return 0
        return min(100, round(self.member_count / self.seat_limit * 100))


def collect(db: Session, org: Organization) -> DashboardMetrics:
    """Gather every dashboard figure for one organization."""
    member_count = (
        db.scalar(
            select(func.count()).select_from(Membership).where(Membership.organization_id == org.id)
        )
        or 0
    )

    pending_invites = (
        db.scalar(
            select(func.count())
            .select_from(Invitation)
            .where(
                Invitation.organization_id == org.id,
                Invitation.accepted_at.is_(None),
                Invitation.revoked_at.is_(None),
                Invitation.expires_at > utcnow(),
            )
        )
        or 0
    )

    active_sessions = (
        db.scalar(
            select(func.count())
            .select_from(AuthSession)
            .where(
                AuthSession.organization_id == org.id,
                AuthSession.revoked_at.is_(None),
                AuthSession.expires_at > utcnow(),
            )
        )
        or 0
    )

    week_ago = utcnow() - timedelta(days=7)
    logins_last_7d = (
        db.scalar(
            select(func.count())
            .select_from(AuditLog)
            .where(
                AuditLog.organization_id == org.id,
                AuditLog.action.in_(["user.login", "user.sso_login"]),
                AuditLog.created_at >= week_ago,
            )
        )
        or 0
    )

    recent_activity = list(
        db.scalars(
            select(AuditLog)
            .where(AuditLog.organization_id == org.id)
            .order_by(AuditLog.created_at.desc())
            .limit(8)
        ).all()
    )

    return DashboardMetrics(
        member_count=member_count,
        seat_limit=PLAN_SEATS[org.plan],
        pending_invites=pending_invites,
        active_sessions=active_sessions,
        plan=org.plan,
        monthly_cost_usd=PLAN_PRICE_USD[org.plan],
        logins_last_7d=logins_last_7d,
        recent_activity=recent_activity,
    )


def seats_available(db: Session, org: Organization) -> int:
    """Remaining seats: members + outstanding invites against the plan limit."""
    used = (
        db.scalar(
            select(func.count()).select_from(Membership).where(Membership.organization_id == org.id)
        )
        or 0
    )
    used += (
        db.scalar(
            select(func.count())
            .select_from(Invitation)
            .where(
                Invitation.organization_id == org.id,
                Invitation.accepted_at.is_(None),
                Invitation.revoked_at.is_(None),
                Invitation.expires_at > utcnow(),
            )
        )
        or 0
    )
    return max(0, PLAN_SEATS[org.plan] - used)
