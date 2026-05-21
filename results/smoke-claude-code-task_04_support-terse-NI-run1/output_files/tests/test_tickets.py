from datetime import datetime, timezone

from app.models.message import MessageChannel, MessageKind
from app.models.ticket import TicketPriority, TicketStatus
from app.schemas.ticket import TicketCreate
from app.services import sla_engine, tickets


def test_create_ticket_starts_sla(db):
    t = tickets.create_ticket(
        db,
        TicketCreate(
            subject="Login broken",
            body="I can't log in.",
            customer_email="cust@example.com",
            priority=TicketPriority.HIGH,
        ),
    )
    assert t.number >= 1001
    assert t.status == TicketStatus.NEW
    assert t.first_response_due_at is not None
    assert t.resolve_due_at is not None
    assert len(t.sla_targets) == 2
    assert len(t.messages) == 1
    assert t.messages[0].kind == MessageKind.CUSTOMER_REPLY


def test_first_agent_reply_satisfies_first_response_sla(db, admin_user):
    t = tickets.create_ticket(
        db,
        TicketCreate(
            subject="Help",
            body="I need help.",
            customer_email="x@example.com",
        ),
    )
    assert t.first_response_at is None

    tickets.reply(
        db,
        t.id,
        body="Got it, looking now.",
        author_id=admin_user.id,
        kind=MessageKind.AGENT_REPLY,
        channel=MessageChannel.WEB,
    )

    db.refresh(t)
    assert t.first_response_at is not None
    assert t.status == TicketStatus.OPEN
    fr_target = next(s for s in t.sla_targets if s.kind.value == "first_response")
    assert fr_target.met_at is not None


def test_internal_note_does_not_satisfy_first_response(db, admin_user):
    t = tickets.create_ticket(
        db,
        TicketCreate(subject="Hi", body="...", customer_email="y@example.com"),
    )
    tickets.reply(
        db,
        t.id,
        body="customer is a known abuser",
        author_id=admin_user.id,
        kind=MessageKind.INTERNAL_NOTE,
        channel=MessageChannel.WEB,
        is_internal=True,
    )
    db.refresh(t)
    assert t.first_response_at is None


def test_resolve_marks_resolution_target(db, admin_user):
    from app.schemas.ticket import TicketUpdate

    t = tickets.create_ticket(
        db,
        TicketCreate(subject="x", body="x", customer_email="z@example.com"),
    )
    tickets.update_ticket(db, t.id, TicketUpdate(status=TicketStatus.RESOLVED), actor_id=admin_user.id)
    db.refresh(t)
    assert t.status == TicketStatus.RESOLVED
    assert t.resolved_at is not None
    res_target = next(s for s in t.sla_targets if s.kind.value == "resolution")
    assert res_target.met_at is not None


def test_merge_moves_messages(db, admin_user):
    a = tickets.create_ticket(db, TicketCreate(subject="a", body="a body", customer_email="m@example.com"))
    b = tickets.create_ticket(db, TicketCreate(subject="b", body="b body", customer_email="m@example.com"))
    target = tickets.merge_tickets(db, source_id=a.id, target_id=b.id, actor_id=admin_user.id)
    db.refresh(a)
    assert a.status == TicketStatus.MERGED
    assert a.merged_into_id == b.id
    # Original messages from `a` now live on `b`
    bodies = [m.body_text for m in target.messages]
    assert "a body" in bodies
