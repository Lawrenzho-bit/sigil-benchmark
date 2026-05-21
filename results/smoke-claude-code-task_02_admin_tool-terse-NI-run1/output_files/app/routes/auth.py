"""SSO entrypoints (OIDC + SAML). No local password authentication exists."""
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit.logger import record
from app.auth.deps import CurrentAdmin, current_admin
from app.auth.oidc import claims_to_user_info, oauth
from app.auth.rbac import map_groups_to_role
from app.auth.saml import attrs_to_user_info, build_auth
from app.config import get_settings
from app.db import get_db
from app.models.admin import Admin, AdminRole

router = APIRouter()
settings = get_settings()


@router.get("/login", response_class=HTMLResponse)
def login_page(request: Request):
    templates = request.app.state.templates
    return templates.TemplateResponse(
        "login.html",
        {
            "request": request,
            "oidc_enabled": bool(settings.oidc_client_id),
            "saml_enabled": bool(settings.saml_metadata_url),
        },
    )


@router.get("/logout")
def logout(request: Request, db: Session = Depends(get_db)):
    admin_id = request.session.get("admin_id")
    if admin_id:
        admin = db.get(Admin, admin_id)
        if admin:
            actor = CurrentAdmin(
                id=admin.id, email=admin.email, name=admin.name,
                role=admin.role, ip=request.client.host if request.client else "",
            )
            record(db, actor=actor, action="admin.logout",
                   target_type="admin", target_id=admin.id)
    request.session.clear()
    return RedirectResponse("/auth/login", status_code=302)


# --- OIDC ------------------------------------------------------------------

@router.get("/oidc/login")
async def oidc_login(request: Request):
    if not settings.oidc_client_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "OIDC not configured")
    return await oauth.oidc.authorize_redirect(request, settings.oidc_redirect_uri)


@router.get("/oidc/callback")
async def oidc_callback(request: Request, db: Session = Depends(get_db)):
    if not settings.oidc_client_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "OIDC not configured")
    token = await oauth.oidc.authorize_access_token(request)
    user_info = claims_to_user_info(token.get("userinfo") or token.get("id_token_claims", {}))
    return _complete_login(request, db, user_info)


# --- SAML -------------------------------------------------------------------

@router.get("/saml/login")
def saml_login(request: Request):
    if not settings.saml_metadata_url:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "SAML not configured")
    auth = build_auth(request)
    return RedirectResponse(auth.login(), status_code=302)


@router.post("/saml/acs")
async def saml_acs(request: Request, db: Session = Depends(get_db)):
    if not settings.saml_metadata_url:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "SAML not configured")
    form = await request.form()
    auth = build_auth(request, post_data=dict(form))
    auth.process_response()
    errors = auth.get_errors()
    if errors:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"SAML error: {','.join(errors)}")
    if not auth.is_authenticated():
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "SAML auth failed")
    user_info = attrs_to_user_info(auth.get_attributes(), auth.get_nameid())
    return _complete_login(request, db, user_info)


@router.get("/saml/metadata")
def saml_metadata(request: Request) -> Response:
    if not settings.saml_metadata_url:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "SAML not configured")
    auth = build_auth(request)
    metadata = auth.get_settings().get_sp_metadata()
    errors = auth.get_settings().validate_metadata(metadata)
    if errors:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, ",".join(errors))
    return Response(metadata, media_type="application/xml")


# --- Common login completion -----------------------------------------------

def _complete_login(request: Request, db: Session, info: dict) -> RedirectResponse:
    if not info.get("subject") or not info.get("email"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing subject/email claim")

    role = map_groups_to_role(info["groups"], settings.group_to_role)
    if role is None:
        # No group → no access. Audit anyway (no admin_id yet → record best-effort).
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "no admin role granted by IdP groups",
        )

    admin = db.scalar(select(Admin).where(Admin.sso_subject == info["subject"]))
    is_new = admin is None
    before = None
    if admin is None:
        admin = Admin(
            sso_subject=info["subject"],
            sso_provider=info["provider"],
            email=info["email"],
            name=info["name"] or info["email"],
            role=role,
            is_active=True,
        )
        db.add(admin)
        db.flush()
    else:
        if not admin.is_active:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "admin deactivated")
        before = {"email": admin.email, "name": admin.name, "role": admin.role.value}
        admin.email = info["email"]
        admin.name = info["name"] or admin.name
        admin.role = role
        db.flush()

    actor = CurrentAdmin(
        id=admin.id, email=admin.email, name=admin.name,
        role=admin.role, ip=request.client.host if request.client else "",
    )
    after = {"email": admin.email, "name": admin.name, "role": admin.role.value}
    record(
        db, actor=actor,
        action="admin.login.new" if is_new else "admin.login",
        target_type="admin", target_id=admin.id,
        before=before, after=after,
        extra={"provider": info["provider"]},
    )

    request.session["admin_id"] = str(admin.id)
    request.session["admin"] = {
        "email": admin.email, "name": admin.name, "role": admin.role.value,
    }
    return RedirectResponse("/admin/dashboard", status_code=302)


@router.get("/me")
def me(admin: CurrentAdmin = Depends(current_admin)):
    return {
        "id": str(admin.id), "email": admin.email,
        "name": admin.name, "role": admin.role.value,
    }
