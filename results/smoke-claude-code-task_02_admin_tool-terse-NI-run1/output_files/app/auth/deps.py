"""FastAPI dependencies for authentication and authorization."""
import uuid
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.auth.rbac import role_has
from app.db import get_db
from app.models.admin import Admin, AdminRole


@dataclass
class CurrentAdmin:
    id: uuid.UUID
    email: str
    name: str
    role: AdminRole
    ip: str


def current_admin(request: Request, db: Session = Depends(get_db)) -> CurrentAdmin:
    """Resolve the authenticated admin from session; refuse if inactive or missing."""
    admin_id = request.session.get("admin_id")
    if not admin_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "not authenticated")
    admin = db.get(Admin, uuid.UUID(admin_id))
    if not admin or not admin.is_active:
        # Force session expiry if admin was deactivated mid-session.
        request.session.clear()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "admin inactive")
    return CurrentAdmin(
        id=admin.id,
        email=admin.email,
        name=admin.name,
        role=admin.role,
        ip=request.client.host if request.client else "",
    )


def require(*permissions: str):
    """Dependency factory: ensure the current admin holds ALL listed permissions."""
    def _check(admin: CurrentAdmin = Depends(current_admin)) -> CurrentAdmin:
        missing = [p for p in permissions if not role_has(admin.role, p)]
        if missing:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"missing permission(s): {', '.join(missing)}",
            )
        return admin
    return _check
