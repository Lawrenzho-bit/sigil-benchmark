import secrets
import uuid
from datetime import datetime, timezone
from hashlib import sha256

from fastapi import APIRouter, Depends, Form, HTTPException, Request, status
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit.logger import record
from app.auth.deps import CurrentAdmin, require
from app.auth.rbac import P_TOKEN_CREATE, P_TOKEN_REVOKE, P_TOKEN_VIEW
from app.db import get_db
from app.models.api_token import ApiToken

router = APIRouter()

ALLOWED_SCOPES = {
    "users:read", "users:write",
    "orgs:read", "orgs:write",
    "flags:read", "flags:write",
    "audit:read",
}


@router.get("", response_class=HTMLResponse)
def list_tokens(
    request: Request,
    db: Session = Depends(get_db),
    admin: CurrentAdmin = Depends(require(P_TOKEN_VIEW)),
):
    tokens = db.scalars(select(ApiToken).order_by(ApiToken.created_at.desc())).all()
    return request.app.state.templates.TemplateResponse(
        "tokens/list.html",
        {"request": request, "admin": admin, "tokens": tokens, "scopes": sorted(ALLOWED_SCOPES)},
    )


@router.post("/create", response_class=HTMLResponse)
def create_token(
    request: Request,
    name: str = Form(..., min_length=1, max_length=128),
    scopes: list[str] = Form(default=[]),
    org_id: str = Form(""),
    db: Session = Depends(get_db),
    admin: CurrentAdmin = Depends(require(P_TOKEN_CREATE)),
):
    invalid = [s for s in scopes if s not in ALLOWED_SCOPES]
    if invalid:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"unknown scopes: {invalid}")

    raw = f"adm_{secrets.token_urlsafe(32)}"
    token_hash = sha256(raw.encode()).hexdigest()
    token = ApiToken(
        name=name.strip(),
        token_hash=token_hash,
        token_prefix=raw[:12],
        scopes=scopes,
        org_id=uuid.UUID(org_id) if org_id else None,
        created_by_admin_id=admin.id,
    )
    db.add(token)
    db.flush()
    record(db, actor=admin, action="token.create", target_type="api_token",
           target_id=token.id,
           after={"name": token.name, "scopes": scopes, "org_id": org_id or None,
                  "prefix": token.token_prefix})
    return request.app.state.templates.TemplateResponse(
        "tokens/created.html",
        {"request": request, "admin": admin, "token": token, "raw_token": raw},
    )


@router.post("/{token_id}/revoke")
def revoke_token(
    token_id: uuid.UUID,
    db: Session = Depends(get_db),
    admin: CurrentAdmin = Depends(require(P_TOKEN_REVOKE)),
):
    tok = db.get(ApiToken, token_id)
    if not tok:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if tok.revoked_at is None:
        tok.revoked_at = datetime.now(timezone.utc)
        db.flush()
        record(db, actor=admin, action="token.revoke", target_type="api_token",
               target_id=tok.id, extra={"name": tok.name, "prefix": tok.token_prefix})
    return RedirectResponse("/admin/tokens", status_code=303)
