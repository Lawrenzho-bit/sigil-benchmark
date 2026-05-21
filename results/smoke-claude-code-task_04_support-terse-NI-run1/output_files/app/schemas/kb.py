from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.article import ArticleStatus


class ArticleCreate(BaseModel):
    slug: str = Field(min_length=1, max_length=200)
    title: str
    body_markdown: str
    category: str | None = None
    status: ArticleStatus = ArticleStatus.DRAFT


class ArticleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    slug: str
    title: str
    body_markdown: str
    category: str | None
    status: ArticleStatus
    view_count: int
    helpful_count: int
    not_helpful_count: int
    created_at: datetime
    updated_at: datetime
    published_at: datetime | None
