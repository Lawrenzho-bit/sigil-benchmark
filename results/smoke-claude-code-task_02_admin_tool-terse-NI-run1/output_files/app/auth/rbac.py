"""Role-based access control.

Permissions are explicit strings of the form `resource:action`. Roles are mapped
to permission sets at module load time; no per-request DB lookup. This is a
deny-by-default system: a permission must be explicitly granted, or the request
is rejected.
"""
from app.models.admin import AdminRole

# --- Permissions ------------------------------------------------------------

# Users
P_USER_VIEW = "user:view"
P_USER_EDIT = "user:edit"
P_USER_DEACTIVATE = "user:deactivate"
P_USER_IMPERSONATE = "user:impersonate"

# Orgs
P_ORG_VIEW = "org:view"
P_ORG_EDIT = "org:edit"

# Audit log
P_AUDIT_VIEW = "audit:view"

# Feature flags
P_FLAG_VIEW = "flag:view"
P_FLAG_TOGGLE = "flag:toggle"

# API tokens
P_TOKEN_VIEW = "token:view"
P_TOKEN_CREATE = "token:create"
P_TOKEN_REVOKE = "token:revoke"

# Announcements
P_ANNOUNCE_VIEW = "announcement:view"
P_ANNOUNCE_SEND = "announcement:send"

# Bulk ops
P_BULK_IMPORT = "bulk:import"
P_BULK_EXPORT = "bulk:export"

# Health
P_HEALTH_VIEW = "health:view"

# Admin management
P_ADMIN_MANAGE = "admin:manage"

ALL_PERMISSIONS: set[str] = {
    P_USER_VIEW, P_USER_EDIT, P_USER_DEACTIVATE, P_USER_IMPERSONATE,
    P_ORG_VIEW, P_ORG_EDIT,
    P_AUDIT_VIEW,
    P_FLAG_VIEW, P_FLAG_TOGGLE,
    P_TOKEN_VIEW, P_TOKEN_CREATE, P_TOKEN_REVOKE,
    P_ANNOUNCE_VIEW, P_ANNOUNCE_SEND,
    P_BULK_IMPORT, P_BULK_EXPORT,
    P_HEALTH_VIEW,
    P_ADMIN_MANAGE,
}

# --- Role -> Permissions ---------------------------------------------------

_READ_ONLY: set[str] = {
    P_USER_VIEW, P_ORG_VIEW, P_AUDIT_VIEW, P_FLAG_VIEW,
    P_TOKEN_VIEW, P_ANNOUNCE_VIEW, P_HEALTH_VIEW,
}

_SUPPORT: set[str] = _READ_ONLY | {
    P_USER_EDIT, P_USER_IMPERSONATE, P_BULK_EXPORT,
}

_ACCOUNT_ADMIN: set[str] = _SUPPORT | {
    P_USER_DEACTIVATE, P_ORG_EDIT, P_FLAG_TOGGLE,
    P_ANNOUNCE_SEND, P_BULK_IMPORT,
}

_FINANCE: set[str] = _READ_ONLY | {
    P_ORG_EDIT, P_BULK_EXPORT,
}

_SUPER_ADMIN: set[str] = ALL_PERMISSIONS

ROLE_PERMISSIONS: dict[AdminRole, frozenset[str]] = {
    AdminRole.super_admin: frozenset(_SUPER_ADMIN),
    AdminRole.account_admin: frozenset(_ACCOUNT_ADMIN),
    AdminRole.support: frozenset(_SUPPORT),
    AdminRole.finance: frozenset(_FINANCE),
    AdminRole.read_only: frozenset(_READ_ONLY),
}


def role_has(role: AdminRole, permission: str) -> bool:
    return permission in ROLE_PERMISSIONS.get(role, frozenset())


def map_groups_to_role(groups: list[str], group_to_role: dict[str, str]) -> AdminRole | None:
    """Map a list of IDP groups to the highest-privilege internal role.

    Order of precedence: super_admin > account_admin > finance > support > read_only.
    """
    precedence = [
        AdminRole.super_admin,
        AdminRole.account_admin,
        AdminRole.finance,
        AdminRole.support,
        AdminRole.read_only,
    ]
    matched = {group_to_role[g] for g in groups if g in group_to_role}
    for role in precedence:
        if role.value in matched:
            return role
    return None
