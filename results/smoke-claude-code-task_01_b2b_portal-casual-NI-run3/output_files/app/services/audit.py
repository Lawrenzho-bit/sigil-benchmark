"""Audit logging.

`record()` is the single entry point. Routers call it for every security- or
billing-relevant action. The function never raises into the caller: a failure to
write an audit row must not break the user-facing request, but it is logged.
"""

from __future__ import annotations

import logging

from sqlalchemy.orm import Session
from starlette.requests import Request

from app.models.audit_log import AuditLog

logger = logging.getLogger("acme.audit")


# Canonical action names. Using constants avoids typos that would fragment
# the audit trail and makes it easy to grep for everywhere an action is logged.
class Action:
    SIGNUP = "user.signup"
    LOGIN = "user.login"
    LOGIN_FAILED = "user.login_failed"
    LOGOUT = "user.logout"
    SSO_LOGIN = "user.sso_login"
    PASSWORD_CHANGED = "user.password_changed"  # noqa: S105 - action name, not a secret
    SESSIONS_REVOKED = "user.sessions_revoked"

    INVITE_SENT = "member.invite_sent"
    INVITE_ACCEPTED = "member.invite_accepted"
    INVITE_REVOKED = "member.invite_revoked"
    ROLE_CHANGED = "member.role_changed"
    MEMBER_REMOVED = "member.removed"

    ORG_UPDATED = "org.updated"
    SAML_UPDATED = "org.saml_updated"

    BILLING_CHECKOUT = "billing.checkout_started"
    PLAN_CHANGED = "billing.plan_changed"
    BILLING_PORTAL = "billing.portal_opened"
    SUBSCRIPTION_CANCELED = "billing.subscription_canceled"

    DATA_EXPORTED = "gdpr.data_exported"
    ACCOUNT_DELETED = "gdpr.account_deleted"
    ORG_DELETED = "gdpr.org_deleted"


def _client_meta(request: Request | None) -> tuple[str | None, str | None]:
    if request is None:
        return None, None
    fwd = request.headers.get("x-forwarded-for")
    ip = fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else None)
    ua = request.headers.get("user-agent", "")[:255] or None
    return ip, ua


def record(
    db: Session,
    *,
    action: str,
    request: Request | None = None,
    organization_id: str | None = None,
    actor_user_id: str | None = None,
    actor_email: str = "",
    target_type: str | None = None,
    target_id: str | None = None,
    details: dict | None = None,
    commit: bool = True,
) -> None:
    """Append one audit row. Best-effort: never propagates an exception."""
    try:
        ip, ua = _client_meta(request)
        entry = AuditLog(
            organization_id=organization_id,
            actor_user_id=actor_user_id,
            actor_email=actor_email or "",
            action=action,
            target_type=target_type,
            target_id=target_id,
            details=details or {},
            ip_address=ip,
            user_agent=ua,
        )
        db.add(entry)
        if commit:
            db.commit()
    except Exception:  # noqa: BLE001 - audit must not break the request
        logger.exception("Failed to write audit log for action=%s", action)
        db.rollback()
