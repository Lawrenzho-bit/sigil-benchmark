"""Database engine, session factory and the FastAPI session dependency.

All persistence goes through SQLAlchemy's ORM/Core, which uses bound
parameters for every value — there is no string-interpolated SQL anywhere in
this project, so SQL injection is not reachable through application queries.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings

_is_sqlite = settings.database_url.startswith("sqlite")

# SQLite needs check_same_thread disabled for the threadpool; Postgres gets a
# real connection pool with pre-ping so stale connections are recycled cleanly.
engine: Engine = create_engine(
    settings.database_url,
    echo=False,
    future=True,
    pool_pre_ping=not _is_sqlite,
    connect_args={"check_same_thread": False} if _is_sqlite else {},
    **({} if _is_sqlite else {"pool_size": 10, "max_overflow": 20, "pool_recycle": 1800}),
)

if _is_sqlite:

    @event.listens_for(engine, "connect")
    def _enable_sqlite_fk(dbapi_conn, _record):  # pragma: no cover - trivial
        """Enforce foreign keys on SQLite (off by default)."""
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)


def get_db() -> Iterator[Session]:
    """FastAPI dependency yielding a request-scoped session.

    The session is committed on success and rolled back on any exception so a
    failed request never leaves a partially-applied transaction.
    """
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@contextmanager
def session_scope() -> Iterator[Session]:
    """Standalone transactional scope for scripts, jobs and tests."""
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
