"""Shared enumerations used across models, services, and templates."""

from __future__ import annotations

import enum


class Role(str, enum.Enum):
    """Organization membership roles, ordered from most to least privileged."""

    OWNER = "owner"
    ADMIN = "admin"
    VIEWER = "viewer"

    @property
    def label(self) -> str:
        return {"owner": "Owner", "admin": "Admin", "viewer": "Viewer"}[self.value]


class MembershipStatus(str, enum.Enum):
    ACTIVE = "active"
    SUSPENDED = "suspended"


class Plan(str, enum.Enum):
    """Billing plans. `seats` is the included seat count for the plan."""

    STARTER = "starter"
    PRO = "pro"
    ENTERPRISE = "enterprise"

    @property
    def label(self) -> str:
        return self.value.capitalize()

    @property
    def seats(self) -> int:
        return {"starter": 5, "pro": 25, "enterprise": 200}[self.value]

    @property
    def monthly_price_usd(self) -> int:
        return {"starter": 29, "pro": 99, "enterprise": 399}[self.value]


class SubscriptionStatus(str, enum.Enum):
    """Mirrors the subset of Stripe subscription statuses we act on."""

    TRIALING = "trialing"
    ACTIVE = "active"
    PAST_DUE = "past_due"
    CANCELED = "canceled"
    INCOMPLETE = "incomplete"


class InvitationStatus(str, enum.Enum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    REVOKED = "revoked"
    EXPIRED = "expired"


class ExportStatus(str, enum.Enum):
    PENDING = "pending"
    READY = "ready"
    FAILED = "failed"


class AuditAction(str, enum.Enum):
    """Canonical set of audited actions. Stored as strings in the audit log."""

    # Authentication
    USER_SIGNED_UP = "user.signed_up"
    USER_LOGGED_IN = "user.logged_in"
    USER_LOGGED_IN_SSO = "user.logged_in_sso"
    USER_LOGIN_FAILED = "user.login_failed"
    USER_LOGGED_OUT = "user.logged_out"
    USER_EMAIL_VERIFIED = "user.email_verified"
    USER_PASSWORD_RESET_REQUESTED = "user.password_reset_requested"
    USER_PASSWORD_CHANGED = "user.password_changed"
    LOGIN_RATE_LIMITED = "user.login_rate_limited"

    # Members
    MEMBER_INVITED = "member.invited"
    INVITATION_ACCEPTED = "member.invitation_accepted"
    INVITATION_REVOKED = "member.invitation_revoked"
    MEMBER_ROLE_CHANGED = "member.role_changed"
    MEMBER_REMOVED = "member.removed"

    # Organization / settings
    ORG_CREATED = "org.created"
    ORG_SETTINGS_UPDATED = "org.settings_updated"
    ORG_SSO_CONFIGURED = "org.sso_configured"
    ORG_SSO_DISABLED = "org.sso_disabled"

    # Billing
    BILLING_CHECKOUT_STARTED = "billing.checkout_started"
    BILLING_SUBSCRIPTION_CREATED = "billing.subscription_created"
    BILLING_PLAN_CHANGED = "billing.plan_changed"
    BILLING_SUBSCRIPTION_CANCELED = "billing.subscription_canceled"
    BILLING_PAYMENT_SUCCEEDED = "billing.payment_succeeded"
    BILLING_PAYMENT_FAILED = "billing.payment_failed"

    # GDPR
    GDPR_DATA_EXPORT_REQUESTED = "gdpr.data_export_requested"
    GDPR_DATA_EXPORTED = "gdpr.data_exported"
    GDPR_ACCOUNT_DELETED = "gdpr.account_deleted"
    GDPR_CONSENT_UPDATED = "gdpr.consent_updated"
