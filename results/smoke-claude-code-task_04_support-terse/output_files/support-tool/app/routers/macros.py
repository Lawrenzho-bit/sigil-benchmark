from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import schemas
from app.auth import current_agent
from app.db import get_db
from app.models import Comment, CommentVisibility, Macro, Ticket, User


router = APIRouter(prefix="/agent/macros", tags=["agent"])


@router.get("", response_model=list[schemas.MacroOut])
def list_macros(db: Session = Depends(get_db), _: User = Depends(current_agent)):
    return db.query(Macro).order_by(Macro.name).all()


@router.post("", response_model=schemas.MacroOut, status_code=status.HTTP_201_CREATED)
def create_macro(
    payload: schemas.MacroIn,
    db: Session = Depends(get_db),
    actor: User = Depends(current_agent),
):
    if db.query(Macro).filter(Macro.name == payload.name).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "macro name already exists")
    macro = Macro(name=payload.name, body=payload.body, created_by_id=actor.id)
    db.add(macro)
    db.commit()
    db.refresh(macro)
    return macro


@router.post("/{macro_id}/apply/{ticket_id}", response_model=schemas.CommentOut,
             status_code=status.HTTP_201_CREATED)
def apply_macro(
    macro_id: int,
    ticket_id: int,
    db: Session = Depends(get_db),
    actor: User = Depends(current_agent),
):
    """Post a macro's body as a public comment on the target ticket."""
    macro = db.get(Macro, macro_id)
    if not macro:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "macro not found")
    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "ticket not found")
    comment = Comment(
        ticket_id=ticket.id, author_id=actor.id,
        visibility=CommentVisibility.public.value, body=macro.body,
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return comment
