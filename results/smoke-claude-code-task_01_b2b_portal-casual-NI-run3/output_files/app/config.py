"""Application settings.

All configuration is environment-driven. In production the app refuses to start
with insecure defaults — fail loud at boot rather than silently insecure at runtime.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

INSECURE_SECRET_KEYS = {
    "",
    "dev-only-insecure-change-me-0000000000000000000000000000",
    "change-me",
    "secret",
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    # --- Runtime -----------------------------------------------------------
    environment: str = "development"
    secret_key: str = "dev-only-insecure-change-me-0000000000000000000000000000"  # noqa: S105
    base_url: str = "http://localhost:8000"

    # --- Database ----------------------------------------------------------
    database_url: str = "postgresql+psycopg2://portal:portal@localhost:5432/portal"

    # --- Sessions / cookies ------------------------------------------------
    session_cookie_name: str = "acme_session"
    session_lifetime_hours: int = 72
    cookie_secure: bool = False

    # --- Rate limiting -----------------------------------------------------
    ratelimit_storage_uri: str = "memory://"
    login_rate_limit: str = "10/minute"
    signup_rate_limit: str = "5/minute"
    # Per-account lockout after repeated failures.
    login_max_failures: int = 5
    login_lockout_minutes: int = 15

    # --- Stripe ------------------------------------------------------------
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_price_starter: str = ""
    stripe_price_pro: str = ""
    stripe_price_enterprise: str = ""

    # --- SMTP --------------------------------------------------------------
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_use_tls: bool = True
    email_from: str = "Acme Portal <no-reply@acme.example>"

    # --- SAML --------------------------------------------------------------
    saml_default_idp_metadata_url: str = ""

    # --- Seed --------------------------------------------------------------
    seed_owner_email: str = ""
    seed_owner_password: str = ""
    seed_org_name: str = "Acme Inc"

    @property
    def is_production(self) -> bool:
        return self.environment.lower() in {"production", "prod"}

    @property
    def stripe_price_map(self) -> dict[str, str]:
        """Map plan code -> Stripe price id (only configured ones)."""
        raw = {
            "starter": self.stripe_price_starter,
            "pro": self.stripe_price_pro,
            "enterprise": self.stripe_price_enterprise,
        }
        return {k: v for k, v in raw.items() if v}

    @model_validator(mode="after")
    def _enforce_production_safety(self) -> Settings:
        if not self.is_production:
            return self
        problems: list[str] = []
        if self.secret_key in INSECURE_SECRET_KEYS or len(self.secret_key) < 32:
            problems.append("SECRET_KEY must be a strong random value (>=32 chars)")
        if not self.cookie_secure:
            problems.append("COOKIE_SECURE must be true in production")
        if not self.base_url.startswith("https://"):
            problems.append("BASE_URL must use https in production")
        if problems:
            raise ValueError(
                "Refusing to start in production with insecure config:\n  - "
                + "\n  - ".join(problems)
            )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
