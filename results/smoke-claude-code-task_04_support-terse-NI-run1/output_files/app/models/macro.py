from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Macro(Base):
    __tablename__ = "macros"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text)
    # Optional actions to apply when macro is used:
    # {"set_status": "resolved", "set_priority": "high", "add_tags": ["billing"]}
    actions: Mapped[dict] = mapped_column(JSONB, default=dict)
    owner_id: Mapped[UUID | None] = mapped_column(ForeignKey("users.id"))
    visibility: Mapped[str] = mapped_column(String(20), default="team")  # personal|team|global
    use_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
