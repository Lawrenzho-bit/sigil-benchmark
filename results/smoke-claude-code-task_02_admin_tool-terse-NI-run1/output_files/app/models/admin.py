import enum

from sqlalchemy import Boolean, Enum, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.mixins import Timestamps, UUIDPk


class AdminRole(str, enum.Enum):
    super_admin = "super_admin"
    account_admin = "account_admin"
    support = "support"
    finance = "finance"
    read_only = "read_only"


class Admin(UUIDPk, Timestamps, Base):
    __tablename__ = "admins"

    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    sso_subject: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    sso_provider: Mapped[str] = mapped_column(String(32), nullable=False)  # 'oidc'|'saml'
    role: Mapped[AdminRole] = mapped_column(
        Enum(AdminRole, name="admin_role"),
        nullable=False,
        default=AdminRole.read_only,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
