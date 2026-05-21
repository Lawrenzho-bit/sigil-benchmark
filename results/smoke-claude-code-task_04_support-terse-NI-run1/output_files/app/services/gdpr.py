"""GDPR data-subject flows: export and erasure."""

import hashlib
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.message import Message
from app.models.ticket import Ticket
from app.models.user import Customer
from app.services import audit


def data_subject_export(db: Session, customer_id: UUID) -> dict:
    """Return a JSON-serializable dump of all PII held about a customer."""
    customer = db.get(Customer, customer_id)
    if not customer:
        raise LookupError("customer not found")
    tickets = db.execute(select(Ticket).where(Ticket.customer_id == customer_id)).scalars().all()
    return {
        "customer": {
            "id": str(customer.id),
            "email": customer.email,
            "name": customer.name,
            "locale": customer.locale,
            "timezone": customer.timezone,
            "profile": customer.profile,
            "consents": customer.consents,
            "created_at": customer.created_at.isoformat() if customer.created_at else None,
        },
        "tickets": [
            {
                "id": str(t.id),
                "number": t.number,
                "subject": t.subject,
                "status": t.status.value,
                "created_at": t.created_at.isoformat(),
                "messages": [
                    {
                        "id": str(m.id),
                        "created_at": m.created_at.isoformat(),
                        "kind": m.kind.value,
                        "body": m.body_text,
                    }
                    for m in t.messages
                    if not m.is_internal
                ],
            }
            for t in tickets
        ],
    }


def data_subject_erase(db: Session, customer_id: UUID, *, actor_id: str) -> None:
    """Pseudonymize customer record and scrub PII from their messages.

    We DO NOT hard-delete tickets — operational + financial records must persist
    per SOC2 — but we strip names, emails, message bodies, and headers.
    """
    customer = db.get(Customer, customer_id)
    if not customer:
        raise LookupError("customer not found")
    if customer.erased_at:
        return

    pseudonym = "erased-" + hashlib.sha256(str(customer.id).encode()).hexdigest()[:16]
    customer.email = f"{pseudonym}@erased.invalid"
    customer.name = None
    customer.profile = {}
    customer.consents = {}
    customer.password_hash = None
    customer.erased_at = datetime.now(timezone.utc)

    msgs = db.execute(select(Message).where(Message.customer_id == customer_id)).scalars().all()
    for m in msgs:
        m.body_text = "[erased]"
        m.body_html = None
        m.headers = {}

    audit.record(
        db,
        actor_type="user",
        actor_id=actor_id,
        action="customer.gdpr_erase",
        target_type="customer",
        target_id=str(customer_id),
        metadata={"messages_scrubbed": len(msgs)},
    )
    db.commit()
