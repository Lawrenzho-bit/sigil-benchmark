"""FastAPI dependencies: authentication context, RBAC, and CSRF enforcement."""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends, Form, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.requests import Request
from starlette.responses import RedirectResponse

from app.config import settings
from app.database import get_db
from app.models.enums import Role
from app.models.membership import Membership
from app.models.organization import Organization
from app.models.session import AuthSession
from app.models.user import User
from app.security import validate_csrf
from app.services import auth as auth_service


@dataclass
class AuthContext:
    """Everything a route needs about the authenticated caller."""

    user: User
    organization: Organization
    membership: Membership
    session: AuthSession

    @property
    def role(self) -> Role:
        return self.membership.role

    @property
    def is_owner(self) -> bool:
        return self.role is Role.OWNER

    @property
    def can_manage(self) -> bool:
        """Admins and owners may manage members and settings."""
        return self.role.can_act_as(Role.ADMIN)


class _RedirectToLogin(HTTPException):
    """Internal signal -> turned into a redirect by the exception handler."""

    def __init__(self) -> None:
        super().__init__(status_code=status.HTTP_307_TEMPORARY_REDIRECT)


def _load_auth(request: Request, db: Session) -> AuthContext | None:
    """Resolve the full auth context from the session cookie, or None."""
    raw_token = request.cookies.get(settings.session_cookie_name)
    session = auth_service.resolve_session(db, raw_token)
    if session is None:
        return None

    user = db.get(User, session.user_id)
    if user is None or not user.is_active:
        return None

    if not session.organization_id:
        return None
    membership = db.scalar(
        select(Membership).where(
            Membership.user_id == user.id,
            Membership.organization_id == session.organization_id,
        )
    )
    if membership is None:
        # The user was removed from the org this session was bound to.
        return None

    org = db.get(Organization, session.organization_id)
    if org is None:
        return None

    return AuthContext(user=user, organization=org, membership=membership, session=session)


def get_optional_auth(request: Request, db: Session = Depends(get_db)) -> AuthContext | None:
    """Auth context if signed in, else None. Also stashes it on request.state
    so templates can read it without every route passing it explicitly."""
    ctx = _load_auth(request, db)
    request.state.auth = ctx
    return ctx


def require_auth(request: Request, db: Session = Depends(get_db)) -> AuthContext:
    """Require a signed-in user. Redirects to /auth/login otherwise."""
    ctx = _load_auth(request, db)
    request.state.auth = ctx
    if ctx is None:
        next_url = request.url.path
        raise HTTPException(
            status_code=status.HTTP_307_TEMPORARY_REDIRECT,
            headers={"Location": f"/auth/login?next={next_url}"},
        )
    return ctx


def require_role(minimum: Role):
    """Dependency factory enforcing a minimum org role on a route."""

    def _dep(ctx: AuthContext = Depends(require_auth)) -> AuthContext:
        if not ctx.role.can_act_as(minimum):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"This action requires the '{minimum.value}' role or higher.",
            )
        return ctx

    return _dep


# Convenience aliases for the common privilege gates.
require_admin = require_role(Role.ADMIN)
require_owner = require_role(Role.OWNER)


async def verify_csrf(
    request: Request,
    csrf_token: str = Form(default=""),
) -> None:
    """Reject any state-changing form post lacking a valid CSRF token.

    Attach to POST routes via `dependencies=[Depends(verify_csrf)]`. Webhook and
    SAML ACS endpoints are exempt (they authenticate by signature instead) and
    must not include this dependency.
    """
    if not validate_csrf(request, csrf_token):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid or missing CSRF token. Reload the page and try again.",
        )


def redirect(path: str, *, status_code: int = status.HTTP_303_SEE_OTHER) -> RedirectResponse:
    """A POST-redirect-GET helper; 303 makes the browser follow with GET."""
    return RedirectResponse(url=path, status_code=status_code)
