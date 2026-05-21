from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.message import MessageChannel
from app.models.ticket import TicketPriority, TicketStatus
from app.models.user import User
from app.schemas.ticket import (
    MessageIn,
    MessageOut,
    TicketCreate,
    TicketDetail,
    TicketFilter,
    TicketListItem,
    TicketUpdate,
)
from app.services import email_outbound, slack, tickets
from app.services.auth import current_user

router = APIRouter()


def _ticket_to_detail(ticket) -> dict:
    return {
        "id": ticket.id,
        "number": ticket.number,
        "subject": ticket.subject,
        "status": ticket.status,
        "priority": ticket.priority,
        "channel": ticket.channel,
        "customer_id": ticket.customer_id,
        "assignee_id": ticket.assignee_id,
        "team": ticket.team,
        "first_response_due_at": ticket.first_response_due_at,
        "first_response_at": ticket.first_response_at,
        "resolve_due_at": ticket.resolve_due_at,
        "resolved_at": ticket.resolved_at,
        "closed_at": ticket.closed_at,
        "tags": [t.name for t in ticket.tags],
        "messages": [MessageOut.model_validate(m) for m in ticket.messages],
        "created_at": ticket.created_at,
        "updated_at": ticket.updated_at,
    }


@router.post("", response_model=TicketDetail, status_code=201)
def create(payload: TicketCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    t = tickets.create_ticket(db, payload, actor_id=str(user.id))
    return _ticket_to_detail(t)


@router.get("", response_model=dict)
def list_(
    db: Session = Depends(get_db),
    _user: User = Depends(current_user),
    status: list[TicketStatus] | None = Query(default=None),
    priority: list[TicketPriority] | None = Query(default=None),
    assignee_id: UUID | None = None,
    unassigned: bool = False,
    customer_id: UUID | None = None,
    tag: str | None = None,
    q: str | None = None,
    sort: str = "-updated_at",
    limit: int = 50,
    offset: int = 0,
):
    f = TicketFilter(
        status=status,
        priority=priority,
        assignee_id=assignee_id,
        unassigned=unassigned,
        customer_id=customer_id,
        tag=tag,
        q=q,
        sort=sort,
        limit=limit,
        offset=offset,
    )
    rows, total = tickets.list_tickets(db, f)
    return {"total": total, "items": [TicketListItem.model_validate(r).model_dump(mode="json") for r in rows]}


@router.get("/{ticket_id}", response_model=TicketDetail)
def get_one(ticket_id: UUID, db: Session = Depends(get_db), _user: User = Depends(current_user)):
    from app.models.ticket import Ticket

    t = db.get(Ticket, ticket_id)
    if not t:
        raise HTTPException(404, "not_found")
    return _ticket_to_detail(t)


@router.patch("/{ticket_id}", response_model=TicketDetail)
def update(
    ticket_id: UUID,
    payload: TicketUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    t = tickets.update_ticket(db, ticket_id, payload, actor_id=user.id)
    return _ticket_to_detail(t)


@router.post("/{ticket_id}/messages", response_model=MessageOut, status_code=201)
def add_message(
    ticket_id: UUID,
    payload: MessageIn,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    from app.models.message import MessageKind
    from app.models.ticket import Ticket

    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(404, "ticket_not_found")

    msg = tickets.reply(
        db,
        ticket_id,
        body=payload.body,
        author_id=user.id,
        kind=payload.kind,
        channel=payload.channel,
        is_internal=payload.is_internal,
    )

    # If this is a public agent reply, send it outbound on the original channel.
    if not msg.is_internal and msg.kind == MessageKind.AGENT_REPLY:
        if ticket.channel.value == "email":
            try:
                email_outbound.send(msg, ticket)
            except Exception:
                # Don't block the API on transient SMTP failure; the worker retries.
                pass
        elif ticket.channel.value == "slack":
            slack.post_reply(ticket, msg.body_text)

    return msg


@router.post("/{source_id}/merge/{target_id}", response_model=TicketDetail)
def merge(
    source_id: UUID,
    target_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    try:
        t = tickets.merge_tickets(db, source_id=source_id, target_id=target_id, actor_id=user.id)
    except (LookupError, ValueError) as e:
        raise HTTPException(400, str(e))
    return _ticket_to_detail(t)


@router.post("/{ticket_id}/split", response_model=TicketDetail)
def split(
    ticket_id: UUID,
    message_ids: list[UUID],
    new_subject: str,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    try:
        t = tickets.split_ticket(
            db,
            ticket_id=ticket_id,
            message_ids=message_ids,
            new_subject=new_subject,
            actor_id=user.id,
        )
    except (LookupError, ValueError) as e:
        raise HTTPException(400, str(e))
    return _ticket_to_detail(t)
