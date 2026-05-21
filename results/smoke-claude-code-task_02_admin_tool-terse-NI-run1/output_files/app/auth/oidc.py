from authlib.integrations.starlette_client import OAuth

from app.config import get_settings

settings = get_settings()
oauth = OAuth()

if settings.oidc_client_id and settings.oidc_discovery_url:
    oauth.register(
        name="oidc",
        client_id=settings.oidc_client_id,
        client_secret=settings.oidc_client_secret,
        server_metadata_url=settings.oidc_discovery_url,
        client_kwargs={"scope": "openid email profile groups"},
    )


def claims_to_user_info(claims: dict) -> dict:
    """Normalize OIDC claims into a common shape."""
    return {
        "subject": claims.get("sub", ""),
        "email": claims.get("email", "").lower(),
        "name": claims.get("name") or claims.get("preferred_username", ""),
        "groups": claims.get("groups") or claims.get("roles") or [],
        "provider": "oidc",
    }
