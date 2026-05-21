"""Idempotent seeder for local development."""

from sqlalchemy import select

from app.db import SessionLocal
from app.models.article import Article, ArticleStatus
from app.models.macro import Macro
from app.models.sla import SLAPolicy
from app.models.user import User, UserRole
from app.services.auth import hash_password


def main() -> None:
    db = SessionLocal()
    try:
        # Admin user
        admin = db.execute(select(User).where(User.email == "admin@example.com")).scalar_one_or_none()
        if not admin:
            db.add(
                User(
                    email="admin@example.com",
                    name="Admin",
                    password_hash=hash_password("admin"),
                    role=UserRole.ADMIN,
                )
            )

        agent = db.execute(select(User).where(User.email == "agent@example.com")).scalar_one_or_none()
        if not agent:
            db.add(
                User(
                    email="agent@example.com",
                    name="Agent Alice",
                    password_hash=hash_password("agent"),
                    role=UserRole.AGENT,
                )
            )

        # Default SLA policy
        if not db.execute(select(SLAPolicy).where(SLAPolicy.is_default.is_(True))).scalar_one_or_none():
            db.add(
                SLAPolicy(
                    name="Default",
                    is_default=True,
                    targets={
                        "urgent": {"first_response_min": 15, "resolution_min": 240},
                        "high": {"first_response_min": 30, "resolution_min": 480},
                        "normal": {"first_response_min": 60, "resolution_min": 1440},
                        "low": {"first_response_min": 240, "resolution_min": 4320},
                    },
                )
            )

        # Seed macros
        if not db.execute(select(Macro).where(Macro.name == "Acknowledge")).scalar_one_or_none():
            db.add(
                Macro(
                    name="Acknowledge",
                    body="Thanks for reaching out — we're looking into this and will follow up shortly.",
                    actions={"set_status": "open"},
                    visibility="global",
                )
            )

        # Seed a KB article
        if not db.execute(select(Article).where(Article.slug == "password-reset")).scalar_one_or_none():
            db.add(
                Article(
                    slug="password-reset",
                    title="How to reset your password",
                    body_markdown="Visit /account → Reset password.\n\nWe'll email you a link valid for 1 hour.",
                    category="account",
                    status=ArticleStatus.PUBLISHED,
                )
            )

        db.commit()
        print("seed complete")
    finally:
        db.close()


if __name__ == "__main__":
    main()
