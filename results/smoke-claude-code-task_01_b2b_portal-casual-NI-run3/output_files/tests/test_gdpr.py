"""GDPR feature tests: data export, account deletion, cookie consent."""

from __future__ import annotations

from app.models.user import User
from tests.conftest import create_org_with_owner, csrf_token, login


def test_data_export_returns_personal_data(client, db):
    create_org_with_owner(db, email="owner@acme.example", password="ownerpass123")
    login(client, "owner@acme.example", "ownerpass123")

    resp = client.get("/gdpr/export")
    assert resp.status_code == 200
    assert "attachment" in resp.headers["content-disposition"]
    data = resp.json()
    assert data["account"]["email"] == "owner@acme.example"
    assert len(data["organizations"]) == 1
    assert data["organizations"][0]["role"] == "owner"


def test_account_deletion_removes_user_and_sole_owner_org(client, db):
    create_org_with_owner(db, email="owner@acme.example", password="ownerpass123")
    login(client, "owner@acme.example", "ownerpass123")

    token = csrf_token(client, "/gdpr")
    resp = client.post(
        "/gdpr/delete-account",
        data={"csrf_token": token, "confirm": "DELETE", "password": "ownerpass123"},
        follow_redirects=False,
    )
    assert resp.status_code == 303
    assert db.query(User).filter_by(email="owner@acme.example").first() is None


def test_account_deletion_requires_confirmation_word(client, db):
    create_org_with_owner(db, email="owner@acme.example", password="ownerpass123")
    login(client, "owner@acme.example", "ownerpass123")

    token = csrf_token(client, "/gdpr")
    client.post(
        "/gdpr/delete-account",
        data={"csrf_token": token, "confirm": "nope", "password": "ownerpass123"},
    )
    # The account still exists.
    assert db.query(User).filter_by(email="owner@acme.example").first() is not None


def test_account_deletion_requires_correct_password(client, db):
    create_org_with_owner(db, email="owner@acme.example", password="ownerpass123")
    login(client, "owner@acme.example", "ownerpass123")

    token = csrf_token(client, "/gdpr")
    client.post(
        "/gdpr/delete-account",
        data={"csrf_token": token, "confirm": "DELETE", "password": "wrongpassword"},
    )
    assert db.query(User).filter_by(email="owner@acme.example").first() is not None


def test_cookie_consent_sets_cookie(client):
    token = csrf_token(client, "/")
    resp = client.post(
        "/cookie-consent",
        data={"csrf_token": token, "decision": "accept"},
        follow_redirects=False,
    )
    assert resp.status_code == 303
    assert "cookie_consent=accepted" in resp.headers.get("set-cookie", "")


def test_privacy_policy_is_public(client):
    resp = client.get("/legal/privacy")
    assert resp.status_code == 200
    assert "Privacy Policy" in resp.text
