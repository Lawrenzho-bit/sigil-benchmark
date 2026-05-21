"""SAML 2.0 SSO (SP-initiated) using python3-saml.

Each organization stores its own IdP metadata (entity id, SSO URL, signing cert)
on the `Organization` row, so one deployment serves many tenants' IdPs.

The native `xmlsec` library is required at runtime; the Docker image installs it.
If python3-saml is not importable the module degrades gracefully and SSO routes
report that SSO is unavailable rather than crashing the app.
"""

from __future__ import annotations

import logging
from urllib.parse import urlparse

from starlette.requests import Request

from app.config import settings
from app.models.organization import Organization

logger = logging.getLogger("acme.saml")

try:  # python3-saml depends on native xmlsec; tolerate its absence.
    from onelogin.saml2.auth import OneLogin_Saml2_Auth

    SAML_AVAILABLE = True
except Exception:  # noqa: BLE001
    OneLogin_Saml2_Auth = None  # type: ignore[assignment]
    SAML_AVAILABLE = False
    logger.warning("python3-saml/xmlsec unavailable — SSO endpoints will be disabled.")


class SamlError(Exception):
    """SSO failure with a message safe to surface to the user."""


def _sp_settings(org: Organization) -> dict:
    """Build the python3-saml settings dict for one organization.

    The SP (this app) entity id and ACS URL are derived from BASE_URL; the IdP
    half comes from the organization's stored configuration.
    """
    base = settings.base_url.rstrip("/")
    if not (org.saml_idp_entity_id and org.saml_idp_sso_url and org.saml_idp_x509_cert):
        raise SamlError("SSO is not fully configured for this organization.")
    return {
        "strict": True,
        "debug": not settings.is_production,
        "sp": {
            "entityId": f"{base}/sso/metadata",
            "assertionConsumerService": {
                "url": f"{base}/sso/acs",
                "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST",
            },
            "NameIDFormat": "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
        },
        "idp": {
            "entityId": org.saml_idp_entity_id,
            "singleSignOnService": {
                "url": org.saml_idp_sso_url,
                "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect",
            },
            "x509cert": org.saml_idp_x509_cert,
        },
        "security": {
            "wantAssertionsSigned": True,
            "wantMessagesSigned": False,
            "requestedAuthnContext": False,
        },
    }


def _prepare_request(request: Request, form: dict | None = None) -> dict:
    """Translate a Starlette request into the dict python3-saml expects."""
    url = urlparse(settings.base_url)
    return {
        "https": "on" if url.scheme == "https" else "off",
        "http_host": url.netloc,
        "server_port": str(url.port or (443 if url.scheme == "https" else 80)),
        "script_name": request.url.path,
        "get_data": dict(request.query_params),
        "post_data": form or {},
    }


def _auth(org: Organization, request: Request, form: dict | None = None):
    if not SAML_AVAILABLE:
        raise SamlError("Single sign-on is not available on this server.")
    return OneLogin_Saml2_Auth(_prepare_request(request, form), _sp_settings(org))


def build_login_redirect(org: Organization, request: Request, relay_state: str) -> str:
    """Return the IdP URL the browser should be redirected to for SP-initiated login."""
    auth = _auth(org, request)
    return auth.login(return_to=relay_state)


def process_response(org: Organization, request: Request, form: dict) -> str:
    """Validate a SAML response posted to the ACS endpoint.

    Returns the authenticated email (NameID). Raises SamlError on any validation
    failure — signature, conditions, audience, etc.
    """
    auth = _auth(org, request, form)
    auth.process_response()
    errors = auth.get_errors()
    if errors:
        reason = auth.get_last_error_reason() or ", ".join(errors)
        logger.warning("SAML validation failed for org=%s: %s", org.id, reason)
        raise SamlError("We could not verify the single sign-on response.")
    if not auth.is_authenticated():
        raise SamlError("Single sign-on did not complete.")

    nameid = (auth.get_nameid() or "").strip().lower()
    if not nameid or "@" not in nameid:
        raise SamlError("The identity provider did not return a valid email.")

    # Enforce the org's allowed email domain when one is configured.
    if org.saml_email_domain:
        domain = org.saml_email_domain.strip().lower().lstrip("@")
        if not nameid.endswith("@" + domain):
            raise SamlError("Your email domain is not permitted for this organization.")
    return nameid
