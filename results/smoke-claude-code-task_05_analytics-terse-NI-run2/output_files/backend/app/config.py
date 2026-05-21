"""Application settings, loaded from environment / .env."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Storage
    database_url: str = "postgresql://analytics:analytics@localhost:5432/analytics"
    redis_url: str = "redis://localhost:6379/0"

    # Security
    session_secret: str = "dev-secret-change-me"
    session_ttl_seconds: int = 86400

    # Behaviour
    cache_ttl_seconds: int = 10
    ingest_rate_limit: int = 2000      # ingestion requests/sec per tenant
    dashboard_rate_limit: int = 120    # dashboard requests/min per user session
    seed_demo: bool = True
    cors_origins: str = "*"

    # Redis stream used as the ingestion queue
    ingest_stream: str = "events:ingest"
    ingest_group: str = "cg_ingest"
    ingest_stream_maxlen: int = 5_000_000


settings = Settings()
