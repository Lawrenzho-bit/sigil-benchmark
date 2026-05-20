"""Lightweight rollup endpoints. Production reporting belongs in a warehouse —
this is illustrative only and is plenty fast at the spec's stated volumes for
ad-hoc agent dashboards."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.auth import current_agent
from app.db import get_db
from app.models import Comment, CommentVisibility, Role, SLAState, Ticket, TicketStatus, User


router = APIRouter(prefix="/agent/reports", tags=["agent"])


@router.get("/agent-performance")
def agent_performance(
    db: Session = Depends(get_db),
    _: User = Depends(current_agent),
    days: int = Query(30, ge=1, le=365),
):
    since = datetime.now(timezone.utc) - timedelta(days=days)
    rows = (
        db.query(
            User.id.label("agent_id"),
            User.name.label("agent_name"),
            func.count(Ticket.id).label("assigned"),
            func.sum(case((Ticket.status == TicketStatus.resolved.value, 1), else_=0)).label("resolved"),
            func.sum(case((Ticket.status == TicketStatus.closed.value, 1), else_=0)).label("closed"),
        )
        .outerjoin(Ticket, (Ticket.assignee_id == User.id) & (Ticket.created_at >= since))
        .filter(User.role.in_([Role.agent.value, Role.admin.value]))
        .group_by(User.id, User.name)
        .all()
    )
    return [dict(r._mapping) for r in rows]


@router.get("/sla-compliance")
def sla_compliance(db: Session = Depends(get_db), _: User = Depends(current_agent)):
    total = db.query(func.count(SLAState.ticket_id)).scalar() or 0
    fr_breached = (db.query(func.count(SLAState.ticket_id))
                   .filter(SLAState.first_response_breached_at.isnot(None)).scalar() or 0)
    res_breached = (db.query(func.count(SLAState.ticket_id))
                    .filter(SLAState.resolution_breached_at.isnot(None)).scalar() or 0)
    pct = lambda n: round(100 * (1 - (n / total)), 2) if total else 100.0
    return {
        "total": total,
        "first_response_breached": fr_breached,
        "resolution_breached": res_breached,
        "first_response_compliance_pct": pct(fr_breached),
        "resolution_compliance_pct": pct(res_breached),
    }


@router.get("/ticket-volume")
def ticket_volume(
    db: Session = Depends(get_db),
    _: User = Depends(current_agent),
    days: int = Query(30, ge=1, le=365),
):
    since = datetime.now(timezone.utc) - timedelta(days=days)
    # Day bucketing — uses func.date which is portable enough for sqlite + postgres.
    rows = (
        db.query(func.date(Ticket.created_at).label("day"),
                 func.count(Ticket.id).label("count"))
        .filter(Ticket.created_at >= since)
        .group_by(func.date(Ticket.created_at))
        .order_by(func.date(Ticket.created_at))
        .all()
    )
    return [{"day": str(r.day), "count": r.count} for r in rows]
