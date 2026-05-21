import uuid

from sqlalchemy import Boolean, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.mixins import Timestamps, UUIDPk


class FeatureFlag(UUIDPk, Timestamps, Base):
    __tablename__ = "feature_flags"

    key: Mapped[str] = mapped_column(String(128), unique=True, index=True, nullable=False)
    description: Mapped[str] = mapped_column(String(512), default="", nullable=False)
    enabled_globally: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class FeatureFlagOverride(UUIDPk, Timestamps, Base):
    __tablename__ = "feature_flag_overrides"

    flag_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("feature_flags.id", ondelete="CASCADE"), nullable=False
    )
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False)

    __table_args__ = (UniqueConstraint("flag_id", "org_id", name="uq_flag_org"),)
