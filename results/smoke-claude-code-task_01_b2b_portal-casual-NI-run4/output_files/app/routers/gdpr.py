"""GDPR routes: the data & privacy page, data export, consent, and account
deletion (the right to erasure)."""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Form
from fastapi.responses import RedirectResponse, Response
from sqlalchemy import select
from starlette.requests import Request

from app.config import settings
from app.dependencies import Auth, CsrfProtected, DbSession, client_ip, user_agent
from app.exceptions import AuthenticationError, NotFoundError, ValidationError
from app.flash import set_flash
from app.models import DataExportRequest
from app.security import verify_password
from app.services import gdpr_service
from app.templating import render

router = APIRouter(prefix="/app/account", tags=["gdpr"])


@router.get("/privacy", include_in_schema=False)
async def privacy_page(request: Request, db: DbSession, auth: Auth) -> Response:
    exports = await db.scalars(
        select(DataExportRequest)
        .where(DataExportRequest.user_id == auth.user.id)
        .order_by(DataExportRequest.created_at.desc())
    )
    return render(
        request,
        "settings_privacy.html",
        {"exports": exports.all()},
        auth=auth,
    )


@router.post("/export", include_in_schema=False, dependencies=[CsrfProtected])
async def request_export(request: Request, db: DbSession, auth: Auth) -> Response:
    """Generate a machine-readable export of the user's personal data."""
    await gdpr_service.create_export(
        db,
        auth.user,
        ip_address=client_ip(request),
        user_agent=user_agent(request),
    )
    response: Response = RedirectResponse("/app/account/privacy", status_code=303)
    set_flash(
        response,
        "Your data export is ready to download below.",
        "success",
    )
    return response


@router.get("/export/{export_id}/download", include_in_schema=False)
async def download_export(
    export_id: uuid.UUID, db: DbSession, auth: Auth
) -> Response:
    """Download a previously generated export — only the owner may fetch it."""
    record = await db.get(DataExportRequest, export_id)
    if record is None or record.user_id != auth.user.id:
        raise NotFoundError("Export not found.")
    if not record.file_path or not Path(record.file_path).exists():
        raise NotFoundError("This export is no longer available. Request a new one.")

    data = Path(record.file_path).read_bytes()
    return Response(
        content=data,
        media_type="application/json",
        headers={
            "Content-Disposition": (
                f'attachment; filename="my-data-export-{export_id}.json"'
            )
        },
    )


@router.post("/consent", include_in_schema=False, dependencies=[CsrfProtected])
async def update_consent(
    request: Request,
    db: DbSession,
    auth: Auth,
    marketing_consent: Annotated[bool, Form()] = False,
) -> Response:
    await gdpr_service.update_marketing_consent(
        db,
        auth.user,
        consent=marketing_consent,
        ip_address=client_ip(request),
        user_agent=user_agent(request),
    )
    response: Response = RedirectResponse("/app/account/privacy", status_code=303)
    set_flash(response, "Your communication preferences were saved.", "success")
    return response


@router.post("/delete", include_in_schema=False, dependencies=[CsrfProtected])
async def delete_account(
    request: Request,
    db: DbSession,
    auth: Auth,
    confirm_password: Annotated[str | None, Form()] = None,
    confirm: Annotated[bool, Form()] = False,
) -> Response:
    """Erase the user's account and personal data (GDPR art. 17).

    Re-authentication is required: a password for local accounts, or an
    explicit confirmation checkbox for SSO-only accounts.
    """
    if auth.user.has_password:
        valid, _ = verify_password(confirm_password or "", auth.user.password_hash)
        if not valid:
            raise AuthenticationError(
                "Password is incorrect — account was not deleted."
            )
    elif not confirm:
        raise ValidationError("Please tick the confirmation box to proceed.")

    await gdpr_service.delete_account(
        db,
        auth.user,
        ip_address=client_ip(request),
        user_agent=user_agent(request),
    )
    # delete_account revokes every session; also clear the cookie here.
    response: Response = RedirectResponse("/", status_code=303)
    response.delete_cookie(settings.session_cookie_name, path="/")
    set_flash(
        response,
        "Your account and personal data have been permanently deleted.",
        "info",
    )
    return response
