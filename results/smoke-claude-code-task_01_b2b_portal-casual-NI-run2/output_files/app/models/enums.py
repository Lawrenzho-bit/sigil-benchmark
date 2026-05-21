"""Enumerations shared across models."""

from __future__ import annotations

import enum


class Role(str, enum.Enum):
    """Organization membership roles, ordered by privilege.

    OWNER  — full control, including billing and deleting the organization.
    ADMIN  — manage members, invitations and settings; no billing.
    VIEWER — read-only access to the dashboard and settings.
    """

    OWNER = "owner"
    ADMIN = "admin"
    VIEWER = "viewer"

    @property
    def rank(self) -> int:
        return {"viewer": 0, "admin": 1, "owner": 2}[self.value]

    def at_least(self, other: "Role") -> bool:
        return self.rank >= other.rank


class PlanTier(str, enum.Enum):
    STARTER = "starter"
    PRO = "pro"
    ENTERPRISE = "enterprise"


class SubscriptionStatus(str, enum.Enum):
    """Mirrors the subset of Stripe subscription statuses we act on."""

    TRIALING = "trialing"
    ACTIVE = "active"
    PAST_DUE = "past_due"
    CANCELED = "canceled"
    INCOMPLETE = "incomplete"
    UNPAID = "unpaid"

    @property
    def grants_access(self) -> bool:
        return self in {SubscriptionStatus.TRIALING, SubscriptionStatus.ACTIVE}


class InvitationStatus(str, enum.Enum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    REVOKED = "revoked"
    EXPIRED = "expired"
