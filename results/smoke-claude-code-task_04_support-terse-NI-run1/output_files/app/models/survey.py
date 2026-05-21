from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class CSATResponse(Base):
    __tablename__ = "csat_responses"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    ticket_id: Mapped[UUID] = mapped_column(ForeignKey("tickets.id", ondelete="CASCADE"), unique=True)
    # 1..5 (or thumbs up/down stored as 1/5)
    rating: Mapped[int] = mapped_column(Integer)
    comment: Mapped[str | None] = mapped_column(Text)
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    ticket = relationship("Ticket", back_populates="csat")
