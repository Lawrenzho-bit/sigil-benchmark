def test_login_succeeds(client, users):
    r = client.post("/auth/login", json={"email": users["customer"].email, "password": "pw"})
    assert r.status_code == 200
    assert r.json()["token_type"] == "bearer"


def test_login_wrong_password(client, users):
    r = client.post("/auth/login", json={"email": users["customer"].email, "password": "WRONG"})
    assert r.status_code == 401


def test_customer_cannot_hit_agent_routes(client, auth_headers):
    r = client.get("/agent/tickets", headers=auth_headers["customer"])
    assert r.status_code == 403


def test_agent_cannot_create_users(client, auth_headers):
    """Only admin can mint accounts."""
    r = client.post("/auth/users",
                    headers=auth_headers["agent"],
                    json={"email": "x@y.z", "name": "x", "password": "p", "role": "agent"})
    assert r.status_code == 403


def test_admin_can_create_users(client, auth_headers):
    r = client.post("/auth/users",
                    headers=auth_headers["admin"],
                    json={"email": "newagent@example.com", "name": "N", "password": "pw", "role": "agent"})
    assert r.status_code == 201
    assert r.json()["role"] == "agent"


def test_self_register_forces_customer_role(client):
    r = client.post("/auth/register",
                    json={"email": "self@example.com", "name": "Self", "password": "pw", "role": "admin"})
    assert r.status_code == 201
    assert r.json()["role"] == "customer"


def test_unauthenticated_rejected(client):
    assert client.get("/agent/tickets").status_code == 401
    assert client.get("/customer/tickets").status_code == 401
