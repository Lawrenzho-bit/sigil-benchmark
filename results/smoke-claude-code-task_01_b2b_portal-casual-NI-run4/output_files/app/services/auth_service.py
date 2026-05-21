"""Authentication service: accounts, sessions, passwords, email verification.

Sessions are server-side and individually revocable. Changing a password
revokes every *other* session for the user, so a stolen session cannot outlive
a password reset.
"""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.enums import AuditAction
from app.exceptions import AuthenticationError, ConflictError, NotFoundError, ValidationError
from app.models import Organization, PasswordResetToken, Session, User
from app.security import (
    generate_csrf_token,
    generate_token,
    hash_password,
    hash_token,
    verify_password,
)
from app.services import audit_service, email_service, organization_service
from app.utils import normalize_email

# A small set of obviously weak passwords to reject outright. Real strength
# comes from the length + composition rules below.
_BANNED_PASSWORDS = {
    "password",
    "password1",
    "12345678",
    "qwertyuiop",
    "letmein123",
    "changeme123",
}
_MIN_PASSWORD_LENGTH = 10
_MAX_PASSWORD_LENGTH = 128


def validate_password_strength(password: str) -> None:
    """Raise ValidationError if `password` does not meet the policy."""
    if len(password) < _MIN_PASSWORD_LENGTH:
        raise ValidationError(
            f"Password must be at least {_MIN_PASSWORD_LENGTH} characters."
        )
    if len(password) > _MAX_PASSWORD_LENGTH:
        raise ValidationError("Password is too long.")
    if password.lower() in _BANNED_PASSWORDS:
        raise ValidationError("That password is too common — choose another.")
    if not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        raise ValidationError("Password must contain both letters and numbers.")


# --------------------------------------------------------------------------
# Lookups
# --------------------------------------------------------------------------
async def get_user_by_email(db: AsyncSession, email: str) -> User | None:
    return await db.scalar(
        select(User).where(User.email == normalize_email(email))
    )


# --------------------------------------------------------------------------
# Registration
# --------------------------------------------------------------------------
async def register_user(
    db: AsyncSession,
    *,
    full_name: str,
    email: str,
    password: str,
    organization_name: str,
    marketing_consent: bool,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> tuple[User, Organization]:
    """Create a user + their first organization (they become its owner)."""
    email = normalize_email(email)
    if await get_user_by_email(db, email):
        raise ConflictError("An account with that email already exists.")
    validate_password_strength(password)

    verify_token = generate_token()
    now = datetime.now(UTC)
    user = User(
        email=email,
        full_name=full_name.strip(),
        password_hash=hash_password(password),
        is_email_verified=False,
        email_verification_hash=hash_token(verify_token),
        marketing_consent=marketing_consent,
        marketing_consent_at=now if marketing_consent else None,
    )
    db.add(user)
    await db.flush()

    org = await organization_service.create_organization(
        db,
        owner=user,
        name=organization_name,
        ip_address=ip_address,
        user_agent=user_agent,
    )

    await audit_service.record(
        db,
        AuditAction.USER_SIGNED_UP,
        organization_id=org.id,
        actor_user_id=user.id,
        actor_email=user.email,
        ip_address=ip_address,
        user_agent=user_agent,
    )

    verify_url = f"{settings.base_url}/auth/verify-email?token={verify_token}"
    await email_service.send_welcome_email(
        db, to_email=user.email, full_name=user.full_name, verify_url=verify_url
    )
    return user, org


async def create_user_account(
    db: AsyncSession,
    *,
    full_name: str,
    email: str,
    password: str,
    marketing_consent: bool = False,
    email_verified: bool = False,
) -> User:
    """Create a standalone user account (no organization).

    Used when accepting an invitation: the user joins an existing org rather
    than founding one. `email_verified` is set True in that flow because
    receiving the invite email already proves control of the address.
    """
    email = normalize_email(email)
    if await get_user_by_email(db, email):
        raise ConflictError("An account with that email already exists.")
    validate_password_strength(password)

    now = datetime.now(UTC)
    user = User(
        email=email,
        full_name=full_name.strip(),
        password_hash=hash_password(password),
        is_email_verified=email_verified,
        marketing_consent=marketing_consent,
        marketing_consent_at=now if marketing_consent else None,
    )
    db.add(user)
    await db.flush()
    return user


# --------------------------------------------------------------------------
# Login / sessions
# --------------------------------------------------------------------------
async def authenticate(db: AsyncSession, email: str, password: str) -> User:
    """Verify credentials and return the user, or raise AuthenticationError.

    The error message is intentionally identical for "no such user", "wrong
    password", and "SSO-only account" so the endpoint does not reveal which
    emails are registered.
    """
    user = await get_user_by_email(db, email)
    if user is None or user.is_deleted:
        # Still spend time hashing to keep response timing uniform.
        verify_password(password, None)
        raise AuthenticationError()

    is_valid, upgraded_hash = verify_password(password, user.password_hash)
    if not is_valid:
        raise AuthenticationError()
    if upgraded_hash:
        # Transparently migrate the hash to current parameters.
        user.password_hash = upgraded_hash
    return user


async def get_or_create_sso_user(
    db: AsyncSession, *, email: str, display_name: str
) -> User:
    """Resolve the local user for a SAML-asserted identity, creating one if the
    person has never signed in before (just-in-time provisioning).

    SSO-provisioned users have no local password; `is_email_verified` is True
    because the IdP vouches for the address.
    """
    email = normalize_email(email)
    user = await get_user_by_email(db, email)
    if user is None:
        user = User(
            email=email,
            full_name=(display_name or email.split("@")[0]).strip(),
            password_hash=None,
            is_email_verified=True,
        )
        db.add(user)
        await db.flush()
    elif user.is_deleted:
        raise AuthenticationError("This account has been deactivated.")
    return user


async def start_session(
    db: AsyncSession,
    user: User,
    *,
    ip_address: str | None = None,
    user_agent: str | None = None,
    active_organization_id: uuid.UUID | None = None,
) -> Session:
    """Create a fresh server-side session for `user`."""
    now = datetime.now(UTC)
    session = Session(
        user_id=user.id,
        active_organization_id=active_organization_id,
        csrf_token=generate_csrf_token(),
        ip_address=ip_address,
        user_agent=user_agent,
        expires_at=now + timedelta(hours=settings.session_lifetime_hours),
        last_seen_at=now,
    )
    db.add(session)
    user.last_login_at = now
    await db.flush()
    return session


async def revoke_session(db: AsyncSession, session: Session) -> None:
    session.revoked_at = datetime.now(UTC)
    await db.flush()


async def revoke_all_sessions(
    db: AsyncSession, user_id: uuid.UUID, *, except_session_id: uuid.UUID | None = None
) -> None:
    """Revoke every active session for a user (used on password change/reset)."""
    stmt = (
        update(Session)
        .where(Session.user_id == user_id, Session.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC))
    )
    if except_session_id is not None:
        stmt = stmt.where(Session.id != except_session_id)
    await db.execute(stmt)


# --------------------------------------------------------------------------
# Email verification
# --------------------------------------------------------------------------
async def verify_email(db: AsyncSession, token: str) -> User:
    token_hash = hash_token(token)
    user = await db.scalar(
        select(User).where(User.email_verification_hash == token_hash)
    )
    if user is None:
        raise NotFoundError("This verification link is invalid or already used.")
    user.is_email_verified = True
    user.email_verification_hash = None
    await db.flush()
    await audit_service.record(
        db,
        AuditAction.USER_EMAIL_VERIFIED,
        actor_user_id=user.id,
        actor_email=user.email,
    )
    return user


# --------------------------------------------------------------------------
# Password reset
# --------------------------------------------------------------------------
async def request_password_reset(
    db: AsyncSession,
    email: str,
    *,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> None:
    """Issue a reset token and email it.

    Always returns without error even if the email is unknown — the endpoint
    must not reveal whether an account exists (account-enumeration defence).
    """
    user = await get_user_by_email(db, email)
    if user is None or user.is_deleted:
        return

    raw_token = generate_token()
    db.add(
        PasswordResetToken(
            user_id=user.id,
            token_hash=hash_token(raw_token),
            expires_at=datetime.now(UTC) + timedelta(hours=1),
        )
    )
    await db.flush()
    await audit_service.record(
        db,
        AuditAction.USER_PASSWORD_RESET_REQUESTED,
        actor_user_id=user.id,
        actor_email=user.email,
        ip_address=ip_address,
        user_agent=user_agent,
    )
    reset_url = f"{settings.base_url}/auth/reset-password?token={raw_token}"
    await email_service.send_password_reset_email(
        db, to_email=user.email, full_name=user.full_name, reset_url=reset_url
    )


async def reset_password(
    db: AsyncSession,
    token: str,
    new_password: str,
    *,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> User:
    """Consume a reset token and set a new password."""
    validate_password_strength(new_password)
    record = await db.scalar(
        select(PasswordResetToken).where(
            PasswordResetToken.token_hash == hash_token(token)
        )
    )
    if record is None or not record.is_usable:
        raise ValidationError("This reset link is invalid or has expired.")

    user = await db.get(User, record.user_id)
    if user is None or user.is_deleted:
        raise NotFoundError("Account not found.")

    user.password_hash = hash_password(new_password)
    record.used_at = datetime.now(UTC)
    # Invalidate every existing session — a reset implies possible compromise.
    await revoke_all_sessions(db, user.id)
    await db.flush()

    await audit_service.record(
        db,
        AuditAction.USER_PASSWORD_CHANGED,
        actor_user_id=user.id,
        actor_email=user.email,
        ip_address=ip_address,
        user_agent=user_agent,
        meta={"via": "reset"},
    )
    return user


async def change_password(
    db: AsyncSession,
    user: User,
    *,
    current_password: str,
    new_password: str,
    keep_session_id: uuid.UUID,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> None:
    """Change a logged-in user's password after re-verifying the current one."""
    is_valid, _ = verify_password(current_password, user.password_hash)
    if not is_valid:
        raise AuthenticationError("Your current password is incorrect.")
    validate_password_strength(new_password)

    user.password_hash = hash_password(new_password)
    # Keep the caller's own session; sign every other device out.
    await revoke_all_sessions(db, user.id, except_session_id=keep_session_id)
    await db.flush()

    await audit_service.record(
        db,
        AuditAction.USER_PASSWORD_CHANGED,
        actor_user_id=user.id,
        actor_email=user.email,
        ip_address=ip_address,
        user_agent=user_agent,
        meta={"via": "settings"},
    )
