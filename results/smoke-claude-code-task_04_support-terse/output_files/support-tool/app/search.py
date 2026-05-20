"""Portable search.

On Postgres, uses the generated `search_tsv` column + plainto_tsquery.
On other dialects (sqlite in tests), falls back to ILIKE.
"""
from __future__ import annotations

from sqlalchemy import or_, text
from sqlalchemy.orm import Session

from app.models import KBArticle, Ticket


def _is_postgres(db: Session) -> bool:
    return db.bind.dialect.name == "postgresql"


def search_tickets(db: Session, q: str, limit: int = 50) -> list[Ticket]:
    if not q.strip():
        return []
    if _is_postgres(db):
        stmt = (
            text(
                "SELECT id FROM tickets "
                "WHERE search_tsv @@ plainto_tsquery('english', :q) "
                "ORDER BY ts_rank(search_tsv, plainto_tsquery('english', :q)) DESC "
                "LIMIT :limit"
            )
            .bindparams(q=q, limit=limit)
        )
        ids = [row[0] for row in db.execute(stmt)]
        if not ids:
            return []
        return list(db.execute(
            text("SELECT * FROM tickets WHERE id = ANY(:ids)").bindparams(ids=ids)
        ).mappings())
    needle = f"%{q}%"
    return list(
        db.query(Ticket)
        .filter(or_(Ticket.subject.ilike(needle), Ticket.description.ilike(needle)))
        .limit(limit)
    )


def search_kb(db: Session, q: str, limit: int = 20) -> list[KBArticle]:
    if not q.strip():
        return []
    if _is_postgres(db):
        stmt = (
            text(
                "SELECT id FROM kb_articles "
                "WHERE published = true AND search_tsv @@ plainto_tsquery('english', :q) "
                "ORDER BY ts_rank(search_tsv, plainto_tsquery('english', :q)) DESC "
                "LIMIT :limit"
            )
            .bindparams(q=q, limit=limit)
        )
        ids = [row[0] for row in db.execute(stmt)]
        return db.query(KBArticle).filter(KBArticle.id.in_(ids)).all() if ids else []
    needle = f"%{q}%"
    return list(
        db.query(KBArticle)
        .filter(KBArticle.published.is_(True))
        .filter(or_(KBArticle.title.ilike(needle), KBArticle.body.ilike(needle)))
        .limit(limit)
    )
