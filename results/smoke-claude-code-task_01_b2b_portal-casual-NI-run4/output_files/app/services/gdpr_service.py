"""GDPR service: personal-data export (art. 15/20) and erasure (art. 17).

Erasure anonymises the user row in place rather than hard-deleting it, so that
audit-log foreign keys — which auditors and regulators may require — stay
intact. All directly-identifying fields are scrubbed; the audit trail keeps a
denormalised actor email captured at the time each action occurred.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.enums import AuditAction, ExportStatus, MembershipStatus, Role
from app.exceptions import ConflictError
from app.models import (
    AuditLog,
    DataExportRequest,
    EmailLog,
    LoginAttempt,
    Membership,
    Organization,
    Session,
    User,
)
from app.services import audit_service

# Where generated export archives are written. Created on first use.
EXPORT_DIR = Path("exports")


def _json_default(value: Any) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    return str(value)


async def build_export_payload(db: AsyncSession, user: User) -> dict[str, Any]:
    """Collect every piece of personal data held about `user` into one dict."""
    memberships = await db.scalars(
        select(Membership)
        .options(selectinload(Membership.organization))
        .where(Membership.user_id == user.id)
    )
    audit_rows = await db.scalars(
        select(AuditLog).where(AuditLog.actor_user_id == user.id)
    )
    email_rows = await db.scalars(
        select(EmailLog).where(EmailLog.to_email == user.email)
    )
    login_rows = await db.scalars(
        select(LoginAttempt).where(LoginAttempt.email == user.email)
    )
    session_rows = await db.scalars(
        select(Session).where(Session.user_id == user.id)
    )

    return {
        "export_generated_at": datetime.now(UTC).isoformat(),
        "format": "Sigil Portal personal data export v1",
        "account": {
            "id": str(user.id),
            "email": user.email,
            "full_name": user.full_name,
            "email_verified": user.is_email_verified,
            "marketing_consent": user.marketing_consent,
            "marketing_consent_at": user.marketing_consent_at,
            "created_at": user.created_at,
            "last_login_at": user.last_login_at,
        },
        "organization_memberships": [
            {
                "organization": m.organization.name if m.organization else None,
                "role": m.role.value,
                "status": m.status.value,
                "joined_at": m.created_at,
            }
            for m in memberships
        ],
        "audit_log_entries": [
            {"action": a.action, "at": a.created_at, "ip_address": a.ip_address}
            for a in audit_rows
        ],
        "emails_received": [
            {"subject": e.subject, "at": e.created_at, "status": e.status}
            for e in email_rows
        ],
        "login_history": [
            {"at": la.created_at, "ip_address": la.ip_address, "successful": la.successful}
            for la in login_rows
        ],
        "sessions": [
            {
                "created_at": s.created_at,
                "last_seen_at": s.last_seen_at,
                "ip_address": s.ip_address,
                "user_agent": s.user_agent,
                "revoked": s.revoked_at is not None,
            }
            for s in session_rows
        ],
    }


async def create_export(
    db: AsyncSession,
    user: User,
    *,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> tuple[DataExportRequest, bytes]:
    """Generate the user's data export, persist it, and return its bytes."""
    request = DataExportRequest(user_id=user.id, status=ExportStatus.PENDING)
    db.add(request)
    await db.flush()

    await audit_service.record(
        db,
        AuditAction.GDPR_DATA_EXPORT_REQUESTED,
        actor_user_id=user.id,
        actor_email=user.email,
        ip_address=ip_address,
        user_agent=user_agent,
    )

    try:
        payload = await build_export_payload(db, user)
        body = json.dumps(payload, default=_json_default, indent=2).encode("utf-8")
        EXPORT_DIR.mkdir(parents=True, exist_ok=True)
        path = EXPORT_DIR / f"{request.id}.json"
        path.write_bytes(body)
        request.status = ExportStatus.READY
        request.file_path = str(path)
        request.completed_at = datetime.now(UTC)
    except Exception as exc:  # noqa: BLE001
        request.status = ExportStatus.FAILED
        request.error = str(exc)[:512]
        await db.flush()
        raise

    await db.flush()
    await audit_service.record(
        db,
        AuditAction.GDPR_DATA_EXPORTED,
        actor_user_id=user.id,
        actor_email=user.email,
        ip_address=ip_address,
        user_agent=user_agent,
    )
    return request, body


async def _check_ownership_before_deletion(db: AsyncSession, user: User) -> None:
    """Block deletion if it would leave an organization ownerless.

    The user must transfer ownership (or remove the other members) first.
    """
    memberships = await db.scalars(
        select(Membership).where(
            Membership.user_id == user.id,
            Membership.role == Role.OWNER,
            Membership.status == MembershipStatus.ACTIVE,
        )
    )
    for membership in memberships:
        org_members = await db.scalars(
            select(Membership).where(
                Membership.organization_id == membership.organization_id,
                Membership.status == MembershipStatus.ACTIVE,
            )
        )
        members = list(org_members)
        other_owners = [
            m for m in members if m.role == Role.OWNER and m.user_id != user.id
        ]
        other_members = [m for m in members if m.user_id != user.id]
        if other_members and not other_owners:
            org = await db.get(Organization, membership.organization_id)
            name = org.name if org else "an organization"
            raise ConflictError(
                f"You are the only owner of '{name}'. Transfer ownership to "
                "another member before deleting your account."
            )


async def delete_account(
    db: AsyncSession,
    user: User,
    *,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> None:
    """Erase the user's personal data (GDPR art. 17)."""
    await _check_ownership_before_deletion(db, user)
    original_email = user.email

    # Soft-delete any organization where this user is now the sole member.
    memberships = list(
        await db.scalars(select(Membership).where(Membership.user_id == user.id))
    )
    for membership in memberships:
        remaining = await db.scalars(
            select(Membership).where(
                Membership.organization_id == membership.organization_id,
                Membership.status == MembershipStatus.ACTIVE,
                Membership.user_id != user.id,
            )
        )
        if not list(remaining):
            org = await db.get(Organization, membership.organization_id)
            if org is not None and org.deleted_at is None:
                org.deleted_at = datetime.now(UTC)
        membership.status = MembershipStatus.SUSPENDED

    # Revoke all sessions so the account cannot keep being used.
    for session in await db.scalars(select(Session).where(Session.user_id == user.id)):
        if session.revoked_at is None:
            session.revoked_at = datetime.now(UTC)

    # Scrub identifying fields. The row is kept; FKs remain valid.
    anon = f"deleted-{uuid.uuid4().hex}@deleted.invalid"
    user.email = anon
    user.full_name = "Deleted user"
    user.password_hash = None
    user.email_verification_hash = None
    user.is_email_verified = False
    user.marketing_consent = False
    user.marketing_consent_at = None
    user.deleted_at = datetime.now(UTC)
    await db.flush()

    await audit_service.record(
        db,
        AuditAction.GDPR_ACCOUNT_DELETED,
        actor_user_id=user.id,
        actor_email=original_email,
        ip_address=ip_address,
        user_agent=user_agent,
    )


async def update_marketing_consent(
    db: AsyncSession,
    user: User,
    *,
    consent: bool,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> None:
    """Record a change to the user's marketing-consent preference."""
    user.marketing_consent = consent
    user.marketing_consent_at = datetime.now(UTC) if consent else None
    await db.flush()
    await audit_service.record(
        db,
        AuditAction.GDPR_CONSENT_UPDATED,
        actor_user_id=user.id,
        actor_email=user.email,
        ip_address=ip_address,
        user_agent=user_agent,
        meta={"marketing_consent": consent},
    )
