"""Declarative base and shared column mixins for all ORM models."""

from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Uuid, func
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """Common base for every model."""


def enum_column(enum_cls: type[enum.Enum]) -> SAEnum:
    """Build a portable enum column type.

    `native_enum=False` stores the value as VARCHAR with a CHECK constraint, so
    it behaves identically on PostgreSQL and the SQLite test database. The
    value (not the member name) is persisted, keeping rows human-readable.
    """
    return SAEnum(
        enum_cls,
        native_enum=False,
        length=32,
        values_callable=lambda e: [m.value for m in e],
    )


class UUIDPrimaryKey:
    """Mixin adding a UUID primary key generated application-side.

    Application-side generation keeps inserts portable across Postgres and the
    SQLite database used by the test suite.
    """

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4
    )


class Timestamps:
    """Mixin adding created/updated timestamps maintained by the database."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
