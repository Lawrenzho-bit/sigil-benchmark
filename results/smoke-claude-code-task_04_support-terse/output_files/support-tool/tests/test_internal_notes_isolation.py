"""These tests guard the most security-sensitive invariant in the system:
internal agent notes must never reach customers, on any endpoint, by any means.
"""


def _create_ticket(client, headers):
    r = client.post("/customer/tickets", headers=headers,
                    json={"subject": "S", "description": "D"})
    return r.json()


def test_customer_get_strips_internal_comments(client, auth_headers):
    t = _create_ticket(client, auth_headers["customer"])
    # Agent posts one public and one internal comment.
    client.post(f"/agent/tickets/{t['id']}/comments",
                headers=auth_headers["agent"],
                json={"body": "PUBLIC_VISIBLE", "visibility": "public"})
    client.post(f"/agent/tickets/{t['id']}/comments",
                headers=auth_headers["agent"],
                json={"body": "INTERNAL_SECRET", "visibility": "internal"})

    r = client.get(f"/customer/tickets/{t['public_id']}",
                   headers=auth_headers["customer"])
    assert r.status_code == 200
    body = r.json()
    assert len(body["comments"]) == 1
    assert body["comments"][0]["body"] == "PUBLIC_VISIBLE"
    # The serialized response must not contain the internal body anywhere.
    assert "INTERNAL_SECRET" not in r.text


def test_customer_cannot_post_internal_comment(client, auth_headers):
    """Even if a customer sends visibility=internal in the payload, the customer
    endpoint schema doesn't accept that field — so the value is dropped and the
    server forces public. Belt-and-braces."""
    t = _create_ticket(client, auth_headers["customer"])
    r = client.post(f"/customer/tickets/{t['public_id']}/comments",
                    headers=auth_headers["customer"],
                    json={"body": "trying to be sneaky", "visibility": "internal"})
    assert r.status_code == 201
    assert r.json()["visibility"] == "public"


def test_agent_sees_internal_comments(client, auth_headers):
    t = _create_ticket(client, auth_headers["customer"])
    client.post(f"/agent/tickets/{t['id']}/comments",
                headers=auth_headers["agent"],
                json={"body": "INTERNAL_SECRET", "visibility": "internal"})
    r = client.get(f"/agent/tickets/{t['id']}", headers=auth_headers["agent"])
    bodies = [c["body"] for c in r.json()["comments"]]
    assert "INTERNAL_SECRET" in bodies
