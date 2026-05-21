import enum
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Index, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class MessageKind(str, enum.Enum):
    CUSTOMER_REPLY = "customer_reply"
    AGENT_REPLY = "agent_reply"
    INTERNAL_NOTE = "internal_note"
    SYSTEM = "system"


class MessageChannel(str, enum.Enum):
    EMAIL = "email"
    WEB = "web"
    SLACK = "slack"
    API = "api"


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (
        Index("ix_messages_ticket_created", "ticket_id", "created_at"),
        Index("ix_messages_external_id", "external_id"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    ticket_id: Mapped[UUID] = mapped_column(ForeignKey("tickets.id", ondelete="CASCADE"), index=True)

    kind: Mapped[MessageKind] = mapped_column(Enum(MessageKind))
    channel: Mapped[MessageChannel] = mapped_column(Enum(MessageChannel))

    # Sender is either a Customer or User (never both).
    customer_id: Mapped[UUID | None] = mapped_column(ForeignKey("customers.id"))
    author_id: Mapped[UUID | None] = mapped_column(ForeignKey("users.id"))

    body_text: Mapped[str] = mapped_column(Text)
    body_html: Mapped[str | None] = mapped_column(Text)

    # Email-thread identifiers — Message-ID, References — for routing replies back.
    external_id: Mapped[str | None] = mapped_column(String(998))
    in_reply_to: Mapped[str | None] = mapped_column(String(998))
    references_: Mapped[str | None] = mapped_column("references", Text)

    # Was this hidden from customer? Always true for INTERNAL_NOTE.
    is_internal: Mapped[bool] = mapped_column(Boolean, default=False)

    headers: Mapped[dict] = mapped_column(JSONB, default=dict)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

    ticket = relationship("Ticket", back_populates="messages")
    attachments = relationship("Attachment", back_populates="message", cascade="all, delete-orphan")
