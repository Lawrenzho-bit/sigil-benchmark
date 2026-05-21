"""FastAPI dependencies: database sessions, authentication, RBAC, and CSRF.

Routers compose these instead of re-implementing auth checks, so the security
rules are applied uniformly and live in one place.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable, Coroutine
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from starlette.requests import Request

from app.config import settings
from app.context import AuthContext
from app.csrf import csrf_cookie_name, read_anonymous_csrf
from app.database import get_db
from app.enums import MembershipStatus
from app.exceptions import AuthenticationError, CSRFError, PermissionDenied
from app.models import Membership, Session, User
from app.rbac import Permission, require_permission
from app.security import csrf_tokens_match, unsign_session_id

DbSession = Annotated[AsyncSession, Depends(get_db)]


# --------------------------------------------------------------------------
# Request metadata (for audit logging)
# --------------------------------------------------------------------------
def client_ip(request: Request) -> str | None:
    """Best-effort client IP, honouring a proxy's X-Forwarded-For header."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        # The left-most entry is the original client.
        return forwarded.split(",")[0].strip()[:45]
    return request.client.host if request.client else None


def user_agent(request: Request) -> str | None:
    ua = request.headers.get("user-agent")
    return ua[:400] if ua else None


# --------------------------------------------------------------------------
# Session loading
# --------------------------------------------------------------------------
async def _load_session(request: Request, db: AsyncSession) -> Session | None:
    """Resolve and validate the server-side session from the signed cookie."""
    raw = request.cookies.get(settings.session_cookie_name)
    if not raw:
        return None
    max_age = settings.session_lifetime_hours * 3600
    session_id = unsign_session_id(raw, max_age)
    if not session_id:
        return None
    try:
        session = await db.get(Session, uuid.UUID(session_id))
    except ValueError:
        return None
    if session is None or not session.is_valid:
        return None
    session.last_seen_at = datetime.now(UTC)
    return session


async def _resolve_active_org(
    db: AsyncSession, session: Session, user: User
) -> tuple[Membership | None, Any]:
    """Pick the membership/organization the user is currently acting within.

    Honours `session.active_organization_id` when it still points at a live
    membership; otherwise falls back to the user's first active membership and
    updates the session accordingly.
    """
    stmt = (
        select(Membership)
        .options(selectinload(Membership.organization))
        .where(
            Membership.user_id == user.id,
            Membership.status == MembershipStatus.ACTIVE,
        )
    )
    memberships = [
        m
        for m in (await db.scalars(stmt)).all()
        if m.organization is not None and m.organization.deleted_at is None
    ]
    if not memberships:
        session.active_organization_id = None
        return None, None

    chosen: Membership | None = None
    if session.active_organization_id is not None:
        chosen = next(
            (m for m in memberships if m.organization_id == session.active_organization_id),
            None,
        )
    if chosen is None:
        chosen = memberships[0]
        session.active_organization_id = chosen.organization_id
    return chosen, chosen.organization


async def get_auth_optional(
    request: Request, db: DbSession
) -> AuthContext | None:
    """Return the AuthContext if the request is authenticated, else None."""
    session = await _load_session(request, db)
    if session is None:
        return None
    user = await db.get(User, session.user_id)
    if user is None or user.is_deleted:
        return None
    membership, organization = await _resolve_active_org(db, session, user)
    return AuthContext(
        session=session, user=user, membership=membership, organization=organization
    )


async def get_auth(
    auth: Annotated[AuthContext | None, Depends(get_auth_optional)],
) -> AuthContext:
    """Require an authenticated user; otherwise raise AuthenticationError.

    The global exception handler redirects browsers to the login page.
    """
    if auth is None:
        raise AuthenticationError("Please sign in to continue.")
    return auth


OptionalAuth = Annotated[AuthContext | None, Depends(get_auth_optional)]
Auth = Annotated[AuthContext, Depends(get_auth)]


# --------------------------------------------------------------------------
# RBAC
# --------------------------------------------------------------------------
def require(
    permission: Permission,
) -> Callable[..., Coroutine[Any, Any, AuthContext]]:
    """Build a dependency that requires `permission` in the active org."""

    async def _dependency(auth: Auth) -> AuthContext:
        if auth.organization is None or auth.role is None:
            raise PermissionDenied(
                "You need to create or join an organization first."
            )
        require_permission(auth.role, permission)
        return auth

    return _dependency


# --------------------------------------------------------------------------
# CSRF
# --------------------------------------------------------------------------
async def verify_csrf(request: Request, auth: OptionalAuth) -> None:
    """Validate the CSRF token on a state-changing request.

    Reading the form here is safe: Starlette caches the parsed form on the
    request, so the route handler's own `Form(...)` parameters still work.
    """
    form = await request.form()
    raw = form.get("csrf_token")
    submitted = raw if isinstance(raw, str) else None

    if auth is not None:
        expected: str | None = auth.session.csrf_token
    else:
        expected = read_anonymous_csrf(request.cookies.get(csrf_cookie_name()))

    if expected is None or not csrf_tokens_match(expected, submitted):
        raise CSRFError()


CsrfProtected = Depends(verify_csrf)
