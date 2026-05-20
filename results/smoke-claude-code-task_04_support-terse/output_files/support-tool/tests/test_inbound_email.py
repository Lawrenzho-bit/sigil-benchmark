def _inbound(client, body, secret="test-inbound-secret"):
    return client.post("/inbound/email", json=body,
                       headers={"X-Inbound-Secret": secret})


def test_inbound_creates_ticket_and_user(client, db):
    from app.models import Ticket, User
    r = _inbound(client, {
        "from_email": "newperson@example.com",
        "from_name": "New Person",
        "subject": "Help me",
        "text_body": "I have a problem",
    })
    assert r.status_code == 200
    t = r.json()
    assert t["channel"] == "email"
    user = db.query(User).filter(User.email == "newperson@example.com").first()
    assert user is not None and user.role == "customer"
    db_ticket = db.get(Ticket, t["id"])
    assert db_ticket.sla is not None  # SLA initialized


def test_inbound_threads_into_existing_ticket(client, auth_headers, db):
    from app.models import Comment, Ticket
    t = client.post("/customer/tickets", headers=auth_headers["customer"],
                    json={"subject": "first ticket"}).json()
    cust_email = "cust@example.com"
    r = _inbound(client, {
        "from_email": cust_email,
        "subject": "Re: first ticket",
        "text_body": "follow up from email",
        "in_reply_to_public_id": t["public_id"],
    })
    assert r.status_code == 200
    db.expire_all()
    ticket = db.get(Ticket, t["id"])
    bodies = [c.body for c in ticket.comments]
    assert "follow up from email" in bodies
    # Comment is marked as from_email=True
    follow_up = next(c for c in ticket.comments if c.body == "follow up from email")
    assert follow_up.from_email is True


def test_inbound_rejects_bad_secret(client):
    r = _inbound(client, {
        "from_email": "x@y.z", "subject": "s", "text_body": "b",
    }, secret="WRONG")
    assert r.status_code == 401


def test_inbound_with_mismatched_requester_starts_new_ticket(client, auth_headers, db):
    """If someone tries to reply to a thread that's not theirs, we don't leak the thread."""
    from app.models import Ticket
    t = client.post("/customer/tickets", headers=auth_headers["customer"],
                    json={"subject": "private thread"}).json()
    r = _inbound(client, {
        "from_email": "stranger@example.com",
        "subject": "Re: private thread",
        "text_body": "hijack attempt",
        "in_reply_to_public_id": t["public_id"],
    })
    assert r.status_code == 200
    new_ticket = r.json()
    assert new_ticket["id"] != t["id"]
    assert new_ticket["public_id"] != t["public_id"]
