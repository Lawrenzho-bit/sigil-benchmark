from datetime import datetime, timedelta, timezone

from app.models.sla import SLAKind
from app.models.ticket import TicketPriority
from app.schemas.ticket import TicketCreate
from app.services import sla_engine, tickets


def test_priority_scales_sla():
    urgent = sla_engine.default_targets(TicketPriority.URGENT)
    low = sla_engine.default_targets(TicketPriority.LOW)
    assert urgent[SLAKind.FIRST_RESPONSE] < low[SLAKind.FIRST_RESPONSE]
    assert urgent[SLAKind.RESOLUTION] < low[SLAKind.RESOLUTION]


def test_find_breached_returns_overdue_targets(db):
    t = tickets.create_ticket(
        db,
        TicketCreate(subject="s", body="b", customer_email="b@example.com"),
    )
    # Force one of the targets into the past
    fr = next(s for s in t.sla_targets if s.kind == SLAKind.FIRST_RESPONSE)
    fr.due_at = datetime.now(timezone.utc) - timedelta(minutes=5)
    db.commit()

    breached = sla_engine.find_breached(db)
    assert any(b.id == fr.id for b in breached)
