"""The per-request authentication context.

`AuthContext` bundles the authenticated session together with the user and the
organization/role they are currently acting as. It is built by the dependencies
in app.dependencies and passed to handlers and templates.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.enums import Role
from app.models import Membership, Organization, Session, User
from app.rbac import Permission, has_permission


@dataclass(slots=True)
class AuthContext:
    session: Session
    user: User
    # The membership/organization the user is currently acting within. These
    # are None only briefly — e.g. just after signup before an org is created,
    # or for a user whose sole org was deleted.
    membership: Membership | None
    organization: Organization | None

    @property
    def role(self) -> Role | None:
        return self.membership.role if self.membership else None

    @property
    def has_org(self) -> bool:
        return self.organization is not None

    def can(self, permission: Permission) -> bool:
        """Whether the current role grants `permission` in the active org."""
        return self.role is not None and has_permission(self.role, permission)
