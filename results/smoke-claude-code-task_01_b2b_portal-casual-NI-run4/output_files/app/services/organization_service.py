"""Organization lifecycle and membership management.

Holds the rules that the RBAC dependency layer cannot express on its own —
most importantly the invariant that **an organization always has at least one
owner**, and that only an owner may create another owner.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.enums import AuditAction, MembershipStatus, Plan, Role, SubscriptionStatus
from app.exceptions import ConflictError, NotFoundError, PermissionDenied
from app.models import Membership, Organization, Subscription, User
from app.services import audit_service
from app.utils import unique_slug


async def create_organization(
    db: AsyncSession,
    *,
    owner: User,
    name: str,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> Organization:
    """Create a new organization, make `owner` its owner, and start it on the
    Starter plan (billing not yet activated)."""
    org = Organization(name=name.strip(), slug=unique_slug(name))
    db.add(org)
    await db.flush()

    db.add(
        Membership(
            user_id=owner.id,
            organization_id=org.id,
            role=Role.OWNER,
            status=MembershipStatus.ACTIVE,
        )
    )
    db.add(
        Subscription(
            organization_id=org.id,
            plan=Plan.STARTER,
            status=SubscriptionStatus.INCOMPLETE,
            seats=Plan.STARTER.seats,
        )
    )
    await db.flush()

    await audit_service.record(
        db,
        AuditAction.ORG_CREATED,
        organization_id=org.id,
        actor_user_id=owner.id,
        actor_email=owner.email,
        target_type="organization",
        target_id=org.id,
        ip_address=ip_address,
        user_agent=user_agent,
        meta={"name": org.name},
    )
    return org


async def ensure_membership(
    db: AsyncSession, *, user: User, org: Organization, default_role: Role
) -> Membership:
    """Return the user's membership in `org`, creating or reactivating it.

    Used by the SSO sign-in flow so an IdP-authenticated user automatically
    gains access at the organization's configured default role.
    """
    membership = await db.scalar(
        select(Membership).where(
            Membership.user_id == user.id,
            Membership.organization_id == org.id,
        )
    )
    if membership is None:
        membership = Membership(
            user_id=user.id,
            organization_id=org.id,
            role=default_role,
            status=MembershipStatus.ACTIVE,
        )
        db.add(membership)
        await db.flush()
    elif membership.status != MembershipStatus.ACTIVE:
        membership.status = MembershipStatus.ACTIVE
        await db.flush()
    return membership


async def get_organization(db: AsyncSession, org_id: uuid.UUID) -> Organization:
    org = await db.get(Organization, org_id)
    if org is None or org.deleted_at is not None:
        raise NotFoundError("Organization not found.")
    return org


async def list_members(
    db: AsyncSession, org_id: uuid.UUID
) -> Sequence[Membership]:
    """All active memberships of an org, with their users eagerly loaded."""
    rows = await db.scalars(
        select(Membership)
        .options(selectinload(Membership.user))
        .where(
            Membership.organization_id == org_id,
            Membership.status == MembershipStatus.ACTIVE,
        )
        .order_by(Membership.created_at.asc())
    )
    return rows.all()


async def count_active_members(db: AsyncSession, org_id: uuid.UUID) -> int:
    count = await db.scalar(
        select(func.count())
        .select_from(Membership)
        .where(
            Membership.organization_id == org_id,
            Membership.status == MembershipStatus.ACTIVE,
        )
    )
    return int(count or 0)


async def _count_owners(db: AsyncSession, org_id: uuid.UUID) -> int:
    count = await db.scalar(
        select(func.count())
        .select_from(Membership)
        .where(
            Membership.organization_id == org_id,
            Membership.role == Role.OWNER,
            Membership.status == MembershipStatus.ACTIVE,
        )
    )
    return int(count or 0)


async def get_membership(
    db: AsyncSession, org_id: uuid.UUID, membership_id: uuid.UUID
) -> Membership:
    membership = await db.get(Membership, membership_id)
    if (
        membership is None
        or membership.organization_id != org_id
        or membership.status != MembershipStatus.ACTIVE
    ):
        raise NotFoundError("Member not found in this organization.")
    return membership


async def change_member_role(
    db: AsyncSession,
    *,
    org: Organization,
    actor: User,
    actor_role: Role,
    target: Membership,
    new_role: Role,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> Membership:
    """Change a member's role, enforcing the privilege and last-owner rules."""
    if target.role == new_role:
        return target

    # Only an owner may grant the owner role or alter another owner.
    if new_role == Role.OWNER and actor_role != Role.OWNER:
        raise PermissionDenied("Only an owner can promote a member to owner.")
    if target.role == Role.OWNER and actor_role != Role.OWNER:
        raise PermissionDenied("Only an owner can change another owner's role.")

    # Never leave the organization without an owner.
    if target.role == Role.OWNER and new_role != Role.OWNER:
        if await _count_owners(db, org.id) <= 1:
            raise ConflictError(
                "This is the only owner. Promote another member to owner first."
            )

    previous = target.role
    target.role = new_role
    await db.flush()

    await audit_service.record(
        db,
        AuditAction.MEMBER_ROLE_CHANGED,
        organization_id=org.id,
        actor_user_id=actor.id,
        actor_email=actor.email,
        target_type="membership",
        target_id=target.id,
        ip_address=ip_address,
        user_agent=user_agent,
        meta={
            "member_user_id": str(target.user_id),
            "from": previous.value,
            "to": new_role.value,
        },
    )
    return target


async def remove_member(
    db: AsyncSession,
    *,
    org: Organization,
    actor: User,
    actor_role: Role,
    target: Membership,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> None:
    """Remove a member from the organization, enforcing the same invariants."""
    if target.role == Role.OWNER and actor_role != Role.OWNER:
        raise PermissionDenied("Only an owner can remove another owner.")
    if target.role == Role.OWNER and await _count_owners(db, org.id) <= 1:
        raise ConflictError(
            "You cannot remove the only owner. Promote another member first."
        )

    removed_user_id = target.user_id
    # Soft-suspend rather than hard-delete so historical references stay valid.
    target.status = MembershipStatus.SUSPENDED
    await db.flush()

    await audit_service.record(
        db,
        AuditAction.MEMBER_REMOVED,
        organization_id=org.id,
        actor_user_id=actor.id,
        actor_email=actor.email,
        target_type="membership",
        target_id=target.id,
        ip_address=ip_address,
        user_agent=user_agent,
        meta={"member_user_id": str(removed_user_id)},
    )


async def update_settings(
    db: AsyncSession,
    *,
    org: Organization,
    actor: User,
    name: str,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> Organization:
    org.name = name.strip()
    await db.flush()
    await audit_service.record(
        db,
        AuditAction.ORG_SETTINGS_UPDATED,
        organization_id=org.id,
        actor_user_id=actor.id,
        actor_email=actor.email,
        target_type="organization",
        target_id=org.id,
        ip_address=ip_address,
        user_agent=user_agent,
        meta={"name": org.name},
    )
    return org


async def configure_sso(
    db: AsyncSession,
    *,
    org: Organization,
    actor: User,
    idp_entity_id: str,
    idp_sso_url: str,
    idp_x509_cert: str,
    default_role: Role,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> Organization:
    org.saml_idp_entity_id = idp_entity_id.strip()
    org.saml_idp_sso_url = idp_sso_url.strip()
    org.saml_idp_x509_cert = idp_x509_cert.strip()
    org.saml_default_role = default_role
    org.sso_enabled = True
    await db.flush()
    await audit_service.record(
        db,
        AuditAction.ORG_SSO_CONFIGURED,
        organization_id=org.id,
        actor_user_id=actor.id,
        actor_email=actor.email,
        target_type="organization",
        target_id=org.id,
        ip_address=ip_address,
        user_agent=user_agent,
    )
    return org


async def disable_sso(
    db: AsyncSession,
    *,
    org: Organization,
    actor: User,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> Organization:
    org.sso_enabled = False
    await db.flush()
    await audit_service.record(
        db,
        AuditAction.ORG_SSO_DISABLED,
        organization_id=org.id,
        actor_user_id=actor.id,
        actor_email=actor.email,
        target_type="organization",
        target_id=org.id,
        ip_address=ip_address,
        user_agent=user_agent,
    )
    return org
