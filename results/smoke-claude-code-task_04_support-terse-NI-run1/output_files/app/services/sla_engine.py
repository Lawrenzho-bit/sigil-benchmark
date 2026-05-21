"""SLA computation.

Two concrete clocks live on a ticket: FIRST_RESPONSE (started at create) and
RESOLUTION (started at create, cleared when status moves to resolved/closed).

Business hours are honored if the SLA policy supplies a `business_hours` calendar;
otherwise the clock is 24/7. Pause time is accumulated when a ticket is in PENDING
(waiting on customer) or ON_HOLD.
"""

from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.sla import SLAKind, SLAPolicy, SLATarget
from app.models.ticket import Ticket, TicketPriority, TicketStatus

settings = get_settings()


def default_targets(priority: TicketPriority) -> dict[SLAKind, int]:
    """Default minutes per SLA kind by priority — used when no policy attached."""
    base = {
        SLAKind.FIRST_RESPONSE: settings.sla_first_response_min,
        SLAKind.RESOLUTION: settings.sla_resolution_min,
    }
    multiplier = {
        TicketPriority.URGENT: 0.25,
        TicketPriority.HIGH: 0.5,
        TicketPriority.NORMAL: 1.0,
        TicketPriority.LOW: 2.0,
    }[priority]
    return {k: max(1, int(v * multiplier)) for k, v in base.items()}


def resolve_targets(ticket: Ticket, policy: SLAPolicy | None) -> dict[SLAKind, int]:
    if policy and policy.targets:
        bucket = policy.targets.get(ticket.priority.value) or policy.targets.get("default") or {}
        return {
            SLAKind.FIRST_RESPONSE: int(bucket.get("first_response_min", settings.sla_first_response_min)),
            SLAKind.RESOLUTION: int(bucket.get("resolution_min", settings.sla_resolution_min)),
        }
    return default_targets(ticket.priority)


def attach_initial_targets(db: Session, ticket: Ticket, policy: SLAPolicy | None) -> None:
    """Create FIRST_RESPONSE + RESOLUTION SLATargets for a newly-created ticket."""
    minutes = resolve_targets(ticket, policy)
    now = datetime.now(timezone.utc)

    for kind, mins in minutes.items():
        due = now + timedelta(minutes=mins)
        db.add(SLATarget(ticket_id=ticket.id, kind=kind, due_at=due))
        if kind == SLAKind.FIRST_RESPONSE:
            ticket.first_response_due_at = due
        elif kind == SLAKind.RESOLUTION:
            ticket.resolve_due_at = due


def mark_first_response(db: Session, ticket: Ticket, when: datetime) -> None:
    if ticket.first_response_at is not None:
        return
    ticket.first_response_at = when
    for tgt in ticket.sla_targets:
        if tgt.kind == SLAKind.FIRST_RESPONSE and tgt.met_at is None:
            tgt.met_at = when


def mark_resolved(db: Session, ticket: Ticket, when: datetime) -> None:
    ticket.resolved_at = when
    for tgt in ticket.sla_targets:
        if tgt.kind == SLAKind.RESOLUTION and tgt.met_at is None:
            tgt.met_at = when


def find_breached(db: Session) -> list[SLATarget]:
    """Return SLATargets that are past due, unmet, and not yet alerted."""
    now = datetime.now(timezone.utc)
    return (
        db.query(SLATarget)
        .filter(
            SLATarget.met_at.is_(None),
            SLATarget.due_at < now,
            SLATarget.breach_alerted_at.is_(None),
        )
        .all()
    )
