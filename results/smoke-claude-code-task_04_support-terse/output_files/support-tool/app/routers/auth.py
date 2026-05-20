from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app import audit, schemas
from app.auth import (
    client_ip,
    current_admin,
    hash_password,
    issue_token,
    verify_password,
)
from app.db import get_db
from app.models import User


router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=schemas.TokenResponse)
def login(payload: schemas.LoginRequest, request: Request, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if not user or user.is_anonymized or not verify_password(payload.password, user.hashed_password or ""):
        audit.record(db, actor=None, action="auth.login_failed", entity_type="user",
                     entity_id=payload.email, ip=client_ip(request))
        db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid credentials")
    audit.record(db, actor=user, action="auth.login", entity_type="user",
                 entity_id=user.id, ip=client_ip(request))
    db.commit()
    return schemas.TokenResponse(access_token=issue_token(user))


@router.post("/users", response_model=schemas.UserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: schemas.UserCreate,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(current_admin),
):
    if db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "email already registered")
    user = User(
        email=payload.email,
        name=payload.name,
        role=payload.role,
        hashed_password=hash_password(payload.password),
    )
    db.add(user)
    db.flush()
    audit.record(db, actor=actor, action="user.create", entity_type="user",
                 entity_id=user.id, payload={"role": user.role}, ip=client_ip(request))
    db.commit()
    return user


@router.post("/register", response_model=schemas.UserOut, status_code=status.HTTP_201_CREATED)
def self_register(payload: schemas.UserCreate, request: Request, db: Session = Depends(get_db)):
    """Customer self-signup. Forces role=customer regardless of payload."""
    if db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "email already registered")
    user = User(
        email=payload.email,
        name=payload.name,
        role="customer",
        hashed_password=hash_password(payload.password),
    )
    db.add(user)
    db.flush()
    audit.record(db, actor=None, action="user.self_register", entity_type="user",
                 entity_id=user.id, ip=client_ip(request))
    db.commit()
    return user
