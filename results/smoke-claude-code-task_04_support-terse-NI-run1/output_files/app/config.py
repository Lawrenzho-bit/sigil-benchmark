from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = "development"
    app_secret: str = "dev-secret-change-me"

    database_url: str = "postgresql+psycopg://helpdesk:helpdesk@db:5432/helpdesk"
    database_url_read: str | None = None
    redis_url: str = "redis://redis:6379/0"

    smtp_host: str = "localhost"
    smtp_port: int = 587
    smtp_user: str | None = None
    smtp_password: str | None = None
    smtp_from: str = "support@example.com"
    smtp_tls: bool = True
    inbound_address_domain: str = "example.com"

    inbound_webhook_secret: str = "dev-inbound-secret"

    sla_first_response_min: int = 60
    sla_resolution_min: int = 1440

    slack_bot_token: str | None = None
    slack_signing_secret: str | None = None

    retention_days_closed_tickets: int = 730
    audit_log_retention_days: int = 2555

    search_backend: str = Field(default="postgres_fts")

    csat_delay_seconds: int = 3600

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
