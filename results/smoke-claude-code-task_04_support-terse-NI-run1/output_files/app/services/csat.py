import secrets
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.survey import CSATResponse
from app.models.ticket import Ticket


def issue_survey(db: Session, ticket_id: UUID) -> CSATResponse:
    existing = db.execute(
        select(CSATResponse).where(CSATResponse.ticket_id == ticket_id)
    ).scalar_one_or_none()
    if existing:
        return existing
    survey = CSATResponse(
        ticket_id=ticket_id,
        rating=0,
        token=secrets.token_urlsafe(32),
        sent_at=datetime.now(timezone.utc),
    )
    db.add(survey)
    db.commit()
    db.refresh(survey)
    return survey


def submit(db: Session, token: str, rating: int, comment: str | None) -> CSATResponse:
    if rating < 1 or rating > 5:
        raise ValueError("rating must be 1..5")
    survey = db.execute(
        select(CSATResponse).where(CSATResponse.token == token)
    ).scalar_one_or_none()
    if not survey:
        raise LookupError("survey not found")
    if survey.submitted_at:
        raise ValueError("survey already submitted")
    survey.rating = rating
    survey.comment = comment
    survey.submitted_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(survey)
    return survey
