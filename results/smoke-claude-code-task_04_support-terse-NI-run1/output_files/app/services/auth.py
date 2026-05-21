"""Authentication + RBAC for internal users.

Customers authenticate via the portal (separate cookie + password flow).
"""

from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import Depends, HTTPException, Request, status
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models.user import User, UserRole

settings = get_settings()
pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")

ALGO = "HS256"
ACCESS_TTL = timedelta(hours=12)


def hash_password(password: str) -> str:
    return pwd.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    return pwd.verify(password, hashed)


def issue_token(user: User) -> str:
    payload = {
        "sub": str(user.id),
        "role": user.role.value,
        "exp": datetime.now(timezone.utc) + ACCESS_TTL,
    }
    return jwt.encode(payload, settings.app_secret, algorithm=ALGO)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.app_secret, algorithms=[ALGO])
    except JWTError as e:
        raise HTTPException(status_code=401, detail="invalid_token") from e


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        # Fall back to cookie (for the HTML agent UI).
        token = request.cookies.get("session")
        if not token:
            raise HTTPException(status_code=401, detail="not_authenticated")
    else:
        token = auth.split(" ", 1)[1]

    payload = decode_token(token)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="bad_token")
    user = db.get(User, UUID(user_id))
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="user_inactive")
    return user


def require_role(*roles: UserRole):
    def dep(user: User = Depends(current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="forbidden")
        return user

    return dep


def authenticate(db: Session, email: str, password: str) -> User | None:
    user = db.execute(select(User).where(User.email == email.lower())).scalar_one_or_none()
    if user and user.is_active and verify_password(password, user.password_hash):
        user.last_login_at = datetime.now(timezone.utc)
        db.commit()
        return user
    return None
