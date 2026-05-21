"""Audit log — an append-only record of security-relevant events.

Rows are written but never updated or deleted by application code, so the log
is suitable evidence for SOC 2 / ISO 27001 audits. Retention/exports are
handled out-of-band by ops.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPrimaryKeyMixin, utcnow


class AuditEvent:
    """Canonical event names. Use these constants instead of raw strings."""

    USER_SIGNUP = "user.signup"
    USER_LOGIN = "user.login"
    USER_LOGIN_FAILED = "user.login_failed"
    USER_LOGOUT = "user.logout"
    USER_SSO_LOGIN = "user.sso_login"
    USER_PASSWORD_CHANGED = "user.password_changed"
    USER_PROFILE_UPDATED = "user.profile_updated"
    USER_DATA_EXPORTED = "user.data_exported"
    USER_ACCOUNT_DELETED = "user.account_deleted"

    ORG_CREATED = "org.created"
    ORG_SETTINGS_UPDATED = "org.settings_updated"
    ORG_SAML_UPDATED = "org.saml_updated"

    MEMBER_INVITED = "member.invited"
    INVITE_REVOKED = "member.invite_revoked"
    INVITE_ACCEPTED = "member.invite_accepted"
    MEMBER_ROLE_CHANGED = "member.role_changed"
    MEMBER_REMOVED = "member.removed"

    BILLING_CHECKOUT_STARTED = "billing.checkout_started"
    BILLING_PLAN_CHANGED = "billing.plan_changed"
    BILLING_SUBSCRIPTION_CANCELED = "billing.subscription_canceled"
    BILLING_PAYMENT_SUCCEEDED = "billing.payment_succeeded"
    BILLING_PAYMENT_FAILED = "billing.payment_failed"


class AuditLog(UUIDPrimaryKeyMixin, Base):
    """A single immutable audit entry."""

    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("ix_audit_org_created", "organization_id", "created_at"),
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False, index=True
    )

    # Both nullable: account-deletion events outlive their user/org rows.
    organization_id: Mapped[str | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True, index=True
    )
    actor_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )

    event: Mapped[str] = mapped_column(String(64), nullable=False, index=True)

    # Free-form, human-readable summary and the actor's email, denormalised so
    # the entry stays legible even after the referenced rows are gone.
    actor_email: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    target: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    message: Mapped[str] = mapped_column(Text, nullable=False, default="")

    ip_address: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    # JSON-encoded extra context (never contains secrets or passwords).
    context: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
