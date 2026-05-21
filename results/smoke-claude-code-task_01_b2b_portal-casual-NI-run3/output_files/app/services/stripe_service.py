"""Stripe billing integration.

Design notes:
  * Stripe is the source of truth for money and subscription state. The local
    `Subscription` row is a projection updated by webhooks (see routers/webhooks).
  * Checkout and the Customer Portal are Stripe-hosted, so card data never
    touches this server (PCI scope stays minimal).
  * Every webhook is signature-verified before it is trusted.
  * If `STRIPE_SECRET_KEY` is unset the module runs in a degraded "unconfigured"
    mode so the rest of the app still boots in local development.
"""

from __future__ import annotations

import logging

import stripe

from app.config import settings
from app.models.enums import Plan, SubscriptionStatus

logger = logging.getLogger("acme.stripe")

stripe.api_key = settings.stripe_secret_key or None


class BillingNotConfigured(Exception):
    """Raised when a billing action is attempted without Stripe configured."""


def is_configured() -> bool:
    return bool(settings.stripe_secret_key and settings.stripe_price_map)


def _require_configured() -> None:
    if not is_configured():
        raise BillingNotConfigured(
            "Billing is not configured. Set STRIPE_SECRET_KEY and the price IDs."
        )


def price_id_for(plan: Plan) -> str:
    price = settings.stripe_price_map.get(plan.value)
    if not price:
        raise BillingNotConfigured(f"No Stripe price configured for plan '{plan.value}'.")
    return price


def plan_for_price(price_id: str) -> Plan | None:
    for code, pid in settings.stripe_price_map.items():
        if pid == price_id:
            return Plan(code)
    return None


def ensure_customer(org_name: str, org_id: str, existing_customer_id: str | None) -> str:
    """Return a Stripe customer id, creating one for the org if needed."""
    _require_configured()
    if existing_customer_id:
        return existing_customer_id
    customer = stripe.Customer.create(
        name=org_name,
        metadata={"organization_id": org_id},
    )
    return customer.id


def create_checkout_session(
    *,
    customer_id: str,
    plan: Plan,
    organization_id: str,
    success_url: str,
    cancel_url: str,
) -> str:
    """Start a Checkout session for a new subscription. Returns the redirect URL."""
    _require_configured()
    session = stripe.checkout.Session.create(
        mode="subscription",
        customer=customer_id,
        line_items=[{"price": price_id_for(plan), "quantity": 1}],
        success_url=success_url,
        cancel_url=cancel_url,
        client_reference_id=organization_id,
        metadata={"organization_id": organization_id, "plan": plan.value},
        allow_promotion_codes=True,
    )
    return session.url


def change_plan(stripe_subscription_id: str, new_plan: Plan) -> None:
    """Upgrade or downgrade an existing subscription in place.

    Proration is left to Stripe's default (credit/charge the difference). The
    resulting `customer.subscription.updated` webhook syncs our local row.
    """
    _require_configured()
    sub = stripe.Subscription.retrieve(stripe_subscription_id)
    item_id = sub["items"]["data"][0]["id"]
    stripe.Subscription.modify(
        stripe_subscription_id,
        items=[{"id": item_id, "price": price_id_for(new_plan)}],
        proration_behavior="create_prorations",
        metadata={"plan": new_plan.value},
    )


def create_portal_session(customer_id: str, return_url: str) -> str:
    """Open the Stripe-hosted Customer Portal (manage card, invoices, cancel)."""
    _require_configured()
    session = stripe.billing_portal.Session.create(
        customer=customer_id,
        return_url=return_url,
    )
    return session.url


def verify_webhook(payload: bytes, signature: str | None) -> stripe.Event:
    """Verify a webhook signature and return the parsed event.

    Raises stripe.error.SignatureVerificationError / ValueError on tampering.
    """
    if not settings.stripe_webhook_secret:
        raise BillingNotConfigured("STRIPE_WEBHOOK_SECRET is not set.")
    return stripe.Webhook.construct_event(payload, signature, settings.stripe_webhook_secret)


# --- Mapping helpers -------------------------------------------------------
_STATUS_MAP: dict[str, SubscriptionStatus] = {
    "trialing": SubscriptionStatus.TRIALING,
    "active": SubscriptionStatus.ACTIVE,
    "past_due": SubscriptionStatus.PAST_DUE,
    "unpaid": SubscriptionStatus.PAST_DUE,
    "canceled": SubscriptionStatus.CANCELED,
    "incomplete": SubscriptionStatus.INCOMPLETE,
    "incomplete_expired": SubscriptionStatus.CANCELED,
}


def map_status(stripe_status: str) -> SubscriptionStatus:
    return _STATUS_MAP.get(stripe_status, SubscriptionStatus.INCOMPLETE)
