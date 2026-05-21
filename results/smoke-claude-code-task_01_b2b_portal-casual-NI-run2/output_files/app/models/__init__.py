"""SQLAlchemy models.

Importing this package registers every model on ``Base.metadata`` — Alembic's
autogenerate and the test fixtures rely on that side effect.
"""

from app.models.audit_log import AuditEvent, AuditLog
from app.models.base import Base
from app.models.enums import (
    InvitationStatus,
    PlanTier,
    Role,
    SubscriptionStatus,
)
from app.models.invitation import Invitation
from app.models.membership import Membership
from app.models.organization import Organization, SamlConfig
from app.models.session import AuthSession
from app.models.subscription import Subscription
from app.models.user import User

__all__ = [
    "AuditEvent",
    "AuditLog",
    "AuthSession",
    "Base",
    "Invitation",
    "InvitationStatus",
    "Membership",
    "Organization",
    "PlanTier",
    "Role",
    "SamlConfig",
    "Subscription",
    "SubscriptionStatus",
    "User",
]
