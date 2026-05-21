"""SAML 2.0 helpers using python3-saml.

In production, IdP metadata + SP cert/key must be configured at
`app/auth/saml_settings/`. The functions here are thin wrappers.
"""
from typing import Any

from onelogin.saml2.auth import OneLogin_Saml2_Auth

from app.config import get_settings


def _prepare_request(request: Any) -> dict:
    return {
        "https": "on" if request.url.scheme == "https" else "off",
        "http_host": request.url.hostname or "",
        "server_port": str(request.url.port or ""),
        "script_name": request.url.path,
        "get_data": dict(request.query_params),
        "post_data": {},
    }


def build_auth(request: Any, post_data: dict | None = None) -> OneLogin_Saml2_Auth:
    settings = get_settings()
    req = _prepare_request(request)
    if post_data is not None:
        req["post_data"] = post_data
    saml_settings = {
        "strict": True,
        "debug": settings.env == "dev",
        "sp": {
            "entityId": settings.saml_sp_entity_id,
            "assertionConsumerService": {
                "url": settings.saml_sp_acs_url,
                "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST",
            },
            "NameIDFormat": "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
        },
        "idp": {
            # In real deployment, fetch metadata at startup. Kept minimal here.
            "entityId": settings.saml_metadata_url,
            "singleSignOnService": {
                "url": settings.saml_metadata_url,
                "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect",
            },
        },
    }
    return OneLogin_Saml2_Auth(req, old_settings=saml_settings)


def attrs_to_user_info(attrs: dict, name_id: str) -> dict:
    def _first(key: str) -> str:
        v = attrs.get(key) or []
        return v[0] if v else ""

    groups_raw = attrs.get("groups") or attrs.get("memberOf") or []
    return {
        "subject": name_id,
        "email": (_first("email") or name_id).lower(),
        "name": _first("name") or _first("displayName"),
        "groups": groups_raw,
        "provider": "saml",
    }
