"""Invitation lifecycle and seat-limit tests."""

from __future__ import annotations

from app.models.enums import Plan, Role
from app.models.membership import Membership
from app.models.user import User
from app.services import invitations as invite_service
from tests.conftest import add_member, create_org_with_owner, csrf_token, login


def test_new_user_accepts_invitation(client, db):
    owner, org = create_org_with_owner(db)
    invitation, raw_token = invite_service.create_invitation(
        db,
        organization_id=org.id,
        email="newbie@acme.example",
        role=Role.ADMIN,
        invited_by_id=owner.id,
    )

    # The acceptance page renders for a valid token.
    page = client.get(f"/invite/accept?token={raw_token}")
    assert page.status_code == 200

    token = csrf_token(client, f"/invite/accept?token={raw_token}")
    resp = client.post(
        "/invite/accept",
        data={
            "csrf_token": token,
            "token": raw_token,
            "full_name": "New Bie",
            "password": "newbie-password",
        },
        follow_redirects=False,
    )
    assert resp.status_code == 303

    user = db.query(User).filter_by(email="newbie@acme.example").one()
    membership = db.query(Membership).filter_by(user_id=user.id).one()
    assert membership.role is Role.ADMIN


def test_invalid_token_shows_invalid_page(client):
    resp = client.get("/invite/accept?token=garbage")
    assert resp.status_code == 400
    assert "unavailable" in resp.text.lower()


def test_invitation_cannot_be_accepted_twice(client, db):
    owner, org = create_org_with_owner(db)
    invitation, raw_token = invite_service.create_invitation(
        db,
        organization_id=org.id,
        email="once@acme.example",
        role=Role.VIEWER,
        invited_by_id=owner.id,
    )
    user = User(email="once@acme.example", full_name="Once")
    db.add(user)
    db.flush()
    invite_service.accept(db, invitation, user)

    # The token is now consumed.
    assert invite_service.find_pending(db, raw_token) is None


def test_seat_limit_blocks_invites_beyond_plan(client, db):
    """Starter plan allows 3 seats; the owner plus members + invites are counted."""
    owner, org = create_org_with_owner(db)
    assert org.plan is Plan.STARTER
    add_member(db, org, email="m1@acme.example", role=Role.VIEWER)
    add_member(db, org, email="m2@acme.example", role=Role.VIEWER)
    # Org now has 3 members (owner + 2) — every seat used.

    login(client, owner.email, "ownerpass123")
    token = csrf_token(client, "/team")
    resp = client.post(
        "/team/invite",
        data={"csrf_token": token, "email": "m3@acme.example", "role": "viewer"},
        follow_redirects=True,
    )
    assert "every seat" in resp.text.lower() or "upgrade" in resp.text.lower()
    # No invitation was created.
    from app.models.invitation import Invitation

    assert db.query(Invitation).count() == 0
