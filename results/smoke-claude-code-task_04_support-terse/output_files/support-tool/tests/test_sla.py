from datetime import datetime, timedelta, timezone

from app import sla
from app.models import Ticket, SLAState


def _make_ticket(db, users, priority="high", created_offset_min=0):
    t = Ticket(
        public_id=Ticket.generate_public_id(),
        subject="S", description="D",
        requester_id=users["customer"].id, priority=priority,
    )
    db.add(t)
    db.flush()
    # Back-date created_at so we can trigger breaches deterministically.
    if created_offset_min:
        t.created_at = datetime.now(timezone.utc) - timedelta(minutes=created_offset_min)
    sla.initialize_sla(db, t)
    db.commit()
    db.refresh(t)
    return t


def test_initialize_sets_due_dates_from_priority(db, users):
    t = _make_ticket(db, users, priority="urgent")
    # urgent: first_response=15min, resolution=240min
    fr = t.sla.first_response_due_at
    res = t.sla.resolution_due_at
    delta_fr = (sla._aware(fr) - sla._aware(t.created_at)).total_seconds() / 60
    delta_res = (sla._aware(res) - sla._aware(t.created_at)).total_seconds() / 60
    assert abs(delta_fr - 15) < 1
    assert abs(delta_res - 240) < 1


def test_evaluate_records_first_response_breach(db, users):
    # high priority: 30 min first-response target. Back-date 60 min.
    t = _make_ticket(db, users, priority="high", created_offset_min=60)
    # Re-init SLA against the back-dated created_at.
    sla.repoint_sla(db, t)
    db.commit()
    sla.evaluate(t)
    db.commit()
    assert t.sla.first_response_breached_at is not None


def test_evaluate_idempotent(db, users):
    t = _make_ticket(db, users, priority="high", created_offset_min=60)
    sla.repoint_sla(db, t)
    db.commit()
    sla.evaluate(t)
    first_breach_ts = t.sla.first_response_breached_at
    sla.evaluate(t)
    sla.evaluate(t)
    assert t.sla.first_response_breached_at == first_breach_ts


def test_first_response_breach_not_recorded_after_response(db, users):
    t = _make_ticket(db, users, priority="high", created_offset_min=60)
    sla.repoint_sla(db, t)
    t.first_responded_at = datetime.now(timezone.utc)  # already responded
    db.commit()
    sla.evaluate(t)
    assert t.sla.first_response_breached_at is None


def test_scan_breaches_returns_newly_breached(db, users):
    t1 = _make_ticket(db, users, priority="high", created_offset_min=60)
    sla.repoint_sla(db, t1)
    db.commit()
    newly = sla.scan_breaches(db)
    assert t1.id in newly
    # Second scan: nothing new.
    newly2 = sla.scan_breaches(db)
    assert t1.id not in newly2


def test_breached_endpoint(client, auth_headers, db, users):
    # Create a ticket through the API, then back-date and re-evaluate.
    r = client.post("/customer/tickets", headers=auth_headers["customer"],
                    json={"subject": "urgent thing", "priority": "urgent"})
    tid = r.json()["id"]
    t = db.get(Ticket, tid)
    t.created_at = datetime.now(timezone.utc) - timedelta(hours=10)
    sla.repoint_sla(db, t)
    db.commit()
    sla.scan_breaches(db)

    r = client.get("/agent/tickets/breached", headers=auth_headers["agent"])
    assert any(tk["id"] == tid for tk in r.json())
