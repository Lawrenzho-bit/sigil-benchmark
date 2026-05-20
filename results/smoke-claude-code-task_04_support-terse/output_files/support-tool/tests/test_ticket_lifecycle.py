def _create_ticket(client, headers, subject="Help"):
    r = client.post("/customer/tickets", headers=headers,
                    json={"subject": subject, "description": "needs help", "priority": "high"})
    assert r.status_code == 201, r.text
    return r.json()


def test_customer_creates_and_lists_own_ticket(client, auth_headers):
    t = _create_ticket(client, auth_headers["customer"])
    assert t["status"] == "new"
    assert t["priority"] == "high"
    assert t["public_id"].startswith("TKT-")

    r = client.get("/customer/tickets", headers=auth_headers["customer"])
    assert r.status_code == 200
    assert len(r.json()) == 1


def test_customer_cannot_see_other_customers_tickets(client, auth_headers):
    t = _create_ticket(client, auth_headers["customer"])
    r = client.get(f"/customer/tickets/{t['public_id']}", headers=auth_headers["customer2"])
    assert r.status_code == 404  # never confirm existence cross-tenant


def test_agent_public_reply_sets_first_response_and_opens_ticket(client, auth_headers):
    t = _create_ticket(client, auth_headers["customer"])
    r = client.post(f"/agent/tickets/{t['id']}/comments",
                    headers=auth_headers["agent"],
                    json={"body": "thanks for reaching out", "visibility": "public"})
    assert r.status_code == 201

    r = client.get(f"/agent/tickets/{t['id']}", headers=auth_headers["agent"])
    ticket = r.json()
    assert ticket["status"] == "open"
    assert ticket["first_responded_at"] is not None


def test_internal_note_does_not_set_first_response(client, auth_headers):
    t = _create_ticket(client, auth_headers["customer"])
    client.post(f"/agent/tickets/{t['id']}/comments",
                headers=auth_headers["agent"],
                json={"body": "fyi this customer is on the enterprise plan", "visibility": "internal"})
    r = client.get(f"/agent/tickets/{t['id']}", headers=auth_headers["agent"])
    assert r.json()["first_responded_at"] is None


def test_resolving_creates_csat_survey(client, auth_headers, db):
    from app.models import CSATSurvey, Ticket
    t = _create_ticket(client, auth_headers["customer"])
    client.patch(f"/agent/tickets/{t['id']}",
                 headers=auth_headers["agent"], json={"status": "resolved"})
    assert db.query(CSATSurvey).join(Ticket).filter(Ticket.id == t["id"]).count() == 1


def test_assigning_to_non_agent_rejected(client, auth_headers, users):
    t = _create_ticket(client, auth_headers["customer"])
    r = client.patch(f"/agent/tickets/{t['id']}",
                     headers=auth_headers["agent"],
                     json={"assignee_id": users["customer"].id})
    assert r.status_code == 400


def test_agent_inbox_filters(client, auth_headers, users):
    a = _create_ticket(client, auth_headers["customer"], subject="A")
    b = _create_ticket(client, auth_headers["customer"], subject="B")
    # assign A to the agent
    client.patch(f"/agent/tickets/{a['id']}",
                 headers=auth_headers["agent"],
                 json={"assignee_id": users["agent"].id})
    r = client.get(f"/agent/tickets?assignee_id={users['agent'].id}",
                   headers=auth_headers["agent"])
    ids = {t["id"] for t in r.json()}
    assert a["id"] in ids and b["id"] not in ids

    r = client.get("/agent/tickets?unassigned=true", headers=auth_headers["agent"])
    ids = {t["id"] for t in r.json()}
    assert b["id"] in ids and a["id"] not in ids
