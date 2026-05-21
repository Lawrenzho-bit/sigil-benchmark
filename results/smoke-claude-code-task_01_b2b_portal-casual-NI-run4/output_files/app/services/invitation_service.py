"""Member invitation service.

Invitations are addressed to an email and carry a role. The emailed link holds
a high-entropy token; only its hash is stored, and the token is single-use and
time-limited.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.enums import AuditAction, InvitationStatus, MembershipStatus, Role
from app.exceptions import ConflictError, NotFoundError, ValidationError
from app.models import Invitation, Membership, Organization, User
from app.security import generate_token, hash_token
from app.services import audit_service, email_service
from app.utils import normalize_email

_INVITE_TTL = timedelta(days=7)


async def create_invitation(
    db: AsyncSession,
    *,
    org: Organization,
    inviter: User,
    email: str,
    role: Role,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> Invitation:
    """Invite `email` to `org` with `role`, emailing them an accept link."""
    email = normalize_email(email)

    # Reject if that person is already an active member.
    existing_user = await db.scalar(select(User).where(User.email == email))
    if existing_user is not None:
        member = await db.scalar(
            select(Membership).where(
                Membership.user_id == existing_user.id,
                Membership.organization_id == org.id,
                Membership.status == MembershipStatus.ACTIVE,
            )
        )
        if member is not None:
            raise ConflictError("That person is already a member of this organization.")

    # Supersede any still-pending invitation for the same email.
    pending = await db.scalars(
        select(Invitation).where(
            Invitation.organization_id == org.id,
            Invitation.email == email,
            Invitation.status == InvitationStatus.PENDING,
        )
    )
    for old in pending:
        old.status = InvitationStatus.REVOKED

    raw_token = generate_token()
    invitation = Invitation(
        organization_id=org.id,
        email=email,
        role=role,
        token_hash=hash_token(raw_token),
        invited_by_id=inviter.id,
        status=InvitationStatus.PENDING,
        expires_at=datetime.now(UTC) + _INVITE_TTL,
    )
    db.add(invitation)
    await db.flush()

    await audit_service.record(
        db,
        AuditAction.MEMBER_INVITED,
        organization_id=org.id,
        actor_user_id=inviter.id,
        actor_email=inviter.email,
        target_type="invitation",
        target_id=invitation.id,
        ip_address=ip_address,
        user_agent=user_agent,
        meta={"email": email, "role": role.value},
    )

    accept_url = f"{settings.base_url}/auth/accept-invite?token={raw_token}"
    await email_service.send_invitation_email(
        db,
        to_email=email,
        organization_name=org.name,
        inviter_name=inviter.full_name,
        role=role.label,
        accept_url=accept_url,
        organization_id=org.id,
    )
    return invitation


async def list_pending(db: AsyncSession, org_id: uuid.UUID) -> Sequence[Invitation]:
    rows = await db.scalars(
        select(Invitation)
        .where(
            Invitation.organization_id == org_id,
            Invitation.status == InvitationStatus.PENDING,
        )
        .order_by(Invitation.created_at.desc())
    )
    return rows.all()


async def revoke_invitation(
    db: AsyncSession,
    *,
    org: Organization,
    actor: User,
    invitation_id: uuid.UUID,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> None:
    invitation = await db.get(Invitation, invitation_id)
    if invitation is None or invitation.organization_id != org.id:
        raise NotFoundError("Invitation not found.")
    if invitation.status != InvitationStatus.PENDING:
        raise ConflictError("That invitation is no longer pending.")
    invitation.status = InvitationStatus.REVOKED
    await db.flush()
    await audit_service.record(
        db,
        AuditAction.INVITATION_REVOKED,
        organization_id=org.id,
        actor_user_id=actor.id,
        actor_email=actor.email,
        target_type="invitation",
        target_id=invitation.id,
        ip_address=ip_address,
        user_agent=user_agent,
        meta={"email": invitation.email},
    )


async def get_valid_invitation(db: AsyncSession, token: str) -> Invitation:
    """Return the pending, unexpired invitation for `token`, or raise."""
    invitation = await db.scalar(
        select(Invitation).where(Invitation.token_hash == hash_token(token))
    )
    if invitation is None:
        raise NotFoundError("This invitation link is invalid.")
    if invitation.status == InvitationStatus.ACCEPTED:
        raise ConflictError("This invitation has already been accepted.")
    if invitation.status == InvitationStatus.REVOKED:
        raise ConflictError("This invitation has been revoked.")
    if invitation.is_expired:
        invitation.status = InvitationStatus.EXPIRED
        await db.flush()
        raise ConflictError("This invitation has expired. Ask for a new one.")
    return invitation


async def accept_invitation(
    db: AsyncSession,
    *,
    invitation: Invitation,
    user: User,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> Membership:
    """Accept `invitation` on behalf of `user`, creating their membership."""
    if normalize_email(user.email) != normalize_email(invitation.email):
        raise ValidationError(
            "This invitation was sent to a different email address."
        )

    existing = await db.scalar(
        select(Membership).where(
            Membership.user_id == user.id,
            Membership.organization_id == invitation.organization_id,
        )
    )
    if existing is not None:
        # Reactivate a previously-removed membership rather than duplicating.
        existing.status = MembershipStatus.ACTIVE
        existing.role = invitation.role
        membership = existing
    else:
        membership = Membership(
            user_id=user.id,
            organization_id=invitation.organization_id,
            role=invitation.role,
            status=MembershipStatus.ACTIVE,
        )
        db.add(membership)

    invitation.status = InvitationStatus.ACCEPTED
    invitation.accepted_at = datetime.now(UTC)
    await db.flush()

    await audit_service.record(
        db,
        AuditAction.INVITATION_ACCEPTED,
        organization_id=invitation.organization_id,
        actor_user_id=user.id,
        actor_email=user.email,
        target_type="membership",
        target_id=membership.id,
        ip_address=ip_address,
        user_agent=user_agent,
        meta={"role": invitation.role.value},
    )
    return membership
