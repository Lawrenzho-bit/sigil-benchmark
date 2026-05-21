"""Send CSAT surveys for tickets resolved more than `csat_delay_seconds` ago."""

from datetime import datetime, timedelta, timezone

import structlog
from sqlalchemy import select

from app.config import get_settings
from app.db import SessionLocal
from app.models.survey import CSATResponse
from app.models.ticket import Ticket, TicketStatus
from app.services import csat

log = structlog.get_logger(__name__)
settings = get_settings()


def tick() -> int:
    db = SessionLocal()
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=settings.csat_delay_seconds)
        candidates = (
            db.execute(
                select(Ticket)
                .where(Ticket.status == TicketStatus.RESOLVED)
                .where(Ticket.resolved_at < cutoff)
                .where(~Ticket.csat.has())
                .limit(500)
            )
            .scalars()
            .all()
        )
        for t in candidates:
            csat.issue_survey(db, t.id)
            log.info("csat.issued", ticket_id=str(t.id))
        return len(candidates)
    finally:
        db.close()


if __name__ == "__main__":
    print(tick())
