"""Application configuration.

All configuration comes from environment variables (12-factor). Settings are
validated once at import time; an invalid or missing required value fails fast
on boot rather than at first use.
"""

from __future__ import annotations

import functools
from typing import Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # -- Core ---------------------------------------------------------------
    environment: Literal["development", "staging", "production"] = "development"
    debug: bool = False
    secret_key: str = Field(min_length=32)
    base_url: str = "http://localhost:8000"

    # -- Database -----------------------------------------------------------
    database_url: str = "postgresql+asyncpg://portal:portal@localhost:5432/portal"

    # -- Sessions -----------------------------------------------------------
    session_cookie_name: str = "portal_session"
    session_lifetime_hours: int = 72
    session_cookie_secure: bool = False

    # -- Login rate limiting ------------------------------------------------
    login_max_attempts: int = 5
    login_attempt_window_minutes: int = 15
    login_lockout_minutes: int = 15

    # -- Stripe -------------------------------------------------------------
    stripe_secret_key: str = "sk_test_placeholder"
    stripe_webhook_secret: str = "whsec_placeholder"
    stripe_price_starter: str = "price_starter"
    stripe_price_pro: str = "price_pro"
    stripe_price_enterprise: str = "price_enterprise"

    # -- Email --------------------------------------------------------------
    email_backend: Literal["console", "smtp"] = "console"
    email_from: str = "no-reply@example.com"
    email_from_name: str = "Sigil Portal"
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_use_tls: bool = True

    # -- SAML ---------------------------------------------------------------
    saml_sp_entity_id: str = "http://localhost:8000/saml/metadata"

    @field_validator("secret_key")
    @classmethod
    def _reject_obvious_placeholder(cls, v: str) -> str:
        if v.startswith("change-me"):
            raise ValueError(
                "SECRET_KEY is still the placeholder value — set a real secret."
            )
        return v

    @model_validator(mode="after")
    def _production_safety_checks(self) -> Settings:
        """In production, refuse to boot with insecure settings."""
        if self.environment == "production":
            if self.debug:
                raise ValueError("DEBUG must be false in production.")
            if not self.session_cookie_secure:
                raise ValueError("SESSION_COOKIE_SECURE must be true in production.")
            if self.email_backend == "console":
                raise ValueError("A real EMAIL_BACKEND must be set in production.")
        return self

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def stripe_price_ids(self) -> dict[str, str]:
        """Map plan code → Stripe price id."""
        return {
            "starter": self.stripe_price_starter,
            "pro": self.stripe_price_pro,
            "enterprise": self.stripe_price_enterprise,
        }


@functools.lru_cache
def get_settings() -> Settings:
    """Return the singleton Settings instance (cached for the process)."""
    return Settings()  # type: ignore[call-arg]


settings = get_settings()
