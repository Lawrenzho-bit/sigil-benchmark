"""Async SQLAlchemy engine, session factory, and the FastAPI DB dependency."""

from __future__ import annotations

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import settings

# SQLite (used by the test suite) needs a couple of connect args; Postgres
# (production) does not. We branch once here so the rest of the app is unaware.
_is_sqlite = settings.database_url.startswith("sqlite")

engine: AsyncEngine = create_async_engine(
    settings.database_url,
    echo=False,
    pool_pre_ping=True,
    # pool_size/max_overflow are ignored by SQLite's pool but harmless to omit.
    **({} if _is_sqlite else {"pool_size": 10, "max_overflow": 20}),
)

SessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency yielding a request-scoped session.

    The session is committed if the handler returns normally and rolled back
    on any exception, so handlers never have to manage transactions manually.
    """
    async with SessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
