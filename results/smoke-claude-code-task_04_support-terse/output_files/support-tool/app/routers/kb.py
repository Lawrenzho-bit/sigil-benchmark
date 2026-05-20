from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app import schemas
from app.auth import current_admin, current_user
from app.db import get_db
from app.models import KBArticle, User
from app.search import search_kb


router = APIRouter(prefix="/kb", tags=["kb"])


@router.get("/search", response_model=list[schemas.KBArticleOut])
def search(q: str = Query(min_length=1), db: Session = Depends(get_db),
           _: User = Depends(current_user)):
    return search_kb(db, q)


@router.get("/articles", response_model=list[schemas.KBArticleOut])
def list_articles(
    db: Session = Depends(get_db),
    _: User = Depends(current_user),
    published_only: bool = True,
    limit: int = Query(50, le=200),
    offset: int = 0,
):
    q = db.query(KBArticle)
    if published_only:
        q = q.filter(KBArticle.published.is_(True))
    return q.order_by(KBArticle.title).limit(limit).offset(offset).all()


@router.get("/articles/{slug}", response_model=schemas.KBArticleOut)
def get_article(slug: str, db: Session = Depends(get_db), _: User = Depends(current_user)):
    article = db.query(KBArticle).filter(KBArticle.slug == slug).first()
    if not article:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "article not found")
    return article


@router.post("/articles", response_model=schemas.KBArticleOut,
             status_code=status.HTTP_201_CREATED)
def create_article(
    payload: schemas.KBArticleIn,
    db: Session = Depends(get_db),
    _: User = Depends(current_admin),
):
    if db.query(KBArticle).filter(KBArticle.slug == payload.slug).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "slug already exists")
    article = KBArticle(**payload.model_dump())
    db.add(article)
    db.commit()
    db.refresh(article)
    return article


@router.put("/articles/{slug}", response_model=schemas.KBArticleOut)
def update_article(
    slug: str,
    payload: schemas.KBArticleIn,
    db: Session = Depends(get_db),
    _: User = Depends(current_admin),
):
    article = db.query(KBArticle).filter(KBArticle.slug == slug).first()
    if not article:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "article not found")
    for field, value in payload.model_dump().items():
        setattr(article, field, value)
    db.commit()
    db.refresh(article)
    return article
