"""SAML 2.0 Single Sign-On.

Wraps the OneLogin python3-saml toolkit. SSO is per-organization: each org
stores its own Identity Provider metadata (entity id, SSO URL, signing
certificate) in the database.

python3-saml depends on the system libraries libxml2/libxmlsec1. If the
package is unavailable (e.g. in a minimal CI image) the module still imports —
`is_available()` returns False and the SSO routes report a clear error rather
than crashing the whole app.
"""

from __future__ import annotations

from typing import Any

from starlette.requests import Request

from app.config import settings
from app.exceptions import SSOError
from app.models import Organization

try:  # pragma: no cover - import availability is environment-dependent
    from onelogin.saml2.auth import OneLogin_Saml2_Auth
    from onelogin.saml2.settings import OneLogin_Saml2_Settings

    _SAML_AVAILABLE = True
except ImportError:  # pragma: no cover
    OneLogin_Saml2_Auth = None  # type: ignore[assignment,misc]
    OneLogin_Saml2_Settings = None  # type: ignore[assignment,misc]
    _SAML_AVAILABLE = False


def is_available() -> bool:
    """Whether the SAML toolkit is installed in this environment."""
    return _SAML_AVAILABLE


def _require_available() -> None:
    if not _SAML_AVAILABLE:
        raise SSOError(
            "Single sign-on is not available on this deployment. "
            "Contact your administrator."
        )


def acs_url(org: Organization) -> str:
    """Per-organization Assertion Consumer Service URL."""
    return f"{settings.base_url}/auth/saml/{org.id}/acs"


def _sp_config() -> dict[str, Any]:
    return {
        "entityId": settings.saml_sp_entity_id,
        "assertionConsumerService": {
            "url": "",  # filled in per-org by callers
            "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST",
        },
        "NameIDFormat": "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
        "x509cert": "",
        "privateKey": "",
    }


def _saml_settings(org: Organization) -> dict[str, Any]:
    """Build the OneLogin settings dict for an organization's IdP."""
    if not (org.saml_idp_entity_id and org.saml_idp_sso_url and org.saml_idp_x509_cert):
        raise SSOError("SSO is not fully configured for this organization.")
    sp = _sp_config()
    sp["assertionConsumerService"]["url"] = acs_url(org)
    return {
        "strict": True,
        "debug": settings.debug,
        "sp": sp,
        "idp": {
            "entityId": org.saml_idp_entity_id,
            "singleSignOnService": {
                "url": org.saml_idp_sso_url,
                "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect",
            },
            "x509cert": org.saml_idp_x509_cert,
        },
        "security": {
            # Require the IdP to sign assertions — this is what authenticates
            # the SSO response. Without it an attacker could forge identities.
            "wantAssertionsSigned": True,
            "wantMessagesSigned": False,
            "requestedAuthnContext": False,
        },
    }


async def _prepare_request(request: Request) -> dict[str, Any]:
    """Translate a Starlette request into python3-saml's request dict."""
    form: dict[str, str] = {}
    if request.method == "POST":
        raw = await request.form()
        form = {k: v for k, v in raw.items() if isinstance(v, str)}
    host = request.headers.get("host", request.url.hostname or "")
    return {
        "https": "on" if request.url.scheme == "https" else "off",
        "http_host": host,
        "script_name": request.url.path,
        "get_data": dict(request.query_params),
        "post_data": form,
    }


async def _build_auth(org: Organization, request: Request) -> Any:
    _require_available()
    req = await _prepare_request(request)
    try:
        return OneLogin_Saml2_Auth(req, old_settings=_saml_settings(org))
    except Exception as exc:  # noqa: BLE001
        raise SSOError(f"Invalid SAML configuration: {exc}") from exc


async def begin_login(org: Organization, request: Request, return_to: str) -> str:
    """Return the IdP URL the browser should be redirected to for sign-in."""
    auth = await _build_auth(org, request)
    return str(auth.login(return_to=return_to))


async def process_acs(org: Organization, request: Request) -> tuple[str, str]:
    """Validate a SAML response and return the asserted (email, display name).

    Raises SSOError if the assertion is missing, unsigned, or invalid — the
    caller must not trust any attribute unless this returns successfully.
    """
    auth = await _build_auth(org, request)
    auth.process_response()
    errors = auth.get_errors()
    if errors:
        reason = auth.get_last_error_reason() or ", ".join(errors)
        raise SSOError(f"SSO assertion rejected: {reason}")
    if not auth.is_authenticated():
        raise SSOError("The identity provider did not authenticate the user.")

    name_id = (auth.get_nameid() or "").strip().lower()
    attributes = auth.get_attributes() or {}
    email = name_id

    def _first(key: str) -> str | None:
        value = attributes.get(key)
        return value[0] if isinstance(value, list) and value else None

    # Display name from common attribute keys, falling back to the email.
    display_name = (
        _first("displayName")
        or _first("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name")
        or " ".join(
            filter(
                None,
                [
                    _first("givenName"),
                    _first("surname")
                    or _first(
                        "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname"
                    ),
                ],
            )
        )
        or email.split("@")[0]
    )
    if not email or "@" not in email:
        raise SSOError("The SSO response did not include a valid email address.")
    return email, display_name


def sp_metadata() -> str:
    """Return the Service Provider metadata XML (for IdP configuration)."""
    _require_available()
    sp_settings = OneLogin_Saml2_Settings(
        {"strict": True, "sp": _sp_config(), "idp": {"entityId": "placeholder"}},
        sp_validation_only=True,
    )
    metadata = sp_settings.get_sp_metadata()
    errors = sp_settings.validate_metadata(metadata)
    if errors:
        raise SSOError(f"Could not generate SP metadata: {', '.join(errors)}")
    return metadata.decode("utf-8") if isinstance(metadata, bytes) else metadata
