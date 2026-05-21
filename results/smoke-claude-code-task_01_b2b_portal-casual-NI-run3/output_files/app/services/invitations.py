"""Invitation lifecycle: create, look up, accept, revoke."""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.base import utcnow
from app.models.enums import Role
from app.models.invitation import Invitation
from app.models.membership import Membership
from app.models.user import User
from app.security import generate_token, hash_token

INVITE_TTL = timedelta(days=7)


class InviteError(Exception):
    """Invitation problem with a user-safe message."""


def create_invitation(
    db: Session,
    *,
    organization_id: str,
    email: str,
    role: Role,
    invited_by_id: str,
) -> tuple[Invitation, str]:
    """Create an invitation. Returns (invitation, raw_token).

    The raw token goes only into the emailed link; the DB stores its hash.
    """
    already_member = db.scalar(
        select(Membership)
        .join(User, User.id == Membership.user_id)
        .where(Membership.organization_id == organization_id, User.email == email)
    )
    if already_member is not None:
        raise InviteError("That person is already a member of this organization.")

    # Supersede any earlier pending invite for the same address.
    existing = db.scalars(
        select(Invitation).where(
            Invitation.organization_id == organization_id,
            Invitation.email == email,
            Invitation.accepted_at.is_(None),
            Invitation.revoked_at.is_(None),
        )
    ).all()
    for inv in existing:
        inv.revoked_at = utcnow()

    raw_token = generate_token(32)
    invitation = Invitation(
        organization_id=organization_id,
        email=email,
        role=role,
        token_hash=hash_token(raw_token),
        invited_by_id=invited_by_id,
        expires_at=utcnow() + INVITE_TTL,
    )
    db.add(invitation)
    db.commit()
    return invitation, raw_token


def find_pending(db: Session, raw_token: str) -> Invitation | None:
    """Return the pending invitation for a raw token, or None if invalid/used."""
    invitation = db.scalar(select(Invitation).where(Invitation.token_hash == hash_token(raw_token)))
    if invitation is None or not invitation.is_pending:
        return None
    return invitation


def accept(db: Session, invitation: Invitation, user: User) -> Membership:
    """Bind a user to the invitation's org with the invited role."""
    if not invitation.is_pending:
        raise InviteError("This invitation is no longer valid.")

    existing = db.scalar(
        select(Membership).where(
            Membership.user_id == user.id,
            Membership.organization_id == invitation.organization_id,
        )
    )
    if existing is not None:
        invitation.accepted_at = utcnow()
        db.commit()
        return existing

    membership = Membership(
        user_id=user.id,
        organization_id=invitation.organization_id,
        role=invitation.role,
    )
    invitation.accepted_at = utcnow()
    db.add(membership)
    db.commit()
    return membership
