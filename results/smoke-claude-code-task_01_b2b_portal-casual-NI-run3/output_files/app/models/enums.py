"""Domain enumerations and the role hierarchy used for access control."""

from __future__ import annotations

import enum


class Role(str, enum.Enum):
    """Organization-scoped roles, ordered least -> most privileged."""

    VIEWER = "viewer"
    ADMIN = "admin"
    OWNER = "owner"

    @property
    def rank(self) -> int:
        return _ROLE_RANK[self]

    def can_act_as(self, required: Role) -> bool:
        """True if this role satisfies a route requiring `required`."""
        return self.rank >= required.rank


_ROLE_RANK: dict[Role, int] = {
    Role.VIEWER: 0,
    Role.ADMIN: 1,
    Role.OWNER: 2,
}


class Plan(str, enum.Enum):
    STARTER = "starter"
    PRO = "pro"
    ENTERPRISE = "enterprise"


# Seat limits per plan. Enterprise is effectively uncapped.
PLAN_SEATS: dict[Plan, int] = {
    Plan.STARTER: 3,
    Plan.PRO: 25,
    Plan.ENTERPRISE: 100_000,
}

PLAN_LABELS: dict[Plan, str] = {
    Plan.STARTER: "Starter",
    Plan.PRO: "Pro",
    Plan.ENTERPRISE: "Enterprise",
}

# Display-only monthly price in USD; the source of truth for charging is Stripe.
PLAN_PRICE_USD: dict[Plan, int] = {
    Plan.STARTER: 29,
    Plan.PRO: 99,
    Plan.ENTERPRISE: 499,
}


class SubscriptionStatus(str, enum.Enum):
    TRIALING = "trialing"
    ACTIVE = "active"
    PAST_DUE = "past_due"
    CANCELED = "canceled"
    INCOMPLETE = "incomplete"
