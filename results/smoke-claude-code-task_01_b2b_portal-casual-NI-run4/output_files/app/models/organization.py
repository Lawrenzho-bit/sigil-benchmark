"""Organization (tenant) model."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.enums import Role
from app.models.base import Base, Timestamps, UUIDPrimaryKey, enum_column

if TYPE_CHECKING:
    from app.models.invitation import Invitation
    from app.models.membership import Membership
    from app.models.subscription import Subscription


class Organization(Base, UUIDPrimaryKey, Timestamps):
    """A customer tenant. All other domain data is scoped to an organization."""

    __tablename__ = "organizations"

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    # URL-safe identifier, unique across the platform.
    slug: Mapped[str] = mapped_column(String(140), unique=True, nullable=False, index=True)

    # Stripe billing linkage (also denormalised onto Subscription).
    stripe_customer_id: Mapped[str | None] = mapped_column(String(80), unique=True)

    # --- SAML SSO configuration (per-organization Identity Provider) -------
    sso_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    saml_idp_entity_id: Mapped[str | None] = mapped_column(String(512))
    saml_idp_sso_url: Mapped[str | None] = mapped_column(String(512))
    saml_idp_x509_cert: Mapped[str | None] = mapped_column(Text)
    # Role assigned to users who sign in via SSO without an existing membership.
    saml_default_role: Mapped[Role] = mapped_column(
        enum_column(Role), default=Role.VIEWER, nullable=False
    )

    # Soft-deletion marker (set when an org is closed; preserves audit history).
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    memberships: Mapped[list["Membership"]] = relationship(
        back_populates="organization", cascade="all, delete-orphan"
    )
    invitations: Mapped[list["Invitation"]] = relationship(
        back_populates="organization", cascade="all, delete-orphan"
    )
    subscription: Mapped["Subscription | None"] = relationship(
        back_populates="organization", uselist=False, cascade="all, delete-orphan"
    )

    @property
    def is_active(self) -> bool:
        return self.deleted_at is None
