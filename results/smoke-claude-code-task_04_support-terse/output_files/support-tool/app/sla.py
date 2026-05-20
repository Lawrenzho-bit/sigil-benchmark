"""SLA target lookup + breach detection.

Targets are loaded from settings (env var `SLA_TARGETS_JSON`). A breach is
recorded on the SLA row the first time we observe a missed deadline; this
makes 'has breached' a simple indexed boolean rather than a recomputation.

Breach detection runs on two triggers:
  1. On every ticket read (cheap row update if breached).
  2. From a periodic background scan (`scan_breaches`) so a ticket that's
     simply sitting idle still gets flagged. The scan is also the hook for
     dispatching alerts (Slack/PagerDuty/email).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import SLAState, Ticket, TicketStatus


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime) -> datetime:
    """SQLite round-trips strip tz info; treat naive timestamps as UTC."""
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def targets_for(priority: str) -> tuple[int, int]:
    t = settings.sla_targets.get(priority) or settings.sla_targets["normal"]
    return t["first_response_min"], t["resolution_min"]


def initialize_sla(db: Session, ticket: Ticket) -> SLAState:
    fr_min, res_min = targets_for(ticket.priority)
    base = _aware(ticket.created_at)
    state = SLAState(
        ticket_id=ticket.id,
        first_response_due_at=base + timedelta(minutes=fr_min),
        resolution_due_at=base + timedelta(minutes=res_min),
    )
    db.add(state)
    return state


def repoint_sla(db: Session, ticket: Ticket) -> None:
    """Recompute SLA targets when priority changes. Past breaches are preserved."""
    if not ticket.sla:
        initialize_sla(db, ticket)
        return
    fr_min, res_min = targets_for(ticket.priority)
    base = _aware(ticket.created_at)
    ticket.sla.first_response_due_at = base + timedelta(minutes=fr_min)
    ticket.sla.resolution_due_at = base + timedelta(minutes=res_min)


def evaluate(ticket: Ticket, now: Optional[datetime] = None) -> None:
    """Update breach timestamps on the ticket's SLA row in-place.

    Caller is responsible for committing the session. Records breach exactly once.
    """
    if not ticket.sla:
        return
    now = now or _now()
    closed = ticket.status in (TicketStatus.resolved.value, TicketStatus.closed.value,
                               TicketStatus.merged.value)
    if (ticket.sla.first_response_breached_at is None
            and ticket.first_responded_at is None
            and now > _aware(ticket.sla.first_response_due_at)):
        ticket.sla.first_response_breached_at = now
    if (ticket.sla.resolution_breached_at is None
            and not closed
            and now > _aware(ticket.sla.resolution_due_at)):
        ticket.sla.resolution_breached_at = now


def scan_breaches(db: Session) -> list[int]:
    """Scan all open tickets, record new breaches, return the IDs newly breached.

    Intended to be called from a background worker (cron/celery).
    """
    now = _now()
    open_statuses = (TicketStatus.new.value, TicketStatus.open.value, TicketStatus.pending.value)
    stmt = (
        select(Ticket)
        .where(Ticket.status.in_(open_statuses))
        .join(SLAState, SLAState.ticket_id == Ticket.id)
    )
    newly_breached: list[int] = []
    for ticket in db.execute(stmt).scalars():
        was_breached = (ticket.sla.first_response_breached_at is not None
                        or ticket.sla.resolution_breached_at is not None)
        evaluate(ticket, now=now)
        is_breached = (ticket.sla.first_response_breached_at is not None
                       or ticket.sla.resolution_breached_at is not None)
        if not was_breached and is_breached:
            newly_breached.append(ticket.id)
    db.commit()
    return newly_breached


def dispatch_breach_alerts(ticket_ids: Iterable[int]) -> None:
    """Hook point for alerting. No-op by default; override in deployment.

    Production wires this to Slack/PagerDuty/email-to-manager.
    """
    for _ in ticket_ids:
        pass
