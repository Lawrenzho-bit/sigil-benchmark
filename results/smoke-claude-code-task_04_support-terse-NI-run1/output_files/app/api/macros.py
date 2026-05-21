from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.macro import Macro
from app.models.message import MessageChannel, MessageKind
from app.models.ticket import Ticket, TicketPriority, TicketStatus
from app.models.user import User
from app.schemas.macro import MacroCreate, MacroOut
from app.services import tickets
from app.services.auth import current_user

router = APIRouter()


@router.get("", response_model=list[MacroOut])
def list_(db: Session = Depends(get_db), user: User = Depends(current_user)):
    rows = db.execute(
        select(Macro).where((Macro.visibility != "personal") | (Macro.owner_id == user.id)).order_by(Macro.name)
    ).scalars().all()
    return [MacroOut.model_validate(m) for m in rows]


@router.post("", response_model=MacroOut, status_code=201)
def create(payload: MacroCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    m = Macro(
        name=payload.name,
        body=payload.body,
        actions=payload.actions,
        visibility=payload.visibility,
        owner_id=user.id,
    )
    db.add(m)
    db.commit()
    db.refresh(m)
    return MacroOut.model_validate(m)


@router.post("/{macro_id}/apply/{ticket_id}")
def apply_to_ticket(
    macro_id: UUID,
    ticket_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    macro = db.get(Macro, macro_id)
    ticket = db.get(Ticket, ticket_id)
    if not macro or not ticket:
        raise HTTPException(404, "not_found")

    # Insert macro body as agent reply.
    tickets.reply(
        db,
        ticket.id,
        body=macro.body,
        author_id=user.id,
        kind=MessageKind.AGENT_REPLY,
        channel=MessageChannel[ticket.channel.value.upper()] if ticket.channel.value.upper() in MessageChannel.__members__ else MessageChannel.WEB,
    )

    # Apply side-effects.
    actions = macro.actions or {}
    updated = False
    if "set_status" in actions:
        ticket.status = TicketStatus(actions["set_status"])
        updated = True
    if "set_priority" in actions:
        ticket.priority = TicketPriority(actions["set_priority"])
        updated = True
    if "add_tags" in actions:
        from app.services.tickets import _resolve_tags

        existing = {t.name for t in ticket.tags}
        new_tags = [n for n in actions["add_tags"] if n not in existing]
        if new_tags:
            ticket.tags = list(ticket.tags) + _resolve_tags(db, new_tags)
            updated = True

    macro.use_count += 1
    if updated:
        db.commit()
    return {"ok": True}
