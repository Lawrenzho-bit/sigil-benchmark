"""All ORM models.

FTS columns (`search_tsv`) are deliberately not declared here. They are
created as Postgres GENERATED columns by the initial migration. The search
service uses FTS on Postgres and a LIKE fallback on other dialects.
"""
from __future__ import annotations

import enum
import secrets
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


# ---------------------------------------------------------------------------
# Enums — stored as strings so they survive schema migrations without ALTER TYPE.
# ---------------------------------------------------------------------------

class Role(str, enum.Enum):
    customer = "customer"
    agent = "agent"
    admin = "admin"


class TicketStatus(str, enum.Enum):
    new = "new"
    open = "open"
    pending = "pending"
    resolved = "resolved"
    closed = "closed"
    merged = "merged"


class TicketPriority(str, enum.Enum):
    low = "low"
    normal = "normal"
    high = "high"
    urgent = "urgent"


class Channel(str, enum.Enum):
    email = "email"
    web = "web"
    slack = "slack"
    api = "api"


class CommentVisibility(str, enum.Enum):
    public = "public"
    internal = "internal"


# ---------------------------------------------------------------------------
# User
# ---------------------------------------------------------------------------

class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(20), default=Role.customer.value, index=True)
    hashed_password: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    is_anonymized: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)

    requested_tickets: Mapped[list["Ticket"]] = relationship(
        back_populates="requester", foreign_keys="Ticket.requester_id"
    )
    assigned_tickets: Mapped[list["Ticket"]] = relationship(
        back_populates="assignee", foreign_keys="Ticket.assignee_id"
    )

    __table_args__ = (
        CheckConstraint("role in ('customer','agent','admin')", name="ck_users_role"),
    )


# ---------------------------------------------------------------------------
# Ticket + SLA state
# ---------------------------------------------------------------------------

class Ticket(Base):
    __tablename__ = "tickets"

    id: Mapped[int] = mapped_column(primary_key=True)
    public_id: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    subject: Mapped[str] = mapped_column(String(500))
    description: Mapped[str] = mapped_column(Text, default="")

    requester_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    assignee_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id"), nullable=True, index=True
    )

    status: Mapped[str] = mapped_column(String(20), default=TicketStatus.new.value, index=True)
    priority: Mapped[str] = mapped_column(String(20), default=TicketPriority.normal.value, index=True)
    channel: Mapped[str] = mapped_column(String(20), default=Channel.web.value, index=True)
    tags: Mapped[list] = mapped_column(JSON, default=list)

    # set when the first agent (non-requester) comment is posted publicly
    first_responded_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # ticket-merge target
    merged_into_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("tickets.id"), nullable=True, index=True
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)

    requester: Mapped[User] = relationship(foreign_keys=[requester_id], back_populates="requested_tickets")
    assignee: Mapped[Optional[User]] = relationship(foreign_keys=[assignee_id], back_populates="assigned_tickets")
    comments: Mapped[list["Comment"]] = relationship(
        back_populates="ticket", cascade="all, delete-orphan", order_by="Comment.created_at"
    )
    sla: Mapped[Optional["SLAState"]] = relationship(
        back_populates="ticket", uselist=False, cascade="all, delete-orphan"
    )
    csat: Mapped[Optional["CSATSurvey"]] = relationship(
        back_populates="ticket", uselist=False, cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint("status in ('new','open','pending','resolved','closed','merged')",
                        name="ck_tickets_status"),
        CheckConstraint("priority in ('low','normal','high','urgent')",
                        name="ck_tickets_priority"),
        CheckConstraint("channel in ('email','web','slack','api')",
                        name="ck_tickets_channel"),
        Index("ix_tickets_status_priority", "status", "priority"),
    )

    @staticmethod
    def generate_public_id() -> str:
        return f"TKT-{secrets.token_hex(4).upper()}"


class SLAState(Base):
    __tablename__ = "sla_states"

    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id"), primary_key=True)
    first_response_due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    resolution_due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    first_response_breached_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    resolution_breached_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )

    ticket: Mapped[Ticket] = relationship(back_populates="sla")


# ---------------------------------------------------------------------------
# Comments (public replies + internal notes)
# ---------------------------------------------------------------------------

class Comment(Base):
    __tablename__ = "comments"

    id: Mapped[int] = mapped_column(primary_key=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id"), index=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    visibility: Mapped[str] = mapped_column(String(20), default=CommentVisibility.public.value, index=True)
    body: Mapped[str] = mapped_column(Text)
    from_email: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, index=True)

    ticket: Mapped[Ticket] = relationship(back_populates="comments")
    author: Mapped[User] = relationship()

    __table_args__ = (
        CheckConstraint("visibility in ('public','internal')", name="ck_comments_visibility"),
    )


# ---------------------------------------------------------------------------
# Knowledge base
# ---------------------------------------------------------------------------

class KBArticle(Base):
    __tablename__ = "kb_articles"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(500))
    body: Mapped[str] = mapped_column(Text)
    published: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)


# ---------------------------------------------------------------------------
# Macros
# ---------------------------------------------------------------------------

class Macro(Base):
    __tablename__ = "macros"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), unique=True)
    body: Mapped[str] = mapped_column(Text)
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


# ---------------------------------------------------------------------------
# Audit log
# ---------------------------------------------------------------------------

class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    actor_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(64), index=True)
    entity_type: Mapped[str] = mapped_column(String(64), index=True)
    entity_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    ip: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, index=True)

    __table_args__ = (
        Index("ix_audit_entity", "entity_type", "entity_id"),
    )


# ---------------------------------------------------------------------------
# CSAT
# ---------------------------------------------------------------------------

class CSATSurvey(Base):
    __tablename__ = "csat_surveys"

    id: Mapped[int] = mapped_column(primary_key=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id"), unique=True)
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True,
                                       default=lambda: secrets.token_urlsafe(24))
    rating: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    responded_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    ticket: Mapped[Ticket] = relationship(back_populates="csat")

    __table_args__ = (
        CheckConstraint("rating is null or (rating between 1 and 5)", name="ck_csat_rating"),
    )


# ---------------------------------------------------------------------------
# Attachments — minimal record; binary lives in object storage
# ---------------------------------------------------------------------------

class Attachment(Base):
    __tablename__ = "attachments"

    id: Mapped[int] = mapped_column(primary_key=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id"), index=True)
    comment_id: Mapped[Optional[int]] = mapped_column(ForeignKey("comments.id"), nullable=True, index=True)
    filename: Mapped[str] = mapped_column(String(500))
    content_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(Integer)
    storage_url: Mapped[str] = mapped_column(String(1000))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
