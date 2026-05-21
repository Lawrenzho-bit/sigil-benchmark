from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.article import Article, ArticleStatus
from app.models.user import User, UserRole
from app.schemas.kb import ArticleCreate, ArticleOut
from app.services import search
from app.services.auth import current_user, require_role

router = APIRouter()


@router.get("/search", response_model=list[ArticleOut])
def search_articles(
    q: str = Query(min_length=1),
    db: Session = Depends(get_db),
    include_drafts: bool = False,
    _user: User = Depends(current_user),
):
    results = search.search_kb(db, q, include_drafts=include_drafts)
    return [ArticleOut.model_validate(a) for a in results]


@router.get("/{slug}", response_model=ArticleOut)
def get(slug: str, db: Session = Depends(get_db)):
    from sqlalchemy import select

    a = db.execute(select(Article).where(Article.slug == slug)).scalar_one_or_none()
    if not a or a.status != ArticleStatus.PUBLISHED:
        raise HTTPException(404, "not_found")
    a.view_count += 1
    db.commit()
    return ArticleOut.model_validate(a)


@router.post("", response_model=ArticleOut, status_code=201)
def create(
    payload: ArticleCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_role(UserRole.AGENT, UserRole.ADMIN, UserRole.SUPERVISOR)),
):
    a = Article(
        slug=payload.slug.lower(),
        title=payload.title,
        body_markdown=payload.body_markdown,
        category=payload.category,
        status=payload.status,
        author_id=user.id,
    )
    if payload.status == ArticleStatus.PUBLISHED:
        from datetime import datetime, timezone

        a.published_at = datetime.now(timezone.utc)
    db.add(a)
    db.commit()
    db.refresh(a)
    return ArticleOut.model_validate(a)


@router.post("/{article_id}/feedback")
def feedback(article_id: UUID, helpful: bool, db: Session = Depends(get_db)):
    a = db.get(Article, article_id)
    if not a:
        raise HTTPException(404, "not_found")
    if helpful:
        a.helpful_count += 1
    else:
        a.not_helpful_count += 1
    db.commit()
    return {"ok": True}
