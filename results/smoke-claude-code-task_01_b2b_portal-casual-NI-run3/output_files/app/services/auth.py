"""Authentication service: account creation, login, sessions, lockout.

Routers stay thin by delegating all credential handling here. Every function
that touches credentials is written to avoid user enumeration and timing leaks.
"""

from __future__ import annotations

import re
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.models.base import utcnow
from app.models.enums import Plan, Role
from app.models.login_attempt import LoginAttempt
from app.models.membership import Membership
from app.models.organization import Organization
from app.models.session import AuthSession
from app.models.user import User
from app.security import generate_token, hash_password, hash_token, verify_password

_SLUG_RE = re.compile(r"[^a-z0-9]+")


class AuthError(Exception):
    """Raised for any login failure. The message is safe to show to users."""


def slugify_unique(db: Session, name: str) -> str:
    """Produce a URL-safe organization slug that is not already taken."""
    base = _SLUG_RE.sub("-", name.lower()).strip("-") or "org"
    slug = base
    suffix = 2
    while db.scalar(select(Organization).where(Organization.slug == slug)) is not None:
        slug = f"{base}-{suffix}"
        suffix += 1
    return slug


# --- Account creation ------------------------------------------------------
def create_account(
    db: Session,
    *,
    email: str,
    full_name: str,
    organization_name: str,
    password: str,
    marketing_consent: bool,
) -> tuple[User, Organization]:
    """Create a new user, their organization, and an owner membership.

    Raises AuthError if the email is already registered.
    """
    existing = db.scalar(select(User).where(User.email == email))
    if existing is not None:
        raise AuthError("An account with that email already exists.")

    org = Organization(
        name=organization_name,
        slug=slugify_unique(db, organization_name),
        plan=Plan.STARTER,
    )
    user = User(
        email=email,
        full_name=full_name,
        password_hash=hash_password(password),
        marketing_consent=marketing_consent,
    )
    db.add_all([org, user])
    db.flush()  # assign ids

    db.add(Membership(user_id=user.id, organization_id=org.id, role=Role.OWNER))
    db.commit()
    return user, org


# --- Lockout ---------------------------------------------------------------
def is_locked_out(db: Session, email: str) -> bool:
    """True if the account has too many recent failed logins."""
    window_start = utcnow() - timedelta(minutes=settings.login_lockout_minutes)
    recent_failures = db.scalar(
        select(func.count())
        .select_from(LoginAttempt)
        .where(
            LoginAttempt.email == email,
            LoginAttempt.success.is_(False),
            LoginAttempt.created_at >= window_start,
        )
    )
    return (recent_failures or 0) >= settings.login_max_failures


def _record_attempt(db: Session, email: str, ip: str | None, success: bool) -> None:
    db.add(LoginAttempt(email=email, ip_address=ip, success=success))
    db.commit()


# --- Login -----------------------------------------------------------------
def authenticate(db: Session, *, email: str, password: str, ip: str | None) -> User:
    """Verify credentials.

    Defends against:
      - user enumeration: identical generic error for unknown email / bad
        password, and a dummy hash verification so timing does not reveal which.
      - brute force: per-account lockout window (per-IP limiting is upstream).
    """
    if is_locked_out(db, email):
        raise AuthError("Too many failed attempts. Try again later.")

    user = db.scalar(select(User).where(User.email == email))

    if user is None or not user.password_hash:
        # Spend comparable time so a missing account is not faster to reject.
        verify_password(password, _DUMMY_HASH)
        _record_attempt(db, email, ip, success=False)
        raise AuthError("Invalid email or password.")

    if not verify_password(password, user.password_hash):
        _record_attempt(db, email, ip, success=False)
        raise AuthError("Invalid email or password.")

    if not user.is_active:
        _record_attempt(db, email, ip, success=False)
        raise AuthError("This account has been disabled.")

    _record_attempt(db, email, ip, success=True)
    user.last_login_at = utcnow()
    db.commit()
    return user


# A valid bcrypt hash of a random string, used only to equalize timing.
_DUMMY_HASH = hash_password(generate_token(16))


# --- Sessions --------------------------------------------------------------
def default_organization_id(db: Session, user: User) -> str | None:
    membership = db.scalar(
        select(Membership).where(Membership.user_id == user.id).order_by(Membership.created_at)
    )
    return membership.organization_id if membership else None


def create_session(
    db: Session,
    *,
    user: User,
    organization_id: str | None,
    ip: str | None,
    user_agent: str | None,
) -> str:
    """Create a server-side session and return the raw cookie token.

    Only the token's hash is persisted; the raw value exists only in the cookie.
    """
    raw_token = generate_token(32)
    db.add(
        AuthSession(
            user_id=user.id,
            organization_id=organization_id,
            token_hash=hash_token(raw_token),
            expires_at=utcnow() + timedelta(hours=settings.session_lifetime_hours),
            ip_address=ip,
            user_agent=(user_agent or "")[:255] or None,
        )
    )
    db.commit()
    return raw_token


def resolve_session(db: Session, raw_token: str | None) -> AuthSession | None:
    """Return the active session for a cookie token, or None."""
    if not raw_token:
        return None
    session = db.scalar(select(AuthSession).where(AuthSession.token_hash == hash_token(raw_token)))
    if session is None or not session.is_active:
        return None
    return session


def revoke_session(db: Session, session: AuthSession) -> None:
    session.revoked_at = utcnow()
    db.commit()


def revoke_all_sessions(db: Session, user_id: str, *, except_id: str | None = None) -> int:
    """Revoke every active session for a user. Returns the count revoked."""
    sessions = db.scalars(
        select(AuthSession).where(
            AuthSession.user_id == user_id,
            AuthSession.revoked_at.is_(None),
        )
    ).all()
    count = 0
    for sess in sessions:
        if sess.id == except_id:
            continue
        sess.revoked_at = utcnow()
        count += 1
    db.commit()
    return count
