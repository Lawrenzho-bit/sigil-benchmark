"""Authentication flow tests: signup, login, logout, CSRF, lockout."""

from __future__ import annotations

from tests.conftest import create_org_with_owner, csrf_token, login


def test_signup_creates_account_and_logs_in(client):
    token = csrf_token(client, "/auth/signup")
    resp = client.post(
        "/auth/signup",
        data={
            "csrf_token": token,
            "email": "founder@startup.example",
            "full_name": "Founder",
            "organization_name": "Startup LLC",
            "password": "a-strong-password",
        },
        follow_redirects=False,
    )
    assert resp.status_code == 303
    assert resp.headers["location"] == "/dashboard"
    # The session cookie should now grant access to the dashboard.
    dash = client.get("/dashboard")
    assert dash.status_code == 200
    assert "Startup LLC" in dash.text


def test_signup_rejects_duplicate_email(client, db):
    create_org_with_owner(db, email="taken@acme.example")
    token = csrf_token(client, "/auth/signup")
    resp = client.post(
        "/auth/signup",
        data={
            "csrf_token": token,
            "email": "taken@acme.example",
            "full_name": "Someone",
            "organization_name": "Another Co",
            "password": "a-strong-password",
        },
    )
    assert resp.status_code == 400
    assert "already exists" in resp.text


def test_signup_rejects_weak_password(client):
    token = csrf_token(client, "/auth/signup")
    resp = client.post(
        "/auth/signup",
        data={
            "csrf_token": token,
            "email": "weak@acme.example",
            "full_name": "Weak",
            "organization_name": "Weak Co",
            "password": "short",
        },
    )
    assert resp.status_code == 400
    assert "10 characters" in resp.text


def test_signup_without_csrf_is_rejected(client):
    # Prime a session so a (wrong) token exists, then omit it.
    csrf_token(client, "/auth/signup")
    resp = client.post(
        "/auth/signup",
        data={
            "email": "nocsrf@acme.example",
            "full_name": "No CSRF",
            "organization_name": "No CSRF Co",
            "password": "a-strong-password",
        },
    )
    assert resp.status_code == 403


def test_login_with_correct_credentials(client, db):
    create_org_with_owner(db, email="owner@acme.example", password="ownerpass123")
    resp = login(client, "owner@acme.example", "ownerpass123")
    assert resp.status_code == 303
    assert client.get("/dashboard").status_code == 200


def test_login_with_wrong_password_fails(client, db):
    create_org_with_owner(db, email="owner@acme.example", password="ownerpass123")
    token = csrf_token(client, "/auth/login")
    resp = client.post(
        "/auth/login",
        data={"email": "owner@acme.example", "password": "wrong", "csrf_token": token},
    )
    assert resp.status_code == 401
    assert "Invalid email or password" in resp.text


def test_login_unknown_email_gives_generic_error(client):
    """No user enumeration: unknown email yields the same message as a bad password."""
    token = csrf_token(client, "/auth/login")
    resp = client.post(
        "/auth/login",
        data={"email": "ghost@nowhere.example", "password": "whatever123", "csrf_token": token},
    )
    assert resp.status_code == 401
    assert "Invalid email or password" in resp.text


def test_logout_revokes_session(client, db):
    create_org_with_owner(db, email="owner@acme.example", password="ownerpass123")
    login(client, "owner@acme.example", "ownerpass123")
    token = csrf_token(client, "/dashboard")
    client.post("/auth/logout", data={"csrf_token": token}, follow_redirects=False)
    # After logout the dashboard redirects back to login.
    resp = client.get("/dashboard", follow_redirects=False)
    assert resp.status_code == 307
    assert "/auth/login" in resp.headers["location"]


def test_account_lockout_after_repeated_failures(client, db):
    from app.services.auth import AuthError, authenticate

    create_org_with_owner(db, email="locked@acme.example", password="ownerpass123")
    for _ in range(5):
        try:
            authenticate(db, email="locked@acme.example", password="bad", ip="1.2.3.4")
        except AuthError:
            pass
    # Even the correct password is now refused inside the lockout window.
    try:
        authenticate(db, email="locked@acme.example", password="ownerpass123", ip="1.2.3.4")
        raise AssertionError("expected lockout")
    except AuthError as exc:
        assert "Too many failed attempts" in str(exc)
