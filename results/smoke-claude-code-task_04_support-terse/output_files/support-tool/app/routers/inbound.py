"""Inbound email webhook.

Production assumption: an email-receiving service (Postmark, SendGrid, SES +
Lambda, Mailgun) MIME-parses the message, strips signatures, handles attachments,
and posts a normalized JSON payload here. SPF/DKIM/DMARC verification happens
upstream; we trust a shared secret on the webhook itself.
"""
from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app import audit, schemas, sla
from app.config import settings
from app.db import get_db
from app.models import (
    Attachment,
    Channel,
    Comment,
    CommentVisibility,
    Role,
    Ticket,
    TicketStatus,
    User,
)


router = APIRouter(prefix="/inbound", tags=["inbound"])


def _verify_secret(x_inbound_secret: str | None = Header(None)) -> None:
    if x_inbound_secret != settings.inbound_webhook_secret:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "bad webhook secret")


@router.post("/email", response_model=schemas.TicketOut)
def inbound_email(
    payload: schemas.InboundEmail,
    db: Session = Depends(get_db),
    _=Depends(_verify_secret),
):
    # Find-or-create requester (no password — they auth via email link in real life).
    requester = db.query(User).filter(User.email == payload.from_email).first()
    if not requester:
        requester = User(
            email=payload.from_email,
            name=payload.from_name or payload.from_email,
            role=Role.customer.value,
            hashed_password=None,
        )
        db.add(requester)
        db.flush()

    # Thread continuation: client provides public_id (parsed from References/In-Reply-To headers).
    ticket: Ticket | None = None
    if payload.in_reply_to_public_id:
        ticket = (db.query(Ticket)
                  .filter(Ticket.public_id == payload.in_reply_to_public_id).first())
        if ticket and ticket.requester_id != requester.id:
            # Belongs to a different requester — treat as new ticket for safety.
            ticket = None

    if ticket is None:
        ticket = Ticket(
            public_id=Ticket.generate_public_id(),
            subject=payload.subject or "(no subject)",
            description=payload.text_body,
            requester_id=requester.id,
            channel=Channel.email.value,
        )
        db.add(ticket)
        db.flush()
        sla.initialize_sla(db, ticket)
        audit.record(db, actor=None, action="ticket.create", entity_type="ticket",
                     entity_id=ticket.id, payload={"channel": "email"})
    else:
        comment = Comment(
            ticket_id=ticket.id, author_id=requester.id,
            visibility=CommentVisibility.public.value, body=payload.text_body, from_email=True,
        )
        db.add(comment)
        if ticket.status == TicketStatus.pending.value:
            ticket.status = TicketStatus.open.value
        audit.record(db, actor=requester, action="comment.create", entity_type="ticket",
                     entity_id=ticket.id, payload={"visibility": "public", "channel": "email"})

    for att in payload.attachments:
        db.add(Attachment(
            ticket_id=ticket.id,
            filename=att.filename, content_type=att.content_type,
            size_bytes=att.size_bytes, storage_url=att.storage_url,
        ))

    db.commit()
    db.refresh(ticket)
    return ticket
