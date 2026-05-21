"""Role-based access control tests."""

from __future__ import annotations

from app.models.enums import Role
from tests.conftest import add_member, create_org_with_owner, csrf_token, login


def test_role_hierarchy():
    assert Role.OWNER.can_act_as(Role.ADMIN)
    assert Role.OWNER.can_act_as(Role.VIEWER)
    assert Role.ADMIN.can_act_as(Role.VIEWER)
    assert not Role.VIEWER.can_act_as(Role.ADMIN)
    assert not Role.ADMIN.can_act_as(Role.OWNER)


def test_viewer_can_see_team_but_not_audit(client, db):
    _, org = create_org_with_owner(db)
    add_member(db, org, email="viewer@acme.example", role=Role.VIEWER)
    login(client, "viewer@acme.example", "memberpass123")

    assert client.get("/team").status_code == 200  # viewers may look
    assert client.get("/audit").status_code == 403  # but not the audit log


def test_viewer_cannot_invite(client, db):
    _, org = create_org_with_owner(db)
    add_member(db, org, email="viewer@acme.example", role=Role.VIEWER)
    login(client, "viewer@acme.example", "memberpass123")

    token = csrf_token(client, "/team")
    resp = client.post(
        "/team/invite",
        data={"csrf_token": token, "email": "x@acme.example", "role": "viewer"},
    )
    assert resp.status_code == 403


def test_admin_can_view_audit_but_not_billing(client, db):
    _, org = create_org_with_owner(db)
    add_member(db, org, email="admin@acme.example", role=Role.ADMIN)
    login(client, "admin@acme.example", "memberpass123")

    assert client.get("/audit").status_code == 200
    assert client.get("/billing").status_code == 403  # billing is owner-only


def test_owner_can_access_billing(client, db):
    create_org_with_owner(db, email="owner@acme.example", password="ownerpass123")
    login(client, "owner@acme.example", "ownerpass123")
    assert client.get("/billing").status_code == 200


def test_unauthenticated_dashboard_redirects_to_login(client):
    resp = client.get("/dashboard", follow_redirects=False)
    assert resp.status_code == 307
    assert "/auth/login" in resp.headers["location"]


def test_cannot_remove_last_owner(client, db):
    owner, org = create_org_with_owner(db, email="owner@acme.example", password="ownerpass123")
    from app.models.membership import Membership

    membership = db.query(Membership).filter_by(user_id=owner.id, organization_id=org.id).one()
    login(client, "owner@acme.example", "ownerpass123")
    token = csrf_token(client, "/team")
    # Owners cannot remove themselves, and there is no other owner anyway.
    resp = client.post(f"/team/{membership.id}/remove", data={"csrf_token": token})
    assert resp.status_code == 200
    assert "remove yourself" in resp.text.lower()


def test_admin_cannot_change_an_owner_role(client, db):
    owner, org = create_org_with_owner(db, email="owner@acme.example")
    add_member(db, org, email="admin@acme.example", role=Role.ADMIN)
    from app.models.membership import Membership

    owner_membership = (
        db.query(Membership).filter_by(user_id=owner.id, organization_id=org.id).one()
    )
    login(client, "admin@acme.example", "memberpass123")
    token = csrf_token(client, "/team")
    resp = client.post(
        f"/team/{owner_membership.id}/role",
        data={"csrf_token": token, "role": "viewer"},
    )
    assert resp.status_code == 200
    assert "owner" in resp.text.lower()
    # The owner's role is unchanged.
    db.refresh(owner_membership)
    assert owner_membership.role is Role.OWNER


def test_tenant_isolation_cannot_touch_other_org_member(client, db):
    """An admin in org A cannot modify a membership belonging to org B."""
    _, org_a = create_org_with_owner(db, email="a-owner@acme.example", org_name="Org A")
    add_member(db, org_a, email="a-admin@acme.example", role=Role.ADMIN)

    _, org_b = create_org_with_owner(db, email="b-owner@acme.example", org_name="Org B")
    from app.models.membership import Membership

    b_owner_membership = db.query(Membership).filter_by(organization_id=org_b.id).first()

    login(client, "a-admin@acme.example", "memberpass123")
    token = csrf_token(client, "/team")
    resp = client.post(f"/team/{b_owner_membership.id}/remove", data={"csrf_token": token})
    # The router rejects it as "not found" — never acts cross-tenant.
    assert resp.status_code == 200
    assert "not found" in resp.text.lower()
