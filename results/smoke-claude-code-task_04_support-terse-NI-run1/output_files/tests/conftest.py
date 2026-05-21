"""Pytest fixtures.

Tests require Postgres (we rely on FTS triggers + tsvector). The fixture spins up
a transaction per test and rolls back at teardown, so the database is reused.
"""

import os
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://helpdesk:helpdesk@db:5432/helpdesk_test")

from app.db import Base  # noqa: E402
from app.main import app  # noqa: E402
from app import db as app_db  # noqa: E402


@pytest.fixture(scope="session")
def engine():
    eng = create_engine(os.environ["DATABASE_URL"])
    # Re-create schema for an isolated test DB
    Base.metadata.drop_all(eng)
    Base.metadata.create_all(eng)
    with eng.begin() as conn:
        conn.execute(text("CREATE SEQUENCE IF NOT EXISTS tickets_number_seq START 1001"))
    return eng


@pytest.fixture
def db(engine):
    connection = engine.connect()
    trans = connection.begin()
    SessionLocal = sessionmaker(bind=connection, autoflush=False, autocommit=False, expire_on_commit=False)
    session = SessionLocal()

    def override():
        try:
            yield session
        finally:
            pass

    app_db.SessionLocal = SessionLocal
    app.dependency_overrides[app_db.get_db] = override

    yield session

    session.close()
    trans.rollback()
    connection.close()
    app.dependency_overrides.clear()


@pytest.fixture
def client(db):
    return TestClient(app)


@pytest.fixture
def admin_user(db):
    from app.models.user import User, UserRole
    from app.services.auth import hash_password

    u = User(
        email=f"admin-{uuid.uuid4().hex[:6]}@test.local",
        name="Admin",
        password_hash=hash_password("pw"),
        role=UserRole.ADMIN,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


@pytest.fixture
def admin_token(admin_user):
    from app.services.auth import issue_token

    return issue_token(admin_user)


@pytest.fixture
def auth_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}
