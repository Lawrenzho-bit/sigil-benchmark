"""Role-Based Access Control.

A single source of truth for "which role can do what". Routers and templates
ask `has_permission(role, Permission.X)` rather than checking role names
directly, so the policy lives in exactly one place.

Policy summary (from the product spec):
  * owner  — can do everything, including billing.
  * admin  — can manage users and settings; may *view* billing but not change it.
  * viewer — read-only access to everything they can see.
"""

from __future__ import annotations

import enum

from app.enums import Role
from app.exceptions import PermissionDenied


class Permission(str, enum.Enum):
    DASHBOARD_VIEW = "dashboard.view"

    ORG_VIEW = "org.view"
    ORG_EDIT = "org.edit"
    ORG_SSO_MANAGE = "org.sso_manage"

    MEMBERS_VIEW = "members.view"
    MEMBERS_INVITE = "members.invite"
    MEMBERS_MANAGE = "members.manage"  # change role / remove

    BILLING_VIEW = "billing.view"
    BILLING_MANAGE = "billing.manage"  # checkout, plan change, cancel

    AUDIT_VIEW = "audit.view"


# Read-only permissions every role holds.
_VIEWER_PERMISSIONS: frozenset[Permission] = frozenset(
    {
        Permission.DASHBOARD_VIEW,
        Permission.ORG_VIEW,
        Permission.MEMBERS_VIEW,
        Permission.BILLING_VIEW,
        Permission.AUDIT_VIEW,
    }
)

# Admin adds member + settings management on top of viewer's read access.
_ADMIN_PERMISSIONS: frozenset[Permission] = _VIEWER_PERMISSIONS | {
    Permission.ORG_EDIT,
    Permission.ORG_SSO_MANAGE,
    Permission.MEMBERS_INVITE,
    Permission.MEMBERS_MANAGE,
}

# Owner additionally controls billing — the only role that can.
_OWNER_PERMISSIONS: frozenset[Permission] = _ADMIN_PERMISSIONS | {
    Permission.BILLING_MANAGE,
}

ROLE_PERMISSIONS: dict[Role, frozenset[Permission]] = {
    Role.OWNER: _OWNER_PERMISSIONS,
    Role.ADMIN: _ADMIN_PERMISSIONS,
    Role.VIEWER: _VIEWER_PERMISSIONS,
}


def has_permission(role: Role, permission: Permission) -> bool:
    """Return True if `role` is granted `permission`."""
    return permission in ROLE_PERMISSIONS.get(role, frozenset())


def require_permission(role: Role, permission: Permission) -> None:
    """Raise PermissionDenied unless `role` is granted `permission`."""
    if not has_permission(role, permission):
        raise PermissionDenied(
            f"This action requires a role with the '{permission.value}' permission."
        )


def assignable_roles(actor_role: Role) -> list[Role]:
    """Roles `actor_role` is allowed to grant when inviting or editing members.

    Only an owner may create or promote another owner; admins can manage admins
    and viewers but cannot mint owners.
    """
    if actor_role == Role.OWNER:
        return [Role.OWNER, Role.ADMIN, Role.VIEWER]
    if actor_role == Role.ADMIN:
        return [Role.ADMIN, Role.VIEWER]
    return []
