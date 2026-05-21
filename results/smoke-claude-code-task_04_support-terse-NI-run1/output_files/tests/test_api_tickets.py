def test_create_and_list_ticket_via_api(client, auth_headers):
    r = client.post(
        "/api/tickets",
        headers=auth_headers,
        json={
            "subject": "API test",
            "body": "I tried but it broke",
            "customer_email": "api@example.com",
        },
    )
    assert r.status_code == 201, r.text
    data = r.json()
    assert data["subject"] == "API test"
    ticket_id = data["id"]

    r = client.get("/api/tickets", headers=auth_headers)
    assert r.status_code == 200
    assert any(t["id"] == ticket_id for t in r.json()["items"])


def test_unauthenticated_request_rejected(client):
    r = client.get("/api/tickets")
    assert r.status_code == 401


def test_healthz(client):
    assert client.get("/healthz").json() == {"status": "ok"}
