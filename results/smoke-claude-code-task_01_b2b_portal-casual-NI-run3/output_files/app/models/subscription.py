"""Billing subscription, mirrored from Stripe.

Stripe is the source of truth for money. This row is a local projection kept in
sync by webhooks so the app can render plan/seat state without an API round-trip.
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import TimestampMixin, UUIDPrimaryKey
from app.models.enums import Plan, SubscriptionStatus

if TYPE_CHECKING:
    from app.models.organization import Organization


class Subscription(UUIDPrimaryKey, TimestampMixin, Base):
    __tablename__ = "subscriptions"

    organization_id: Mapped[str] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )

    stripe_subscription_id: Mapped[str | None] = mapped_column(String(64), index=True)
    stripe_customer_id: Mapped[str | None] = mapped_column(String(64), index=True)

    plan: Mapped[Plan] = mapped_column(Enum(Plan, native_enum=False), nullable=False)
    status: Mapped[SubscriptionStatus] = mapped_column(
        Enum(SubscriptionStatus, native_enum=False),
        default=SubscriptionStatus.INCOMPLETE,
        nullable=False,
    )

    seats: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    cancel_at_period_end: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    organization: Mapped[Organization] = relationship(back_populates="subscription")

    @property
    def is_live(self) -> bool:
        return self.status in {SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING}
