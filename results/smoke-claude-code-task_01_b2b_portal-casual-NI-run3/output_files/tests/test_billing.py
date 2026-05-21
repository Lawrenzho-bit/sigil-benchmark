"""Billing tests: webhook signature verification and plan mapping."""

from __future__ import annotations

import hashlib
import hmac
import json
import time

from app.models.enums import Plan, SubscriptionStatus
from app.services import stripe_service


def _sign(payload: str, secret: str) -> str:
    """Build a Stripe-format signature header for a payload."""
    ts = int(time.time())
    signed = f"{ts}.{payload}".encode()
    signature = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return f"t={ts},v1={signature}"


def test_webhook_rejects_bad_signature(client):
    resp = client.post(
        "/webhooks/stripe",
        content=json.dumps({"type": "customer.subscription.updated"}),
        headers={"stripe-signature": "t=1,v1=deadbeef"},
    )
    assert resp.status_code == 400


def test_webhook_accepts_valid_signature(client):
    """A correctly-signed event for an unknown customer is a safe no-op (200)."""
    payload = json.dumps(
        {
            "id": "evt_test",
            "type": "customer.subscription.updated",
            "data": {"object": {"id": "sub_x", "customer": "cus_unknown", "status": "active"}},
        }
    )
    header = _sign(payload, "whsec_testsecret")
    resp = client.post(
        "/webhooks/stripe",
        content=payload,
        headers={"stripe-signature": header, "content-type": "application/json"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"received": True}


def test_status_mapping():
    assert stripe_service.map_status("active") is SubscriptionStatus.ACTIVE
    assert stripe_service.map_status("past_due") is SubscriptionStatus.PAST_DUE
    assert stripe_service.map_status("canceled") is SubscriptionStatus.CANCELED
    assert stripe_service.map_status("something_new") is SubscriptionStatus.INCOMPLETE


def test_plan_lookup_by_price():
    # No STRIPE_PRICE_* values are configured in the test environment, so the
    # price map is empty and any lookup returns None.
    assert stripe_service.plan_for_price("price_missing") is None
    assert stripe_service.is_configured() is False


def test_billing_not_configured_blocks_checkout():
    import pytest

    with pytest.raises(stripe_service.BillingNotConfigured):
        stripe_service.price_id_for(Plan.PRO)
