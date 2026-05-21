"""Organization (tenant) and per-organization SAML SSO configuration."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.invitation import Invitation
    from app.models.membership import Membership
    from app.models.subscription import Subscription


class Organization(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A customer account. Every user-facing resource is scoped to one of these."""

    __tablename__ = "organizations"

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    # URL-safe unique handle, e.g. "acme-inc".
    slug: Mapped[str] = mapped_column(String(80), unique=True, nullable=False, index=True)

    memberships: Mapped[list["Membership"]] = relationship(
        back_populates="organization", cascade="all, delete-orphan"
    )
    invitations: Mapped[list["Invitation"]] = relationship(
        back_populates="organization", cascade="all, delete-orphan"
    )
    subscription: Mapped["Subscription | None"] = relationship(
        back_populates="organization", cascade="all, delete-orphan", uselist=False
    )
    saml_config: Mapped["SamlConfig | None"] = relationship(
        back_populates="organization", cascade="all, delete-orphan", uselist=False
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Organization {self.slug!r}>"


class SamlConfig(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Identity-provider settings for an organization's SAML SSO.

    Storing this per-org lets each customer wire up their own IdP (Okta,
    Azure AD, Google Workspace, ...) without code changes.
    """

    __tablename__ = "saml_configs"

    organization_id: Mapped[str] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # IdP metadata supplied by the customer's identity team.
    idp_entity_id: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    idp_sso_url: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    idp_x509_cert: Mapped[str] = mapped_column(Text, nullable=False, default="")

    # When set, any email at this domain is routed to SSO.
    email_domain: Mapped[str] = mapped_column(String(255), nullable=False, default="", index=True)

    organization: Mapped["Organization"] = relationship(back_populates="saml_config")
