import uuid

from fastapi import APIRouter, Depends, Form, HTTPException, Request, status
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit.logger import record
from app.auth.deps import CurrentAdmin, require
from app.auth.rbac import P_FLAG_TOGGLE, P_FLAG_VIEW
from app.db import get_db
from app.models.feature_flag import FeatureFlag, FeatureFlagOverride
from app.models.org import Organization

router = APIRouter()


@router.get("", response_class=HTMLResponse)
def list_flags(
    request: Request,
    db: Session = Depends(get_db),
    admin: CurrentAdmin = Depends(require(P_FLAG_VIEW)),
):
    flags = db.scalars(select(FeatureFlag).order_by(FeatureFlag.key)).all()
    return request.app.state.templates.TemplateResponse(
        "flags/list.html",
        {"request": request, "admin": admin, "flags": flags},
    )


@router.post("/create")
def create_flag(
    key: str = Form(..., min_length=1, max_length=128),
    description: str = Form(""),
    db: Session = Depends(get_db),
    admin: CurrentAdmin = Depends(require(P_FLAG_TOGGLE)),
):
    key = key.strip().lower()
    if db.scalar(select(FeatureFlag).where(FeatureFlag.key == key)):
        raise HTTPException(status.HTTP_409_CONFLICT, "flag exists")
    flag = FeatureFlag(key=key, description=description.strip(), enabled_globally=False)
    db.add(flag)
    db.flush()
    record(db, actor=admin, action="flag.create", target_type="flag", target_id=flag.id,
           after={"key": flag.key, "enabled_globally": False})
    return RedirectResponse("/admin/flags", status_code=303)


@router.post("/{flag_id}/toggle")
def toggle_global(
    flag_id: uuid.UUID,
    db: Session = Depends(get_db),
    admin: CurrentAdmin = Depends(require(P_FLAG_TOGGLE)),
):
    flag = db.get(FeatureFlag, flag_id)
    if not flag:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    before = {"enabled_globally": flag.enabled_globally}
    flag.enabled_globally = not flag.enabled_globally
    db.flush()
    after = {"enabled_globally": flag.enabled_globally}
    record(db, actor=admin, action="flag.toggle_global", target_type="flag",
           target_id=flag.id, before=before, after=after, extra={"key": flag.key})
    return RedirectResponse("/admin/flags", status_code=303)


@router.post("/{flag_id}/override")
def set_override(
    flag_id: uuid.UUID,
    org_id: uuid.UUID = Form(...),
    enabled: str = Form(...),
    db: Session = Depends(get_db),
    admin: CurrentAdmin = Depends(require(P_FLAG_TOGGLE)),
):
    flag = db.get(FeatureFlag, flag_id)
    org = db.get(Organization, org_id)
    if not flag or not org:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    enabled_bool = enabled == "on"
    existing = db.scalar(
        select(FeatureFlagOverride).where(
            FeatureFlagOverride.flag_id == flag_id,
            FeatureFlagOverride.org_id == org_id,
        )
    )
    before = {"override": existing.enabled if existing else None}
    if existing:
        existing.enabled = enabled_bool
    else:
        db.add(FeatureFlagOverride(flag_id=flag_id, org_id=org_id, enabled=enabled_bool))
    db.flush()
    record(db, actor=admin, action="flag.override", target_type="flag",
           target_id=flag.id, before=before, after={"override": enabled_bool},
           extra={"key": flag.key, "org_id": str(org_id), "org_slug": org.slug})
    return RedirectResponse("/admin/flags", status_code=303)


@router.post("/overrides/{override_id}/delete")
def delete_override(
    override_id: uuid.UUID,
    db: Session = Depends(get_db),
    admin: CurrentAdmin = Depends(require(P_FLAG_TOGGLE)),
):
    ov = db.get(FeatureFlagOverride, override_id)
    if not ov:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    snapshot_extra = {
        "flag_id": str(ov.flag_id), "org_id": str(ov.org_id), "was_enabled": ov.enabled,
    }
    db.delete(ov)
    db.flush()
    record(db, actor=admin, action="flag.override.delete", target_type="flag",
           target_id=snapshot_extra["flag_id"], extra=snapshot_extra)
    return RedirectResponse("/admin/flags", status_code=303)
