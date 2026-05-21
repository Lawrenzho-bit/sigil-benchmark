"""Fine-grained role-based access control.

Permissions are plain string constants. The role -> permission mapping lives
here in code (not the database) on purpose: it is small, security-critical,
and must be reviewable in version control with a clear diff. Changing who can
do what is a code change that goes through review, not a runtime toggle.
"""
from functools import wraps

from django.core.exceptions import PermissionDenied


class Role:
    SUPER_ADMIN = "super_admin"
    ACCOUNT_ADMIN = "account_admin"
    SUPPORT = "support"
    FINANCE = "finance"
    READ_ONLY = "read_only"

    CHOICES = [
        (SUPER_ADMIN, "Super Admin"),
        (ACCOUNT_ADMIN, "Account Admin"),
        (SUPPORT, "Support"),
        (FINANCE, "Finance"),
        (READ_ONLY, "Read-Only"),
    ]


class Perm:
    # User management
    USER_VIEW = "user.view"
    USER_EDIT = "user.edit"
    USER_DEACTIVATE = "user.deactivate"
    USER_IMPERSONATE = "user.impersonate"
    # Organizations
    ORG_VIEW = "org.view"
    ORG_EDIT = "org.edit"
    # Audit
    AUDIT_VIEW = "audit.view"
    # Bulk operations
    BULK_IMPORT = "bulk.import"
    BULK_EXPORT = "bulk.export"
    # System health
    HEALTH_VIEW = "health.view"
    # Feature flags
    FLAG_VIEW = "flag.view"
    FLAG_EDIT = "flag.edit"
    # Communications
    COMMS_SEND = "comms.send"
    # API tokens
    TOKEN_VIEW = "token.view"
    TOKEN_CREATE = "token.create"
    TOKEN_REVOKE = "token.revoke"
    # Staff/role administration
    STAFF_MANAGE = "staff.manage"


ALL_PERMS = frozenset(
    v for k, v in vars(Perm).items() if not k.startswith("_") and isinstance(v, str)
)

# Read-only gets every "*.view" permission and nothing else.
_VIEW_PERMS = frozenset(p for p in ALL_PERMS if p.endswith(".view"))

ROLE_PERMISSIONS = {
    Role.SUPER_ADMIN: ALL_PERMS,
    Role.ACCOUNT_ADMIN: frozenset({
        Perm.USER_VIEW, Perm.USER_EDIT, Perm.USER_DEACTIVATE, Perm.USER_IMPERSONATE,
        Perm.ORG_VIEW, Perm.ORG_EDIT,
        Perm.AUDIT_VIEW,
        Perm.BULK_IMPORT, Perm.BULK_EXPORT,
        Perm.HEALTH_VIEW,
        Perm.FLAG_VIEW, Perm.FLAG_EDIT,
        Perm.COMMS_SEND,
        Perm.TOKEN_VIEW, Perm.TOKEN_CREATE, Perm.TOKEN_REVOKE,
    }),
    Role.SUPPORT: frozenset({
        Perm.USER_VIEW, Perm.USER_EDIT, Perm.USER_IMPERSONATE,
        Perm.ORG_VIEW,
        Perm.AUDIT_VIEW,
        Perm.HEALTH_VIEW,
        Perm.FLAG_VIEW,
        Perm.COMMS_SEND,
    }),
    Role.FINANCE: frozenset({
        Perm.USER_VIEW,
        Perm.ORG_VIEW,
        Perm.AUDIT_VIEW,
        Perm.BULK_EXPORT,
        Perm.HEALTH_VIEW,
        Perm.FLAG_VIEW,
        Perm.TOKEN_VIEW,
    }),
    Role.READ_ONLY: _VIEW_PERMS,
}


def permissions_for(role):
    return ROLE_PERMISSIONS.get(role, frozenset())


def has_perm(user, perm):
    """True if the authenticated, active user's role grants `perm`."""
    if not user or not user.is_authenticated or not user.is_active:
        return False
    return perm in permissions_for(getattr(user, "admin_role", None))


def require_perm(perm):
    """View decorator. Raises PermissionDenied (403) if the user lacks `perm`.

    Denied attempts are surfaced to the audit log by the 403 handler so that
    probing for access shows up in the trail.
    """
    def decorator(view):
        @wraps(view)
        def wrapped(request, *args, **kwargs):
            if not request.user.is_authenticated:
                raise PermissionDenied("Authentication required.")
            if not has_perm(request.user, perm):
                raise PermissionDenied(f"Missing permission: {perm}")
            return view(request, *args, **kwargs)
        wrapped.required_perm = perm
        return wrapped
    return decorator
