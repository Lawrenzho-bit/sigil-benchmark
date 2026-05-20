from app.models import AuditEvent, Comment, Ticket, TicketStatus


def test_login_emits_audit(client, users, db):
    client.post("/auth/login", json={"email": users["customer"].email, "password": "pw"})
    rows = db.query(AuditEvent).filter(AuditEvent.action == "auth.login").all()
    assert len(rows) == 1
    assert rows[0].actor_id == users["customer"].id


def test_failed_login_emits_audit(client, users, db):
    client.post("/auth/login", json={"email": users["customer"].email, "password": "WRONG"})
    rows = db.query(AuditEvent).filter(AuditEvent.action == "auth.login_failed").all()
    assert len(rows) == 1
    # No actor on failed login — we don't know who they claim to be is who they are.
    assert rows[0].actor_id is None


def test_ticket_update_audited_with_diff(client, auth_headers, db):
    t = client.post("/customer/tickets", headers=auth_headers["customer"],
                    json={"subject": "S", "priority": "low"}).json()
    client.patch(f"/agent/tickets/{t['id']}",
                 headers=auth_headers["agent"],
                 json={"priority": "urgent"})
    rows = db.query(AuditEvent).filter(
        AuditEvent.action == "ticket.update",
        AuditEvent.entity_id == str(t["id"]),
    ).all()
    assert len(rows) == 1
    assert rows[0].payload["priority"] == ["low", "urgent"]


def test_merge_moves_comments_and_marks_source(client, auth_headers, db):
    a = client.post("/customer/tickets", headers=auth_headers["customer"],
                    json={"subject": "dup A"}).json()
    b = client.post("/customer/tickets", headers=auth_headers["customer"],
                    json={"subject": "dup B"}).json()
    client.post(f"/agent/tickets/{a['id']}/comments",
                headers=auth_headers["agent"],
                json={"body": "A-note", "visibility": "internal"})

    r = client.post("/agent/tickets/merge",
                    headers=auth_headers["agent"],
                    json={"source_ticket_id": a["id"], "target_ticket_id": b["id"]})
    assert r.status_code == 200

    src = db.get(Ticket, a["id"])
    tgt = db.get(Ticket, b["id"])
    assert src.status == TicketStatus.merged.value
    assert src.merged_into_id == tgt.id
    # Comment now hangs off target.
    notes = db.query(Comment).filter(Comment.ticket_id == tgt.id).all()
    assert any(c.body == "A-note" for c in notes)


def test_cannot_merge_ticket_into_itself(client, auth_headers):
    t = client.post("/customer/tickets", headers=auth_headers["customer"],
                    json={"subject": "x"}).json()
    r = client.post("/agent/tickets/merge",
                    headers=auth_headers["agent"],
                    json={"source_ticket_id": t["id"], "target_ticket_id": t["id"]})
    assert r.status_code == 400


def test_gdpr_anonymize(client, auth_headers, users, db):
    from app.models import User
    cid = users["customer"].id
    r = client.post(f"/agent/customers/{cid}/anonymize",
                    headers=auth_headers["admin"])
    assert r.status_code == 204
    db.expire_all()  # API committed via a separate session; refresh our view
    u = db.get(User, cid)
    assert u.is_anonymized is True
    assert u.email.startswith("anonymized+")
    assert u.hashed_password is None
