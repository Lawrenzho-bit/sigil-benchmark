from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.sla import SLATarget
from app.models.ticket import Ticket, TicketStatus
from app.models.user import User, UserRole
from app.services.auth import require_role

router = APIRouter()


def _date_range(days: int) -> tuple[datetime, datetime]:
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=days)
    return start, end


@router.get("/volume")
def volume(
    days: int = 30,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(UserRole.AGENT, UserRole.SUPERVISOR, UserRole.ADMIN)),
):
    start, end = _date_range(days)
    rows = db.execute(
        select(
            func.date_trunc("day", Ticket.created_at).label("day"),
            func.count(Ticket.id),
        )
        .where(Ticket.created_at.between(start, end))
        .group_by("day")
        .order_by("day")
    ).all()
    return {"start": start.isoformat(), "end": end.isoformat(), "series": [{"day": r[0].isoformat(), "count": r[1]} for r in rows]}


@router.get("/sla")
def sla_compliance(
    days: int = 30,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(UserRole.SUPERVISOR, UserRole.ADMIN)),
):
    start, end = _date_range(days)
    rows = db.execute(
        select(
            SLATarget.kind,
            func.count(SLATarget.id).label("total"),
            func.sum(case((SLATarget.breached.is_(True), 1), else_=0)).label("breached"),
        )
        .where(SLATarget.created_at.between(start, end))
        .group_by(SLATarget.kind)
    ).all()

    summary = []
    for kind, total, breached in rows:
        total = total or 0
        breached = breached or 0
        compliance = 1 - (breached / total) if total else 1.0
        summary.append({"kind": kind.value, "total": int(total), "breached": int(breached), "compliance": round(compliance, 4)})
    return {"window_days": days, "by_kind": summary}


@router.get("/agents")
def agent_performance(
    days: int = 30,
    db: Session = Depends(get_db),
    _user: User = Depends(require_role(UserRole.SUPERVISOR, UserRole.ADMIN)),
):
    start, end = _date_range(days)
    rows = db.execute(
        select(
            User.id,
            User.name,
            func.count(Ticket.id).label("assigned"),
            func.sum(case((Ticket.status == TicketStatus.RESOLVED, 1), else_=0)).label("resolved"),
            func.avg(
                func.extract("epoch", Ticket.first_response_at - Ticket.created_at)
            ).label("avg_first_response_seconds"),
        )
        .join(Ticket, Ticket.assignee_id == User.id, isouter=True)
        .where(Ticket.created_at.between(start, end))
        .group_by(User.id, User.name)
        .order_by(func.count(Ticket.id).desc())
    ).all()

    return {
        "window_days": days,
        "agents": [
            {
                "id": str(r[0]),
                "name": r[1],
                "assigned": int(r[2] or 0),
                "resolved": int(r[3] or 0),
                "avg_first_response_seconds": float(r[4]) if r[4] is not None else None,
            }
            for r in rows
        ],
    }
