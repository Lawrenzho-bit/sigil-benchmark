"""Email/password authentication: signup, login, logout, password reset."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Form, Request
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.responses import Response

from app.config import settings
from app.cookies import clear_session_cookie, set_session_cookie
from app.database import get_db
from app.dependencies import get_optional_auth, redirect, verify_csrf
from app.models.user import User
from app.rate_limit import limiter
from app.schemas import LoginInput, SignupInput
from app.security import hash_password, sign_payload, unsign_payload, verify_password
from app.services import auth as auth_service
from app.services.audit import Action, record
from app.services.email import send_password_reset, send_welcome
from app.templating import flash, render

router = APIRouter(prefix="/auth", tags=["auth"])

RESET_TOKEN_TTL_SECONDS = 3600


def _client_ip(request: Request) -> str | None:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else None


def _safe_next(raw: str | None) -> str:
    """Only allow same-site relative redirects (defends against open redirect)."""
    if raw and raw.startswith("/") and not raw.startswith("//"):
        return raw
    return "/dashboard"


def _validation_message(exc: ValidationError) -> str:
    return exc.errors()[0].get("msg", "Please check the form and try again.")


# --- Signup ----------------------------------------------------------------
@router.get("/signup")
def signup_form(request: Request, auth=Depends(get_optional_auth)) -> Response:
    if auth is not None:
        return redirect("/dashboard")
    return render(request, "auth/signup.html")


@router.post("/signup")
@limiter.limit(settings.signup_rate_limit)
async def signup(
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(verify_csrf),
    email: str = Form(...),
    full_name: str = Form(...),
    organization_name: str = Form(...),
    password: str = Form(...),
    marketing_consent: bool = Form(default=False),
) -> Response:
    try:
        data = SignupInput(
            email=email,
            full_name=full_name,
            organization_name=organization_name,
            password=password,
            marketing_consent=marketing_consent,
        )
    except ValidationError as exc:
        flash(request, _validation_message(exc), "error")
        return render(request, "auth/signup.html", {"form": {"email": email}}, status_code=400)

    try:
        user, org = auth_service.create_account(
            db,
            email=data.email,
            full_name=data.full_name,
            organization_name=data.organization_name,
            password=data.password,
            marketing_consent=data.marketing_consent,
        )
    except auth_service.AuthError as exc:
        flash(request, str(exc), "error")
        return render(request, "auth/signup.html", {"form": {"email": email}}, status_code=400)

    record(
        db,
        action=Action.SIGNUP,
        request=request,
        organization_id=org.id,
        actor_user_id=user.id,
        actor_email=user.email,
    )
    token = auth_service.create_session(
        db,
        user=user,
        organization_id=org.id,
        ip=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )
    await send_welcome(user.email, user.full_name)

    response = redirect("/dashboard")
    set_session_cookie(response, token)
    return response


# --- Login -----------------------------------------------------------------
@router.get("/login")
def login_form(request: Request, auth=Depends(get_optional_auth)) -> Response:
    if auth is not None:
        return redirect("/dashboard")
    target = _safe_next(request.query_params.get("next"))
    return render(request, "auth/login.html", {"next": target})


@router.post("/login")
@limiter.limit(settings.login_rate_limit)
def login(
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(verify_csrf),
    email: str = Form(...),
    password: str = Form(...),
    next: str = Form(default="/dashboard"),
) -> Response:
    target = _safe_next(next)
    try:
        data = LoginInput(email=email, password=password)
    except ValidationError:
        flash(request, "Invalid email or password.", "error")
        return render(request, "auth/login.html", {"next": target}, status_code=400)

    ip = _client_ip(request)
    try:
        user = auth_service.authenticate(db, email=data.email, password=data.password, ip=ip)
    except auth_service.AuthError as exc:
        record(
            db,
            action=Action.LOGIN_FAILED,
            request=request,
            actor_email=data.email,
            details={"reason": str(exc)},
        )
        flash(request, str(exc), "error")
        return render(request, "auth/login.html", {"next": target}, status_code=401)

    org_id = auth_service.default_organization_id(db, user)
    token = auth_service.create_session(
        db,
        user=user,
        organization_id=org_id,
        ip=ip,
        user_agent=request.headers.get("user-agent"),
    )
    record(
        db,
        action=Action.LOGIN,
        request=request,
        organization_id=org_id,
        actor_user_id=user.id,
        actor_email=user.email,
    )
    response = redirect(target)
    set_session_cookie(response, token)
    return response


# --- Logout ----------------------------------------------------------------
@router.post("/logout", dependencies=[Depends(verify_csrf)])
def logout(request: Request, db: Session = Depends(get_db)) -> Response:
    raw = request.cookies.get(settings.session_cookie_name)
    session = auth_service.resolve_session(db, raw)
    if session is not None:
        record(
            db,
            action=Action.LOGOUT,
            request=request,
            organization_id=session.organization_id,
            actor_user_id=session.user_id,
        )
        auth_service.revoke_session(db, session)
    response = redirect("/")
    clear_session_cookie(response)
    return response


# --- Password reset --------------------------------------------------------
@router.get("/forgot")
def forgot_form(request: Request) -> Response:
    return render(request, "auth/forgot.html")


@router.post("/forgot")
@limiter.limit("5/minute")
async def forgot(
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(verify_csrf),
    email: str = Form(...),
) -> Response:
    normalized = email.strip().lower()
    user = db.scalar(select(User).where(User.email == normalized))
    # Always show the same confirmation — never reveal whether an account exists.
    if user is not None and user.is_active and user.password_hash:
        token = sign_payload({"uid": user.id, "purpose": "reset"})
        await send_password_reset(user.email, f"{settings.base_url}/auth/reset?token={token}")
    flash(request, "If that email is registered, a reset link is on its way.", "info")
    return redirect("/auth/login")


@router.get("/reset")
def reset_form(request: Request, token: str = "") -> Response:
    payload = unsign_payload(token, RESET_TOKEN_TTL_SECONDS)
    if not payload or payload.get("purpose") != "reset":
        flash(request, "That reset link is invalid or has expired.", "error")
        return redirect("/auth/forgot")
    return render(request, "auth/reset.html", {"token": token})


@router.post("/reset")
def reset(
    request: Request,
    db: Session = Depends(get_db),
    _: None = Depends(verify_csrf),
    token: str = Form(...),
    password: str = Form(...),
) -> Response:
    payload = unsign_payload(token, RESET_TOKEN_TTL_SECONDS)
    if not payload or payload.get("purpose") != "reset":
        flash(request, "That reset link is invalid or has expired.", "error")
        return redirect("/auth/forgot")

    from app.schemas import _check_password  # local import: validation helper

    try:
        _check_password(password)
    except ValueError as exc:
        flash(request, str(exc), "error")
        return render(request, "auth/reset.html", {"token": token}, status_code=400)

    user = db.get(User, payload["uid"])
    if user is None:
        flash(request, "That reset link is invalid or has expired.", "error")
        return redirect("/auth/forgot")

    user.password_hash = hash_password(password)
    db.commit()
    # Reset invalidates every existing session — a precaution if the account
    # was compromised.
    auth_service.revoke_all_sessions(db, user.id)
    record(
        db,
        action=Action.PASSWORD_CHANGED,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        details={"via": "reset"},
    )
    flash(request, "Your password has been updated. Please sign in.", "success")
    return redirect("/auth/login")


# Re-export so other modules can reuse the password verifier without a deep import.
__all__ = ["router", "verify_password"]
