from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: str = "dev"
    session_secret: str = "dev-secret-change-me"
    database_url: str = "postgresql+psycopg://admin:admin@localhost:5432/admin_tool"
    redis_url: str = "redis://localhost:6379/0"

    oidc_client_id: str = ""
    oidc_client_secret: str = ""
    oidc_discovery_url: str = ""
    oidc_redirect_uri: str = "http://localhost:8000/auth/oidc/callback"

    saml_metadata_url: str = ""
    saml_sp_entity_id: str = "admin-tool"
    saml_sp_acs_url: str = "http://localhost:8000/auth/saml/acs"

    role_map_super_admin: str = "admin-super"
    role_map_account_admin: str = "admin-account"
    role_map_support: str = "admin-support"
    role_map_finance: str = "admin-finance"
    role_map_read_only: str = "admin-readonly"

    impersonation_ttl: int = 900

    @property
    def group_to_role(self) -> dict[str, str]:
        return {
            self.role_map_super_admin: "super_admin",
            self.role_map_account_admin: "account_admin",
            self.role_map_support: "support",
            self.role_map_finance: "finance",
            self.role_map_read_only: "read_only",
        }


@lru_cache
def get_settings() -> Settings:
    return Settings()
