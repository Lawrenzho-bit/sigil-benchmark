"""First-run seed.

Idempotent: run on every container boot (see scripts/entrypoint.sh). It creates
an initial organization + owner only when SEED_OWNER_EMAIL/PASSWORD are set and
that account does not already exist. Safe to run repeatedly.
"""

from __future__ import annotations

import logging

from sqlalchemy import select

from app.config import settings
from app.database import SessionLocal
from app.models.enums import Plan, Role
from app.models.membership import Membership
from app.models.organization import Organization
from app.models.user import User
from app.security import hash_password
from app.services.auth import slugify_unique

logger = logging.getLogger("acme.seed")


def run() -> None:
    if not (settings.seed_owner_email and settings.seed_owner_password):
        logger.info("Seed skipped: SEED_OWNER_EMAIL/PASSWORD not set.")
        return

    email = settings.seed_owner_email.strip().lower()
    db = SessionLocal()
    try:
        if db.scalar(select(User).where(User.email == email)) is not None:
            logger.info("Seed skipped: owner %s already exists.", email)
            return

        org = Organization(
            name=settings.seed_org_name,
            slug=slugify_unique(db, settings.seed_org_name),
            plan=Plan.STARTER,
        )
        user = User(
            email=email,
            full_name="Account Owner",
            password_hash=hash_password(settings.seed_owner_password),
        )
        db.add_all([org, user])
        db.flush()
        db.add(Membership(user_id=user.id, organization_id=org.id, role=Role.OWNER))
        db.commit()
        logger.info("Seed complete: created organization '%s' and owner %s.", org.name, email)
    finally:
        db.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
