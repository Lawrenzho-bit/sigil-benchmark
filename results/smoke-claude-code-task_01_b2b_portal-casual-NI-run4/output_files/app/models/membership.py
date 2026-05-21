"""Membership — the join between a user and an organization, carrying a role."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.enums import MembershipStatus, Role
from app.models.base import Base, Timestamps, UUIDPrimaryKey, enum_column

if TYPE_CHECKING:
    import uuid

    from app.models.organization import Organization
    from app.models.user import User


class Membership(Base, UUIDPrimaryKey, Timestamps):
    """Links a user to an organization with exactly one role.

    A user has at most one membership per organization (enforced by the unique
    constraint). Roles and permissions are interpreted by app.rbac.
    """

    __tablename__ = "memberships"
    __table_args__ = (
        UniqueConstraint("user_id", "organization_id", name="uq_membership_user_org"),
    )

    user_id: Mapped["uuid.UUID"] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    organization_id: Mapped["uuid.UUID"] = mapped_column(
        Uuid, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )

    role: Mapped[Role] = mapped_column(enum_column(Role), nullable=False)
    status: Mapped[MembershipStatus] = mapped_column(
        enum_column(MembershipStatus), default=MembershipStatus.ACTIVE, nullable=False
    )

    user: Mapped["User"] = relationship(back_populates="memberships")
    organization: Mapped["Organization"] = relationship(back_populates="memberships")

    @property
    def is_active(self) -> bool:
        return self.status == MembershipStatus.ACTIVE
