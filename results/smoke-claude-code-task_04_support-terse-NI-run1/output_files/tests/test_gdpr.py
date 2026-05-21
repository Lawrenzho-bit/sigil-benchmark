from app.schemas.ticket import TicketCreate
from app.services import gdpr, tickets


def test_data_subject_export_returns_all_tickets(db):
    t = tickets.create_ticket(
        db,
        TicketCreate(subject="my data", body="exporting", customer_email="export@example.com"),
    )
    dump = gdpr.data_subject_export(db, t.customer_id)
    assert dump["customer"]["email"] == "export@example.com"
    assert len(dump["tickets"]) == 1
    assert dump["tickets"][0]["number"] == t.number


def test_erase_pseudonymizes_customer_and_scrubs_messages(db):
    t = tickets.create_ticket(
        db,
        TicketCreate(subject="erase me", body="sensitive details", customer_email="erase@example.com"),
    )
    cid = t.customer_id
    gdpr.data_subject_erase(db, cid, actor_id="test")

    db.refresh(t)
    assert t.customer.email.endswith("@erased.invalid")
    assert t.customer.erased_at is not None
    for m in t.messages:
        if m.customer_id == cid:
            assert m.body_text == "[erased]"
