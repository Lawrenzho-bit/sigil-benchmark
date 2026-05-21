"""Organization (tenant) model."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Enum, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import TimestampMixin, UUIDPrimaryKey
from app.models.enums import Plan

if TYPE_CHECKING:
    from app.models.membership import Membership
    from app.models.subscription import Subscription


class Organization(UUIDPrimaryKey, TimestampMixin, Base):
    __tablename__ = "organizations"

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    slug: Mapped[str] = mapped_column(String(140), unique=True, index=True, nullable=False)

    # Current plan, denormalized from the Stripe subscription for fast reads.
    plan: Mapped[Plan] = mapped_column(
        Enum(Plan, native_enum=False), default=Plan.STARTER, nullable=False
    )
    stripe_customer_id: Mapped[str | None] = mapped_column(String(64), index=True)

    # --- SAML SSO (per-organization IdP configuration) --------------------
    saml_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    saml_idp_entity_id: Mapped[str | None] = mapped_column(String(255))
    saml_idp_sso_url: Mapped[str | None] = mapped_column(String(512))
    saml_idp_x509_cert: Mapped[str | None] = mapped_column(Text)
    # When set, only addresses on this domain may join via SSO.
    saml_email_domain: Mapped[str | None] = mapped_column(String(255))

    memberships: Mapped[list[Membership]] = relationship(
        back_populates="organization", cascade="all, delete-orphan"
    )
    subscription: Mapped[Subscription | None] = relationship(
        back_populates="organization", uselist=False, cascade="all, delete-orphan"
    )
