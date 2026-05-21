"""Application configuration.

Settings are read from environment variables (and a local ``.env`` file in
development). In production the app fails fast rather than booting with
insecure placeholder values — see :meth:`Settings.validate_for_production`.
"""

from __future__ import annotations

import sys
from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Placeholder secret shipped in .env.example. Refused in production.
_INSECURE_SECRET = "dev-only-insecure-secret-change-me-0000000000000000"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore", case_sensitive=False
    )

    # --- Application ---------------------------------------------------------
    environment: Literal["development", "test", "production"] = "development"
    debug: bool = True
    secret_key: str = _INSECURE_SECRET
    base_url: str = "http://localhost:8000"
    allowed_hosts: str = "localhost,127.0.0.1"

    # --- Database ------------------------------------------------------------
    database_url: str = "sqlite+pysqlite:///./saas_portal.sqlite3"

    # --- Redis ---------------------------------------------------------------
    redis_url: str = ""

    # --- Email ---------------------------------------------------------------
    email_backend: Literal["console", "smtp"] = "console"
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_use_tls: bool = True
    email_from: str = "SaaS Portal <no-reply@example.com>"

    # --- Stripe --------------------------------------------------------------
    stripe_secret_key: str = ""
    stripe_publishable_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_price_starter: str = ""
    stripe_price_pro: str = ""
    stripe_price_enterprise: str = ""

    # --- SAML SSO ------------------------------------------------------------
    saml_sp_entity_id: str = "http://localhost:8000/auth/sso/metadata"

    # --- Security tuning -----------------------------------------------------
    session_lifetime_hours: int = 720
    login_rate_limit: str = "5/5m"
    signup_rate_limit: str = "10/1h"

    # --- Derived helpers -----------------------------------------------------
    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def allowed_hosts_list(self) -> list[str]:
        return [h.strip() for h in self.allowed_hosts.split(",") if h.strip()]

    @property
    def cookie_secure(self) -> bool:
        """Send session cookies only over HTTPS outside of local dev."""
        return self.base_url.startswith("https://") or self.is_production

    @field_validator("base_url")
    @classmethod
    def _strip_trailing_slash(cls, v: str) -> str:
        return v.rstrip("/")

    def validate_for_production(self) -> list[str]:
        """Return a list of fatal misconfigurations for a production boot."""
        problems: list[str] = []
        if not self.is_production:
            return problems
        if self.secret_key == _INSECURE_SECRET or len(self.secret_key) < 32:
            problems.append("SECRET_KEY must be set to a unique 32+ character value")
        if self.debug:
            problems.append("DEBUG must be false in production")
        if self.database_url.startswith("sqlite"):
            problems.append("SQLite is not supported in production; use PostgreSQL")
        if not self.base_url.startswith("https://"):
            problems.append("BASE_URL must use https:// in production")
        if not self.stripe_secret_key or not self.stripe_webhook_secret:
            problems.append("Stripe keys (secret + webhook) are required")
        if self.email_backend == "console":
            problems.append("EMAIL_BACKEND must be 'smtp' in production")
        return problems


@lru_cache
def get_settings() -> Settings:
    """Load settings once per process.

    In production, an invalid configuration aborts startup immediately so the
    container is never marked healthy with insecure defaults.
    """
    settings = Settings()
    problems = settings.validate_for_production()
    if problems:
        print("FATAL: insecure or incomplete production configuration:", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        raise SystemExit(1)
    return settings


settings = get_settings()
