"""GDPR retention: scrub closed tickets older than retention window."""

from datetime import datetime, timedelta, timezone

import structlog
from sqlalchemy import select

from app.config import get_settings
from app.db import SessionLocal
from app.models.audit import AuditEvent
from app.models.ticket import Ticket, TicketStatus
from app.services import gdpr

log = structlog.get_logger(__name__)
settings = get_settings()


def tick() -> int:
    db = SessionLocal()
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(days=settings.retention_days_closed_tickets)
        old_closed = (
            db.execute(
                select(Ticket)
                .where(Ticket.status == TicketStatus.CLOSED)
                .where(Ticket.closed_at < cutoff)
                .limit(500)
            )
            .scalars()
            .all()
        )
        for t in old_closed:
            gdpr.data_subject_erase(db, t.customer_id, actor_id="system:retention_sweeper")

        # Prune audit log past its retention.
        audit_cutoff = datetime.now(timezone.utc) - timedelta(days=settings.audit_log_retention_days)
        db.query(AuditEvent).filter(AuditEvent.created_at < audit_cutoff).delete()
        db.commit()
        return len(old_closed)
    finally:
        db.close()


if __name__ == "__main__":
    print(tick())
