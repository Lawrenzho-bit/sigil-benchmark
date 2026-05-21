"""Ticket lifecycle: create, reply, assign, status transitions, merge, split."""

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import and_, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.models.message import Message, MessageChannel, MessageKind
from app.models.sla import SLAPolicy
from app.models.ticket import Ticket, TicketChannel, TicketPriority, TicketStatus, TicketTag
from app.models.user import Customer
from app.schemas.ticket import TicketCreate, TicketFilter, TicketUpdate
from app.services import audit, sla_engine


def _next_ticket_number(db: Session) -> int:
    """Atomically allocate the next ticket number via a Postgres sequence."""
    row = db.execute(text("SELECT nextval('tickets_number_seq')")).first()
    return int(row[0])


def _upsert_customer(db: Session, email: str, name: str | None) -> Customer:
    customer = db.execute(
        select(Customer).where(Customer.email == email.lower())
    ).scalar_one_or_none()
    if customer:
        if name and not customer.name:
            customer.name = name
        return customer
    customer = Customer(email=email.lower(), name=name)
    db.add(customer)
    db.flush()
    return customer


def _resolve_tags(db: Session, names: list[str]) -> list[TicketTag]:
    if not names:
        return []
    tags: list[TicketTag] = []
    for n in {n.strip().lower() for n in names if n.strip()}:
        tag = db.execute(select(TicketTag).where(TicketTag.name == n)).scalar_one_or_none()
        if not tag:
            tag = TicketTag(name=n)
            db.add(tag)
            db.flush()
        tags.append(tag)
    return tags


def _default_sla_policy(db: Session) -> SLAPolicy | None:
    return db.execute(select(SLAPolicy).where(SLAPolicy.is_default.is_(True))).scalar_one_or_none()


def create_ticket(db: Session, payload: TicketCreate, *, actor_id: str | None = None) -> Ticket:
    customer = _upsert_customer(db, payload.customer_email, payload.customer_name)
    policy = _default_sla_policy(db)

    ticket = Ticket(
        number=_next_ticket_number(db),
        subject=payload.subject[:500],
        priority=payload.priority,
        channel=payload.channel,
        customer_id=customer.id,
        sla_policy_id=policy.id if policy else None,
        metadata_=payload.metadata or {},
        tags=_resolve_tags(db, payload.tags),
    )
    db.add(ticket)
    db.flush()

    message = Message(
        ticket_id=ticket.id,
        kind=MessageKind.CUSTOMER_REPLY,
        channel=MessageChannel[payload.channel.value.upper()] if payload.channel.value.upper() in MessageChannel.__members__ else MessageChannel.WEB,
        customer_id=customer.id,
        body_text=payload.body,
    )
    db.add(message)

    sla_engine.attach_initial_targets(db, ticket, policy)

    audit.record(
        db,
        actor_type="customer" if actor_id is None else "user",
        actor_id=actor_id or str(customer.id),
        action="ticket.create",
        target_type="ticket",
        target_id=str(ticket.id),
        metadata={"channel": payload.channel.value, "number": ticket.number},
    )

    db.commit()
    db.refresh(ticket)
    return ticket


def reply(
    db: Session,
    ticket_id: UUID,
    *,
    body: str,
    author_id: UUID | None = None,
    customer_id: UUID | None = None,
    kind: MessageKind,
    channel: MessageChannel,
    is_internal: bool = False,
    external_id: str | None = None,
    in_reply_to: str | None = None,
    references: str | None = None,
    headers: dict | None = None,
) -> Message:
    ticket = db.get(Ticket, ticket_id)
    if ticket is None:
        raise LookupError(f"ticket {ticket_id} not found")

    is_internal = is_internal or kind == MessageKind.INTERNAL_NOTE

    msg = Message(
        ticket_id=ticket.id,
        kind=kind,
        channel=channel,
        author_id=author_id,
        customer_id=customer_id,
        body_text=body,
        is_internal=is_internal,
        external_id=external_id,
        in_reply_to=in_reply_to,
        references_=references,
        headers=headers or {},
    )
    db.add(msg)

    now = datetime.now(timezone.utc)

    # If this is the first agent reply, satisfy the FIRST_RESPONSE SLA.
    if kind == MessageKind.AGENT_REPLY and not is_internal:
        sla_engine.mark_first_response(db, ticket, now)
        # Customer-reply moves a NEW ticket to OPEN; an agent reply leaves it OPEN.
        if ticket.status in (TicketStatus.NEW, TicketStatus.PENDING):
            ticket.status = TicketStatus.OPEN

    if kind == MessageKind.CUSTOMER_REPLY:
        # Customer replied → ticket is no longer "pending"; reopen if needed.
        if ticket.status in (TicketStatus.PENDING, TicketStatus.RESOLVED):
            ticket.status = TicketStatus.OPEN

    audit.record(
        db,
        actor_type="user" if author_id else "customer",
        actor_id=str(author_id or customer_id),
        action="message.create",
        target_type="ticket",
        target_id=str(ticket.id),
        metadata={"kind": kind.value, "internal": is_internal, "channel": channel.value},
    )

    db.commit()
    db.refresh(msg)
    return msg


def update_ticket(db: Session, ticket_id: UUID, payload: TicketUpdate, *, actor_id: UUID) -> Ticket:
    ticket = db.get(Ticket, ticket_id)
    if ticket is None:
        raise LookupError(f"ticket {ticket_id} not found")

    changes: dict = {}
    now = datetime.now(timezone.utc)

    if payload.status is not None and payload.status != ticket.status:
        changes["status"] = {"from": ticket.status.value, "to": payload.status.value}
        ticket.status = payload.status
        if payload.status == TicketStatus.RESOLVED:
            sla_engine.mark_resolved(db, ticket, now)
        if payload.status == TicketStatus.CLOSED:
            ticket.closed_at = now

    if payload.priority is not None and payload.priority != ticket.priority:
        changes["priority"] = {"from": ticket.priority.value, "to": payload.priority.value}
        ticket.priority = payload.priority

    if payload.assignee_id is not None and payload.assignee_id != ticket.assignee_id:
        changes["assignee_id"] = {"from": str(ticket.assignee_id), "to": str(payload.assignee_id)}
        ticket.assignee_id = payload.assignee_id

    if payload.team is not None and payload.team != ticket.team:
        changes["team"] = {"from": ticket.team, "to": payload.team}
        ticket.team = payload.team

    if payload.tags is not None:
        ticket.tags = _resolve_tags(db, payload.tags)
        changes["tags"] = payload.tags

    if changes:
        audit.record(
            db,
            actor_type="user",
            actor_id=str(actor_id),
            action="ticket.update",
            target_type="ticket",
            target_id=str(ticket.id),
            metadata={"changes": changes},
        )
    db.commit()
    db.refresh(ticket)
    return ticket


def list_tickets(db: Session, f: TicketFilter):
    q = select(Ticket).options(joinedload(Ticket.assignee))
    if f.status:
        q = q.where(Ticket.status.in_(f.status))
    if f.priority:
        q = q.where(Ticket.priority.in_(f.priority))
    if f.unassigned:
        q = q.where(Ticket.assignee_id.is_(None))
    elif f.assignee_id:
        q = q.where(Ticket.assignee_id == f.assignee_id)
    if f.customer_id:
        q = q.where(Ticket.customer_id == f.customer_id)
    if f.tag:
        q = q.join(Ticket.tags).where(TicketTag.name == f.tag.lower())
    if f.q:
        # Postgres FTS
        q = q.where(text("search_vector @@ websearch_to_tsquery('english', :q)")).params(q=f.q)

    sort_field = f.sort.lstrip("-")
    direction = "desc" if f.sort.startswith("-") else "asc"
    col = getattr(Ticket, sort_field, Ticket.updated_at)
    q = q.order_by(col.desc() if direction == "desc" else col.asc())

    total = db.scalar(select(text("count(*)")).select_from(q.subquery()))
    rows = db.execute(q.offset(f.offset).limit(f.limit)).scalars().unique().all()
    return rows, int(total or 0)


def merge_tickets(db: Session, *, source_id: UUID, target_id: UUID, actor_id: UUID) -> Ticket:
    """Merge `source` into `target`: move messages, mark source MERGED."""
    if source_id == target_id:
        raise ValueError("cannot merge a ticket into itself")

    source = db.get(Ticket, source_id)
    target = db.get(Ticket, target_id)
    if not source or not target:
        raise LookupError("source or target not found")
    if source.status == TicketStatus.MERGED:
        raise ValueError("source already merged")

    # Move messages
    for msg in source.messages:
        msg.ticket_id = target.id

    source.status = TicketStatus.MERGED
    source.merged_into_id = target.id
    source.closed_at = datetime.now(timezone.utc)

    # System message on target documenting merge
    note = Message(
        ticket_id=target.id,
        kind=MessageKind.SYSTEM,
        channel=MessageChannel.API,
        author_id=actor_id,
        body_text=f"Merged from ticket #{source.number}",
        is_internal=True,
    )
    db.add(note)

    audit.record(
        db,
        actor_type="user",
        actor_id=str(actor_id),
        action="ticket.merge",
        target_type="ticket",
        target_id=str(target.id),
        metadata={"source_id": str(source.id), "source_number": source.number},
    )
    db.commit()
    db.refresh(target)
    return target


def split_ticket(
    db: Session,
    *,
    ticket_id: UUID,
    message_ids: list[UUID],
    new_subject: str,
    actor_id: UUID,
) -> Ticket:
    """Split N messages off `ticket` into a new ticket attached to the same customer."""
    src = db.get(Ticket, ticket_id)
    if src is None:
        raise LookupError("ticket not found")

    new = Ticket(
        number=_next_ticket_number(db),
        subject=new_subject[:500],
        priority=src.priority,
        channel=src.channel,
        customer_id=src.customer_id,
    )
    db.add(new)
    db.flush()

    moved = (
        db.query(Message).filter(Message.id.in_(message_ids), Message.ticket_id == src.id).all()
    )
    if not moved:
        raise ValueError("no matching messages to split")
    for m in moved:
        m.ticket_id = new.id

    policy = _default_sla_policy(db)
    sla_engine.attach_initial_targets(db, new, policy)

    audit.record(
        db,
        actor_type="user",
        actor_id=str(actor_id),
        action="ticket.split",
        target_type="ticket",
        target_id=str(new.id),
        metadata={"source_id": str(src.id), "moved_message_ids": [str(m.id) for m in moved]},
    )
    db.commit()
    db.refresh(new)
    return new
