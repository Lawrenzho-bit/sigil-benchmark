"""Membership — links a user to an organization with a role."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Enum as SAEnum
from sqlalchemy import ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.enums import Role

if TYPE_CHECKING:
    from app.models.organization import Organization
    from app.models.user import User


class Membership(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A user's role within one organization.

    The (user, organization) pair is unique — a user holds exactly one role
    per organization.
    """

    __tablename__ = "memberships"
    __table_args__ = (
        UniqueConstraint("user_id", "organization_id", name="uq_membership_user_org"),
    )

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    organization_id: Mapped[str] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[Role] = mapped_column(
        SAEnum(Role, native_enum=False, length=20), nullable=False, default=Role.VIEWER
    )

    user: Mapped["User"] = relationship(back_populates="memberships")
    organization: Mapped["Organization"] = relationship(back_populates="memberships")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Membership user={self.user_id} org={self.organization_id} role={self.role}>"
