from sqlalchemy import Boolean, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.mixins import Timestamps, UUIDPk


class Organization(UUIDPk, Timestamps, Base):
    __tablename__ = "organizations"

    name: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    slug: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    plan: Mapped[str] = mapped_column(String(64), default="free", nullable=False)
    billing_email: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
