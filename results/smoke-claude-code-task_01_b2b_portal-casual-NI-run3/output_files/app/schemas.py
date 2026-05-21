"""Pydantic schemas used to validate and normalize form/JSON input.

Validating through these models — rather than trusting raw form fields — gives a
single, testable place for input rules (length caps, email normalization, password
strength) and keeps routers thin.
"""

from __future__ import annotations

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.models.enums import Plan, Role

# A deliberately modest password policy: length is the dominant factor in
# strength. We reject only the obviously weak rather than enforcing theatre.
MIN_PASSWORD_LENGTH = 10


def _check_password(value: str) -> str:
    if len(value) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"Password must be at least {MIN_PASSWORD_LENGTH} characters.")
    if value.lower() in {"password00", "1234567890", "qwertyuiop"}:
        raise ValueError("That password is too common.")
    return value


class SignupInput(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=120)
    organization_name: str = Field(min_length=2, max_length=120)
    password: str
    marketing_consent: bool = False

    @field_validator("email")
    @classmethod
    def _lower(cls, v: str) -> str:
        return v.strip().lower()

    @field_validator("full_name", "organization_name")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()

    @field_validator("password")
    @classmethod
    def _password(cls, v: str) -> str:
        return _check_password(v)


class LoginInput(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)

    @field_validator("email")
    @classmethod
    def _lower(cls, v: str) -> str:
        return v.strip().lower()


class InviteInput(BaseModel):
    email: EmailStr
    role: Role

    @field_validator("email")
    @classmethod
    def _lower(cls, v: str) -> str:
        return v.strip().lower()

    @field_validator("role")
    @classmethod
    def _no_owner_invite(cls, v: Role) -> Role:
        # Ownership is transferred explicitly, never granted by invitation.
        if v is Role.OWNER:
            raise ValueError("Owners cannot be created by invitation.")
        return v


class AcceptInviteInput(BaseModel):
    full_name: str = Field(min_length=1, max_length=120)
    password: str

    @field_validator("password")
    @classmethod
    def _password(cls, v: str) -> str:
        return _check_password(v)


class RoleChangeInput(BaseModel):
    role: Role


class OrgSettingsInput(BaseModel):
    name: str = Field(min_length=2, max_length=120)

    @field_validator("name")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()


class SamlSettingsInput(BaseModel):
    saml_enabled: bool = False
    saml_idp_entity_id: str | None = Field(default=None, max_length=255)
    saml_idp_sso_url: str | None = Field(default=None, max_length=512)
    saml_idp_x509_cert: str | None = None
    saml_email_domain: str | None = Field(default=None, max_length=255)

    @field_validator("saml_idp_sso_url")
    @classmethod
    def _https_url(cls, v: str | None) -> str | None:
        if v and not v.startswith("https://"):
            raise ValueError("IdP SSO URL must use https.")
        return v


class ProfileInput(BaseModel):
    full_name: str = Field(min_length=1, max_length=120)
    marketing_consent: bool = False

    @field_validator("full_name")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()


class PasswordChangeInput(BaseModel):
    current_password: str = Field(min_length=1, max_length=200)
    new_password: str

    @field_validator("new_password")
    @classmethod
    def _password(cls, v: str) -> str:
        return _check_password(v)


class PlanSelection(BaseModel):
    plan: Plan
