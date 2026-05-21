"""Search adapter. Default backend: Postgres FTS via tsvector columns."""

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models.article import Article, ArticleStatus
from app.models.ticket import Ticket


def search_tickets(db: Session, q: str, limit: int = 20) -> list[Ticket]:
    if not q.strip():
        return []
    stmt = (
        select(Ticket)
        .where(text("tickets.search_vector @@ websearch_to_tsquery('english', :q)"))
        .order_by(text("ts_rank(tickets.search_vector, websearch_to_tsquery('english', :q)) DESC"))
        .limit(limit)
        .params(q=q)
    )
    return db.execute(stmt).scalars().all()


def search_kb(db: Session, q: str, *, limit: int = 20, include_drafts: bool = False) -> list[Article]:
    if not q.strip():
        return []
    stmt = select(Article).where(
        text("kb_articles.search_vector @@ websearch_to_tsquery('english', :q)")
    )
    if not include_drafts:
        stmt = stmt.where(Article.status == ArticleStatus.PUBLISHED)
    stmt = stmt.order_by(
        text("ts_rank(kb_articles.search_vector, websearch_to_tsquery('english', :q)) DESC")
    ).limit(limit).params(q=q)
    return db.execute(stmt).scalars().all()
