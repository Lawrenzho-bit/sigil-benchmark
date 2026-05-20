import json
from functools import lru_cache
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


DEFAULT_SLA = {
    "low":    {"first_response_min": 480, "resolution_min": 2880},
    "normal": {"first_response_min": 120, "resolution_min": 1440},
    "high":   {"first_response_min": 30,  "resolution_min": 480},
    "urgent": {"first_response_min": 15,  "resolution_min": 240},
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://support:support@db:5432/support"
    jwt_secret: str = "dev-secret-change-me"
    jwt_algorithm: str = "HS256"
    jwt_expires_min: int = 1440
    inbound_webhook_secret: str = "dev-inbound-secret"
    sla_targets_json: str = Field(default=json.dumps(DEFAULT_SLA))

    @property
    def sla_targets(self) -> dict:
        return json.loads(self.sla_targets_json)


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
