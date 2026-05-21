"""Security-control tests: headers, cookies, injection, CSRF."""

from __future__ import annotations

from tests.conftest import create_org_with_owner, csrf_token


def test_security_headers_present(client):
    resp = client.get("/")
    assert resp.headers["X-Content-Type-Options"] == "nosniff"
    assert resp.headers["X-Frame-Options"] == "DENY"
    assert "Content-Security-Policy" in resp.headers
    csp = resp.headers["Content-Security-Policy"]
    assert "default-src 'self'" in csp
    assert "object-src 'none'" in csp


def test_session_cookie_is_httponly(client, db):
    create_org_with_owner(db, email="owner@acme.example", password="ownerpass123")
    token = csrf_token(client, "/auth/login")
    resp = client.post(
        "/auth/login",
        data={"email": "owner@acme.example", "password": "ownerpass123", "csrf_token": token},
        follow_redirects=False,
    )
    set_cookie = resp.headers.get("set-cookie", "")
    assert "acme_session=" in set_cookie
    assert "HttpOnly" in set_cookie
    assert "samesite=lax" in set_cookie.lower()


def test_sql_injection_in_login_is_harmless(client, db):
    """A classic injection string is treated as an ordinary (invalid) email.

    The ORM parameterizes the query, so this can neither authenticate nor error.
    """
    create_org_with_owner(db, email="owner@acme.example", password="ownerpass123")
    token = csrf_token(client, "/auth/login")
    resp = client.post(
        "/auth/login",
        data={
            "email": "owner@acme.example' OR '1'='1",
            "password": "x",
            "csrf_token": token,
        },
    )
    # The payload is rejected (bad email / bad credentials) — never a 500, and
    # it never authenticates. 400 = failed input validation, 401 = bad creds.
    assert resp.status_code in (400, 401)
    assert "Invalid email or password" in resp.text


def test_xss_payload_is_escaped(client):
    """A script payload submitted as a form value is escaped, never executed."""
    token = csrf_token(client, "/auth/signup")
    payload = "<script>alert('xss')</script>"
    resp = client.post(
        "/auth/signup",
        data={
            "csrf_token": token,
            "email": "not-an-email",  # forces re-render of the form
            "full_name": payload,
            "organization_name": payload,
            "password": "a-strong-password",
        },
    )
    # The raw script tag must not appear unescaped in the response body.
    assert "<script>alert('xss')</script>" not in resp.text


def test_csrf_required_on_logout(client, db):
    create_org_with_owner(db, email="owner@acme.example", password="ownerpass123")
    from tests.conftest import login

    login(client, "owner@acme.example", "ownerpass123")
    # POST without a CSRF token is rejected.
    resp = client.post("/auth/logout", data={})
    assert resp.status_code == 403


def test_healthcheck(client):
    resp = client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"
