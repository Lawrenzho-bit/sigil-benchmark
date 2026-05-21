from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.user import User, UserRole
from app.services.auth import (
    authenticate,
    current_user,
    hash_password,
    issue_token,
    require_role,
)


router = APIRouter()


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class LoginOut(BaseModel):
    token: str
    role: UserRole
    user_id: UUID
    name: str


@router.post("/login", response_model=LoginOut)
def login(payload: LoginIn, db: Session = Depends(get_db)):
    user = authenticate(db, payload.email, payload.password)
    if not user:
        raise HTTPException(401, "invalid_credentials")
    return LoginOut(token=issue_token(user), role=user.role, user_id=user.id, name=user.name)


class AgentCreate(BaseModel):
    email: EmailStr
    name: str
    password: str
    role: UserRole = UserRole.AGENT


@router.post("", status_code=201)
def create_agent(
    payload: AgentCreate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_role(UserRole.ADMIN)),
):
    if db.execute(select(User).where(User.email == payload.email.lower())).scalar_one_or_none():
        raise HTTPException(409, "email_exists")
    user = User(
        email=payload.email.lower(),
        name=payload.name,
        password_hash=hash_password(payload.password),
        role=payload.role,
    )
    db.add(user)
    db.commit()
    return {"id": str(user.id)}


@router.get("/me")
def me(user: User = Depends(current_user)):
    return {"id": str(user.id), "email": user.email, "name": user.name, "role": user.role.value}
