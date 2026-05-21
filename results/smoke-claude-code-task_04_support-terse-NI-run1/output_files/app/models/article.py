import enum
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, Enum, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class ArticleStatus(str, enum.Enum):
    DRAFT = "draft"
    PUBLISHED = "published"
    ARCHIVED = "archived"


class Article(Base):
    __tablename__ = "kb_articles"
    __table_args__ = (
        Index("ix_kb_articles_search", "search_vector", postgresql_using="gin"),
        Index("ix_kb_articles_slug", "slug", unique=True),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    slug: Mapped[str] = mapped_column(String(200))
    title: Mapped[str] = mapped_column(String(500))
    body_markdown: Mapped[str] = mapped_column(Text)
    category: Mapped[str | None] = mapped_column(String(120), index=True)
    status: Mapped[ArticleStatus] = mapped_column(Enum(ArticleStatus), default=ArticleStatus.DRAFT)
    author_id: Mapped[UUID | None] = mapped_column(ForeignKey("users.id"))
    view_count: Mapped[int] = mapped_column(Integer, default=0)
    helpful_count: Mapped[int] = mapped_column(Integer, default=0)
    not_helpful_count: Mapped[int] = mapped_column(Integer, default=0)
    metadata_: Mapped[dict] = mapped_column("metadata", JSONB, default=dict)
    search_vector: Mapped[str | None] = mapped_column(TSVECTOR)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
