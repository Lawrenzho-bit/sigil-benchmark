from __future__ import annotations

import os
import sys
from pathlib import Path

# Make the project importable when running `pytest` from the repo root.
PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

# Override DB url BEFORE app modules load.
os.environ["DATABASE_URL"] = "sqlite+pysqlite:///:memory:"
os.environ["JWT_SECRET"] = "test-secret"
os.environ["INBOUND_WEBHOOK_SECRET"] = "test-inbound-secret"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import db as db_module
from app.auth import hash_password
from app.main import create_app
from app.models import Base, Role, User


@pytest.fixture(scope="function")
def engine():
    """Fresh in-memory database per test for full isolation."""
    # StaticPool keeps a single connection alive so :memory: is shared across
    # the test's setup, the SessionLocal in routes, and the TestClient threads.
    eng = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    # SQLite needs PRAGMA for FK enforcement.
    @event.listens_for(eng, "connect")
    def _fk_on(dbapi_conn, _):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()
    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture
def session_factory(engine):
    return sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


@pytest.fixture
def db(session_factory):
    session = session_factory()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client(session_factory, engine, monkeypatch):
    # Swap the app's SessionLocal so all routes use the test DB.
    monkeypatch.setattr(db_module, "engine", engine)
    monkeypatch.setattr(db_module, "SessionLocal", session_factory)
    app = create_app()
    with TestClient(app) as c:
        yield c


@pytest.fixture
def users(db):
    """Seed three users and return them keyed by role."""
    rows = {
        "admin": User(email="admin@example.com", name="A", role=Role.admin.value,
                      hashed_password=hash_password("pw")),
        "agent": User(email="agent@example.com", name="G", role=Role.agent.value,
                      hashed_password=hash_password("pw")),
        "customer": User(email="cust@example.com", name="C", role=Role.customer.value,
                         hashed_password=hash_password("pw")),
        "customer2": User(email="cust2@example.com", name="C2", role=Role.customer.value,
                          hashed_password=hash_password("pw")),
    }
    for u in rows.values():
        db.add(u)
    db.commit()
    for u in rows.values():
        db.refresh(u)
    return rows


def _login(client, email: str, password: str = "pw") -> dict[str, str]:
    resp = client.post("/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def auth_headers(client, users):
    return {
        "admin": _login(client, users["admin"].email),
        "agent": _login(client, users["agent"].email),
        "customer": _login(client, users["customer"].email),
        "customer2": _login(client, users["customer2"].email),
    }
