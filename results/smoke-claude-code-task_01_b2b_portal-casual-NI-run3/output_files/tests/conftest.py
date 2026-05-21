"""Test fixtures.

The suite runs against a throwaway SQLite database so it needs no Postgres and
no network. Environment variables are set *before* the app is imported so the
cached Settings object picks them up.
"""

from __future__ import annotations

import os
import re
import tempfile

# --- Environment must be configured before importing the app --------------
_TEST_DB = os.path.join(tempfile.gettempdir(), "acme_portal_test.sqlite3")
os.environ.update(
    {
        "ENVIRONMENT": "development",
        "DATABASE_URL": f"sqlite:///{_TEST_DB}",
        "SECRET_KEY": "test-secret-key-not-used-in-production-0123456789",
        "BASE_URL": "http://testserver",
        "SMTP_HOST": "",  # emails go to the log, not the network
        "STRIPE_SECRET_KEY": "",
        "STRIPE_WEBHOOK_SECRET": "whsec_testsecret",
    }
)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.database import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models.enums import Role  # noqa: E402
from app.rate_limit import limiter  # noqa: E402
from app.security import hash_password  # noqa: E402

# Rate limiting is exercised by its own dedicated test; disable it elsewhere so
# unrelated tests are not flaky.
limiter.enabled = False


@pytest.fixture(autouse=True)
def _fresh_schema():
    """Recreate the schema before every test for full isolation."""
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


# --- Helpers ---------------------------------------------------------------
def csrf_token(client: TestClient, path: str) -> str:
    """Fetch a page and extract its CSRF token (also seeds the session cookie)."""
    html = client.get(path).text
    match = re.search(r'name="csrf_token" value="([^"]+)"', html)
    assert match, f"no CSRF token found on {path}"
    return match.group(1)


def create_org_with_owner(
    db,
    *,
    email: str = "owner@acme.example",
    password: str = "ownerpass123",
    org_name: str = "Acme Inc",
):
    """Create an organization and an owner user. Returns (user, org)."""
    from app.models.membership import Membership
    from app.models.organization import Organization
    from app.models.user import User
    from app.services.auth import slugify_unique

    org = Organization(name=org_name, slug=slugify_unique(db, org_name))
    user = User(email=email, full_name="Owner", password_hash=hash_password(password))
    db.add_all([org, user])
    db.flush()
    db.add(Membership(user_id=user.id, organization_id=org.id, role=Role.OWNER))
    db.commit()
    return user, org


def add_member(db, org, *, email: str, role: Role, password: str = "memberpass123"):
    """Add a user to an existing org with a given role. Returns the user."""
    from app.models.membership import Membership
    from app.models.user import User

    user = User(email=email, full_name=email.split("@")[0], password_hash=hash_password(password))
    db.add(user)
    db.flush()
    db.add(Membership(user_id=user.id, organization_id=org.id, role=role))
    db.commit()
    return user


def login(client: TestClient, email: str, password: str):
    """Log in through the real endpoint so the client holds a session cookie."""
    token = csrf_token(client, "/auth/login")
    return client.post(
        "/auth/login",
        data={"email": email, "password": password, "csrf_token": token, "next": "/dashboard"},
        follow_redirects=False,
    )
