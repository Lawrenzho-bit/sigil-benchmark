"""Subscription — the billing state of an organization, mirrored from Stripe.

Stripe is the source of truth. This table is a local read-model kept in sync
by webhook events so the app can authorize features without an API round-trip.
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, String
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.enums import PlanTier, SubscriptionStatus

if TYPE_CHECKING:
    from app.models.organization import Organization


class Subscription(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "subscriptions"

    organization_id: Mapped[str] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), unique=True, nullable=False
    )

    stripe_customer_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    stripe_subscription_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True, index=True
    )

    plan: Mapped[PlanTier] = mapped_column(
        SAEnum(PlanTier, native_enum=False, length=20), nullable=False, default=PlanTier.STARTER
    )
    status: Mapped[SubscriptionStatus] = mapped_column(
        SAEnum(SubscriptionStatus, native_enum=False, length=20),
        nullable=False,
        default=SubscriptionStatus.INCOMPLETE,
    )

    current_period_end: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    cancel_at_period_end: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    organization: Mapped["Organization"] = relationship(back_populates="subscription")

    @property
    def is_active(self) -> bool:
        return self.status.grants_access

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Subscription org={self.organization_id} plan={self.plan} {self.status}>"
