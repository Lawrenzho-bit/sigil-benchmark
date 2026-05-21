import enum
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import Boolean, DateTime, Enum, Index, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class UserRole(str, enum.Enum):
    AGENT = "agent"
    ADMIN = "admin"
    SUPERVISOR = "supervisor"


class User(Base):
    """Internal user — agent, supervisor, or admin."""

    __tablename__ = "users"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), default=UserRole.AGENT)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    assigned_tickets = relationship("Ticket", back_populates="assignee", foreign_keys="Ticket.assignee_id")

    def __repr__(self) -> str:
        return f"<User {self.email} role={self.role}>"


class Customer(Base):
    """External customer — the one filing tickets."""

    __tablename__ = "customers"
    __table_args__ = (Index("ix_customers_email_lower", func.lower("email"), unique=True),)

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    email: Mapped[str] = mapped_column(String(254), index=True)
    name: Mapped[str | None] = mapped_column(String(200))
    password_hash: Mapped[str | None] = mapped_column(String(255))
    locale: Mapped[str] = mapped_column(String(16), default="en-US")
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")
    profile: Mapped[dict] = mapped_column(JSONB, default=dict)
    # GDPR
    consents: Mapped[dict] = mapped_column(JSONB, default=dict)
    erased_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    tickets = relationship("Ticket", back_populates="customer")
