from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app import audit, schemas
from app.auth import client_ip, current_admin, current_agent
from app.db import get_db
from app.models import Role, Ticket, TicketStatus, User


router = APIRouter(prefix="/agent/customers", tags=["agent"])


@router.get("/{customer_id}", response_model=schemas.CustomerProfile)
def get_customer(
    customer_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(current_agent),
):
    customer = db.get(User, customer_id)
    if not customer or customer.role != Role.customer.value:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "customer not found")
    tickets = (db.query(Ticket)
               .filter(Ticket.requester_id == customer.id)
               .order_by(desc(Ticket.created_at)).all())
    open_count = sum(1 for t in tickets if t.status in (
        TicketStatus.new.value, TicketStatus.open.value, TicketStatus.pending.value))
    return schemas.CustomerProfile(
        id=customer.id, email=customer.email, name=customer.name,
        created_at=customer.created_at, ticket_count=len(tickets),
        open_ticket_count=open_count,
        tickets=[schemas.TicketOut.model_validate(t) for t in tickets],
    )


@router.post("/{customer_id}/anonymize", status_code=status.HTTP_204_NO_CONTENT)
def gdpr_anonymize(
    customer_id: int,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(current_admin),
):
    """GDPR erasure: replace PII in-place. Ticket records are retained
    (compliance/audit) but become non-identifying."""
    customer = db.get(User, customer_id)
    if not customer or customer.role != Role.customer.value:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "customer not found")
    customer.email = f"anonymized+{customer.id}@invalid.local"
    customer.name = "[redacted]"
    customer.hashed_password = None
    customer.is_anonymized = True
    audit.record(db, actor=actor, action="user.anonymize", entity_type="user",
                 entity_id=customer.id, ip=client_ip(request))
    db.commit()
