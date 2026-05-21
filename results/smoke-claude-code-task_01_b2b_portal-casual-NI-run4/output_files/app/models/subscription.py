"""Billing subscription model — the local mirror of Stripe state."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.enums import Plan, SubscriptionStatus
from app.models.base import Base, Timestamps, UUIDPrimaryKey, enum_column

if TYPE_CHECKING:
    import uuid

    from app.models.organization import Organization


class Subscription(Base, UUIDPrimaryKey, Timestamps):
    """One subscription per organization.

    Stripe is the source of truth for billing; this row is kept in sync by the
    webhook handler (app.routers.webhooks) so the portal can render billing
    state without a Stripe round-trip on every request.
    """

    __tablename__ = "subscriptions"

    organization_id: Mapped["uuid.UUID"] = mapped_column(
        Uuid,
        ForeignKey("organizations.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )

    stripe_customer_id: Mapped[str | None] = mapped_column(String(80), index=True)
    stripe_subscription_id: Mapped[str | None] = mapped_column(
        String(80), unique=True, index=True
    )

    plan: Mapped[Plan] = mapped_column(enum_column(Plan), default=Plan.STARTER, nullable=False)
    status: Mapped[SubscriptionStatus] = mapped_column(
        enum_column(SubscriptionStatus),
        default=SubscriptionStatus.INCOMPLETE,
        nullable=False,
    )

    seats: Mapped[int] = mapped_column(Integer, default=5, nullable=False)
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancel_at_period_end: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )

    organization: Mapped["Organization"] = relationship(back_populates="subscription")

    @property
    def is_live(self) -> bool:
        """True when the subscription grants access to paid features."""
        return self.status in (
            SubscriptionStatus.ACTIVE,
            SubscriptionStatus.TRIALING,
            SubscriptionStatus.PAST_DUE,
        )
