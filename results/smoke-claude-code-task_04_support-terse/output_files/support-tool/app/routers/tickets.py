"""Ticket endpoints — customer-facing and agent-facing kept distinct.

Internal-note isolation is enforced in two places:
  1. Customer routes select only `visibility='public'` comments.
  2. The customer-facing add-comment endpoint always sets visibility='public'
     server-side, ignoring any client value.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import desc, select
from sqlalchemy.orm import Session, selectinload

from app import audit, schemas, sla
from app.auth import client_ip, current_agent, current_customer, current_user
from app.db import get_db
from app.models import (
    Channel,
    Comment,
    CommentVisibility,
    Role,
    Ticket,
    TicketPriority,
    TicketStatus,
    User,
)


customer_router = APIRouter(prefix="/customer/tickets", tags=["customer"])
agent_router = APIRouter(prefix="/agent/tickets", tags=["agent"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _public_visible_comments(ticket: Ticket) -> list[Comment]:
    return [c for c in ticket.comments if c.visibility == CommentVisibility.public.value]


# ===========================================================================
# Customer routes
# ===========================================================================

@customer_router.post("", response_model=schemas.TicketOut,
                      status_code=status.HTTP_201_CREATED)
def customer_create(
    payload: schemas.TicketCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(current_customer),
):
    ticket = Ticket(
        public_id=Ticket.generate_public_id(),
        subject=payload.subject,
        description=payload.description,
        requester_id=user.id,
        priority=payload.priority,
        channel=Channel.web.value,
        tags=payload.tags,
    )
    db.add(ticket)
    db.flush()
    sla.initialize_sla(db, ticket)
    audit.record(db, actor=user, action="ticket.create", entity_type="ticket",
                 entity_id=ticket.id, payload={"channel": ticket.channel},
                 ip=client_ip(request))
    db.commit()
    db.refresh(ticket)
    return ticket


@customer_router.get("", response_model=list[schemas.TicketOut])
def customer_list(
    db: Session = Depends(get_db),
    user: User = Depends(current_customer),
    limit: int = Query(50, le=200),
    offset: int = 0,
):
    q = (db.query(Ticket)
         .filter(Ticket.requester_id == user.id)
         .order_by(desc(Ticket.created_at))
         .limit(limit).offset(offset))
    return q.all()


@customer_router.get("/{public_id}", response_model=schemas.TicketDetail)
def customer_get(
    public_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(current_customer),
):
    ticket = (db.query(Ticket)
              .options(selectinload(Ticket.comments), selectinload(Ticket.sla))
              .filter(Ticket.public_id == public_id,
                      Ticket.requester_id == user.id)
              .first())
    if not ticket:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "ticket not found")
    sla.evaluate(ticket)
    db.commit()
    db.refresh(ticket)
    # IMPORTANT: filter to public comments only — internal notes never reach customers.
    detail = schemas.TicketDetail.model_validate(ticket)
    detail.comments = [schemas.CommentOut.model_validate(c) for c in _public_visible_comments(ticket)]
    return detail


@customer_router.post("/{public_id}/comments", response_model=schemas.CommentOut,
                      status_code=status.HTTP_201_CREATED)
def customer_comment(
    public_id: str,
    payload: schemas.CommentCreatePublic,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(current_customer),
):
    ticket = (db.query(Ticket)
              .filter(Ticket.public_id == public_id,
                      Ticket.requester_id == user.id).first())
    if not ticket:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "ticket not found")
    if ticket.status == TicketStatus.closed.value:
        raise HTTPException(status.HTTP_409_CONFLICT, "ticket is closed")
    # Customer comments are always public. The schema doesn't carry visibility, but
    # defense-in-depth: we set it explicitly here.
    comment = Comment(
        ticket_id=ticket.id, author_id=user.id,
        visibility=CommentVisibility.public.value, body=payload.body,
    )
    db.add(comment)
    # Reopen if pending; customer replied.
    if ticket.status == TicketStatus.pending.value:
        ticket.status = TicketStatus.open.value
    audit.record(db, actor=user, action="comment.create", entity_type="ticket",
                 entity_id=ticket.id, payload={"visibility": "public"},
                 ip=client_ip(request))
    db.commit()
    db.refresh(comment)
    return comment


@customer_router.post("/{public_id}/csat", status_code=status.HTTP_204_NO_CONTENT)
def customer_csat(
    public_id: str,
    payload: schemas.CSATSubmit,
    token: str = Query(..., description="signed survey token"),
    db: Session = Depends(get_db),
):
    """CSAT is keyed by a token so it can be submitted from an email link without auth."""
    ticket = db.query(Ticket).filter(Ticket.public_id == public_id).first()
    if not ticket or not ticket.csat or ticket.csat.token != token:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "survey not found")
    if ticket.csat.responded_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "already submitted")
    ticket.csat.rating = payload.rating
    ticket.csat.comment = payload.comment
    ticket.csat.responded_at = _now()
    audit.record(db, actor=None, action="csat.submit", entity_type="ticket",
                 entity_id=ticket.id, payload={"rating": payload.rating})
    db.commit()


# ===========================================================================
# Agent routes
# ===========================================================================

@agent_router.get("", response_model=list[schemas.TicketOut])
def agent_list(
    db: Session = Depends(get_db),
    _: User = Depends(current_agent),
    status_filter: Optional[str] = Query(None, alias="status"),
    priority: Optional[str] = None,
    assignee_id: Optional[int] = None,
    requester_id: Optional[int] = None,
    unassigned: bool = False,
    sort: str = Query("created_at_desc",
                      pattern="^(created_at_desc|created_at_asc|priority_desc|updated_at_desc)$"),
    limit: int = Query(50, le=200),
    offset: int = 0,
):
    q = db.query(Ticket)
    if status_filter:
        q = q.filter(Ticket.status == status_filter)
    if priority:
        q = q.filter(Ticket.priority == priority)
    if assignee_id is not None:
        q = q.filter(Ticket.assignee_id == assignee_id)
    if requester_id is not None:
        q = q.filter(Ticket.requester_id == requester_id)
    if unassigned:
        q = q.filter(Ticket.assignee_id.is_(None))

    if sort == "created_at_desc":
        q = q.order_by(desc(Ticket.created_at))
    elif sort == "created_at_asc":
        q = q.order_by(Ticket.created_at)
    elif sort == "updated_at_desc":
        q = q.order_by(desc(Ticket.updated_at))
    elif sort == "priority_desc":
        # urgent > high > normal > low
        q = q.order_by(
            desc(Ticket.priority == TicketPriority.urgent.value),
            desc(Ticket.priority == TicketPriority.high.value),
            desc(Ticket.priority == TicketPriority.normal.value),
            desc(Ticket.created_at),
        )
    return q.limit(limit).offset(offset).all()


@agent_router.get("/breached", response_model=list[schemas.TicketOut])
def agent_breached(db: Session = Depends(get_db), _: User = Depends(current_agent)):
    from app.models import SLAState
    return (db.query(Ticket)
            .join(SLAState, SLAState.ticket_id == Ticket.id)
            .filter((SLAState.first_response_breached_at.isnot(None))
                    | (SLAState.resolution_breached_at.isnot(None)))
            .order_by(desc(Ticket.priority), desc(Ticket.created_at))
            .all())


@agent_router.get("/{ticket_id}", response_model=schemas.TicketDetail)
def agent_get(
    ticket_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(current_agent),
):
    ticket = db.get(
        Ticket, ticket_id,
        options=[selectinload(Ticket.comments), selectinload(Ticket.sla)],
    )
    if not ticket:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "ticket not found")
    sla.evaluate(ticket)
    db.commit()
    db.refresh(ticket)
    return ticket


@agent_router.patch("/{ticket_id}", response_model=schemas.TicketOut)
def agent_update(
    ticket_id: int,
    payload: schemas.TicketUpdate,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(current_agent),
):
    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "ticket not found")
    changes: dict = {}
    if payload.subject is not None and payload.subject != ticket.subject:
        changes["subject"] = [ticket.subject, payload.subject]
        ticket.subject = payload.subject
    if payload.priority is not None and payload.priority != ticket.priority:
        changes["priority"] = [ticket.priority, payload.priority]
        ticket.priority = payload.priority
        sla.repoint_sla(db, ticket)
    if payload.status is not None and payload.status != ticket.status:
        changes["status"] = [ticket.status, payload.status]
        ticket.status = payload.status
        if payload.status == TicketStatus.resolved.value and ticket.resolved_at is None:
            ticket.resolved_at = _now()
            _maybe_create_csat(db, ticket)
        if payload.status == TicketStatus.closed.value and ticket.closed_at is None:
            ticket.closed_at = _now()
    if payload.assignee_id is not None and payload.assignee_id != ticket.assignee_id:
        if payload.assignee_id:
            assignee = db.get(User, payload.assignee_id)
            if not assignee or assignee.role not in (Role.agent.value, Role.admin.value):
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "assignee must be agent/admin")
        changes["assignee_id"] = [ticket.assignee_id, payload.assignee_id]
        ticket.assignee_id = payload.assignee_id
    if payload.tags is not None:
        changes["tags"] = [ticket.tags, payload.tags]
        ticket.tags = payload.tags
    if changes:
        audit.record(db, actor=actor, action="ticket.update", entity_type="ticket",
                     entity_id=ticket.id, payload=changes, ip=client_ip(request))
    db.commit()
    db.refresh(ticket)
    return ticket


@agent_router.post("/{ticket_id}/comments", response_model=schemas.CommentOut,
                   status_code=status.HTTP_201_CREATED)
def agent_comment(
    ticket_id: int,
    payload: schemas.CommentCreateAgent,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(current_agent),
):
    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "ticket not found")
    comment = Comment(
        ticket_id=ticket.id, author_id=actor.id,
        visibility=payload.visibility, body=payload.body,
    )
    db.add(comment)
    # Public agent comment marks first-response if not already.
    if (payload.visibility == CommentVisibility.public.value
            and ticket.first_responded_at is None
            and actor.id != ticket.requester_id):
        ticket.first_responded_at = _now()
    # Public agent reply moves new -> open.
    if payload.visibility == CommentVisibility.public.value and ticket.status == TicketStatus.new.value:
        ticket.status = TicketStatus.open.value
    audit.record(db, actor=actor, action="comment.create", entity_type="ticket",
                 entity_id=ticket.id, payload={"visibility": payload.visibility},
                 ip=client_ip(request))
    db.commit()
    db.refresh(comment)
    return comment


@agent_router.post("/merge", response_model=schemas.TicketOut)
def agent_merge(
    payload: schemas.MergeRequest,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(current_agent),
):
    if payload.source_ticket_id == payload.target_ticket_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "cannot merge a ticket into itself")
    source = db.get(Ticket, payload.source_ticket_id)
    target = db.get(Ticket, payload.target_ticket_id)
    if not source or not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "ticket not found")
    if source.status == TicketStatus.merged.value:
        raise HTTPException(status.HTTP_409_CONFLICT, "source already merged")
    # Move comments from source to target; mark source as merged.
    for comment in list(source.comments):
        comment.ticket_id = target.id
    source.status = TicketStatus.merged.value
    source.merged_into_id = target.id
    audit.record(db, actor=actor, action="ticket.merge", entity_type="ticket",
                 entity_id=source.id, payload={"into": target.id}, ip=client_ip(request))
    db.commit()
    db.refresh(target)
    return target


@agent_router.get("/search/q", response_model=list[schemas.TicketOut])
def agent_search(
    q: str = Query(min_length=1),
    db: Session = Depends(get_db),
    _: User = Depends(current_agent),
):
    from app.search import search_tickets
    return search_tickets(db, q)


def _maybe_create_csat(db: Session, ticket: Ticket) -> None:
    """When a ticket is resolved, create a CSAT survey row (if not already present).

    Sending the email is a separate concern — out of scope for this build but the
    record exists, and `customer_csat` accepts the token.
    """
    from app.models import CSATSurvey
    if ticket.csat is None:
        db.add(CSATSurvey(ticket_id=ticket.id))
