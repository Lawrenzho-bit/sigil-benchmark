from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.services import csat

router = APIRouter()


class SubmitIn(BaseModel):
    rating: int = Field(ge=1, le=5)
    comment: str | None = None


@router.post("/{token}")
def submit(token: str, payload: SubmitIn, db: Session = Depends(get_db)):
    try:
        s = csat.submit(db, token, payload.rating, payload.comment)
    except LookupError:
        raise HTTPException(404, "not_found")
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True, "rating": s.rating}
