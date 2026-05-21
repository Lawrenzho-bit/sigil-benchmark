"""Stripe billing service.

Stripe is the source of truth for billing state; the local `subscriptions`
table is a cache kept in sync by `apply_webhook_event`. The Stripe SDK is
synchronous, so every call is dispatched to a worker thread to avoid blocking
the event loop.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime

import stripe
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.enums import AuditAction, Plan, SubscriptionStatus
from app.exceptions import BillingError, ConflictError, NotFoundError
from app.logging_config import get_logger
from app.models import Organization, Subscription, User
from app.services import audit_service, email_service

logger = get_logger(__name__)

stripe.api_key = settings.stripe_secret_key

# Reverse lookup: Stripe price id → our Plan enum.
_PRICE_TO_PLAN: dict[str, Plan] = {
    settings.stripe_price_ids[plan.value]: plan for plan in Plan
}


def _plan_for_price(price_id: str | None) -> Plan | None:
    return _PRICE_TO_PLAN.get(price_id) if price_id else None


def _status_from_stripe(raw: str) -> SubscriptionStatus:
    try:
        return SubscriptionStatus(raw)
    except ValueError:
        # Treat unknown/odd statuses (e.g. "unpaid") as past due.
        return SubscriptionStatus.PAST_DUE


# --------------------------------------------------------------------------
# Customer + subscription lookups
# --------------------------------------------------------------------------
async def get_subscription(db: AsyncSession, org_id: uuid.UUID) -> Subscription:
    sub = await db.scalar(
        select(Subscription).where(Subscription.organization_id == org_id)
    )
    if sub is None:
        raise NotFoundError("No subscription exists for this organization.")
    return sub


async def _ensure_customer(
    db: AsyncSession, org: Organization, billing_email: str
) -> str:
    """Return the org's Stripe customer id, creating the customer if needed."""
    if org.stripe_customer_id:
        return org.stripe_customer_id
    try:
        customer = await asyncio.to_thread(
            stripe.Customer.create,
            name=org.name,
            email=billing_email,
            metadata={"organization_id": str(org.id)},
        )
    except stripe.StripeError as exc:  # type: ignore[attr-defined]
        logger.error("stripe.customer_create_failed", error=str(exc))
        raise BillingError("Could not initialise billing. Please try again.") from exc

    org.stripe_customer_id = customer.id
    sub = await get_subscription(db, org.id)
    sub.stripe_customer_id = customer.id
    await db.flush()
    return customer.id


# --------------------------------------------------------------------------
# Checkout / portal / plan changes
# --------------------------------------------------------------------------
async def create_checkout_session(
    db: AsyncSession,
    *,
    org: Organization,
    actor: User,
    plan: Plan,
    success_url: str,
    cancel_url: str,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> str:
    """Start a Stripe Checkout session for `plan`; return the redirect URL."""
    customer_id = await _ensure_customer(db, org, actor.email)
    price_id = settings.stripe_price_ids[plan.value]
    try:
        checkout = await asyncio.to_thread(
            stripe.checkout.Session.create,
            mode="subscription",
            customer=customer_id,
            client_reference_id=str(org.id),
            line_items=[{"price": price_id, "quantity": 1}],
            success_url=success_url,
            cancel_url=cancel_url,
            allow_promotion_codes=True,
            subscription_data={"metadata": {"organization_id": str(org.id)}},
        )
    except stripe.StripeError as exc:  # type: ignore[attr-defined]
        logger.error("stripe.checkout_failed", error=str(exc))
        raise BillingError("Could not start checkout. Please try again.") from exc

    await audit_service.record(
        db,
        AuditAction.BILLING_CHECKOUT_STARTED,
        organization_id=org.id,
        actor_user_id=actor.id,
        actor_email=actor.email,
        ip_address=ip_address,
        user_agent=user_agent,
        meta={"plan": plan.value},
    )
    if not checkout.url:
        raise BillingError("Stripe did not return a checkout URL.")
    return checkout.url


async def create_portal_session(
    db: AsyncSession, *, org: Organization, actor: User, return_url: str
) -> str:
    """Create a Stripe Billing Portal session for managing payment details."""
    customer_id = await _ensure_customer(db, org, actor.email)
    try:
        portal = await asyncio.to_thread(
            stripe.billing_portal.Session.create,
            customer=customer_id,
            return_url=return_url,
        )
    except stripe.StripeError as exc:  # type: ignore[attr-defined]
        logger.error("stripe.portal_failed", error=str(exc))
        raise BillingError("Could not open the billing portal.") from exc
    return portal.url


async def change_plan(
    db: AsyncSession,
    *,
    org: Organization,
    actor: User,
    new_plan: Plan,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> Subscription:
    """Upgrade or downgrade an active subscription to `new_plan`.

    Stripe prorates the change; the local row is refreshed immediately and
    again when the resulting webhook arrives.
    """
    sub = await get_subscription(db, org.id)
    if not sub.stripe_subscription_id:
        raise ConflictError(
            "There is no active subscription to change. Start one from checkout."
        )
    if sub.plan == new_plan:
        raise ConflictError(f"You are already on the {new_plan.label} plan.")

    previous_plan = sub.plan
    new_price = settings.stripe_price_ids[new_plan.value]
    try:
        stripe_sub = await asyncio.to_thread(
            stripe.Subscription.retrieve, sub.stripe_subscription_id
        )
        item_id = stripe_sub["items"]["data"][0]["id"]
        updated = await asyncio.to_thread(
            stripe.Subscription.modify,
            sub.stripe_subscription_id,
            items=[{"id": item_id, "price": new_price}],
            proration_behavior="create_prorations",
            cancel_at_period_end=False,
        )
    except stripe.StripeError as exc:  # type: ignore[attr-defined]
        logger.error("stripe.plan_change_failed", error=str(exc))
        raise BillingError("Could not change your plan. Please try again.") from exc

    _apply_subscription_object(sub, updated)
    await db.flush()

    await audit_service.record(
        db,
        AuditAction.BILLING_PLAN_CHANGED,
        organization_id=org.id,
        actor_user_id=actor.id,
        actor_email=actor.email,
        ip_address=ip_address,
        user_agent=user_agent,
        meta={"from": previous_plan.value, "to": new_plan.value},
    )
    return sub


async def cancel_subscription(
    db: AsyncSession,
    *,
    org: Organization,
    actor: User,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> Subscription:
    """Schedule the subscription to end at the current period's close."""
    sub = await get_subscription(db, org.id)
    if not sub.stripe_subscription_id:
        raise ConflictError("There is no active subscription to cancel.")
    try:
        updated = await asyncio.to_thread(
            stripe.Subscription.modify,
            sub.stripe_subscription_id,
            cancel_at_period_end=True,
        )
    except stripe.StripeError as exc:  # type: ignore[attr-defined]
        logger.error("stripe.cancel_failed", error=str(exc))
        raise BillingError("Could not cancel the subscription.") from exc

    _apply_subscription_object(sub, updated)
    await db.flush()
    await audit_service.record(
        db,
        AuditAction.BILLING_SUBSCRIPTION_CANCELED,
        organization_id=org.id,
        actor_user_id=actor.id,
        actor_email=actor.email,
        ip_address=ip_address,
        user_agent=user_agent,
    )
    return sub


# --------------------------------------------------------------------------
# Webhook reconciliation
# --------------------------------------------------------------------------
def verify_webhook(payload: bytes, signature: str | None) -> stripe.Event:
    """Verify a webhook's signature and return the parsed event.

    Signature verification is what authenticates the webhook — without it any
    caller could forge billing state — so a missing/bad signature is rejected.
    """
    if not signature:
        raise BillingError("Missing Stripe signature header.")
    try:
        return stripe.Webhook.construct_event(
            payload, signature, settings.stripe_webhook_secret
        )
    except (ValueError, stripe.SignatureVerificationError) as exc:  # type: ignore[attr-defined]
        logger.warning("stripe.webhook_verification_failed", error=str(exc))
        raise BillingError("Invalid webhook signature.") from exc


def _apply_subscription_object(sub: Subscription, stripe_sub: object) -> None:
    """Copy fields from a Stripe Subscription object onto our local row."""
    data = dict(stripe_sub)  # type: ignore[call-overload]
    sub.stripe_subscription_id = data.get("id") or sub.stripe_subscription_id
    sub.status = _status_from_stripe(data.get("status", "incomplete"))
    sub.cancel_at_period_end = bool(data.get("cancel_at_period_end", False))

    period_end = data.get("current_period_end")
    if period_end:
        sub.current_period_end = datetime.fromtimestamp(int(period_end), tz=UTC)

    items = (data.get("items") or {}).get("data") or []
    if items:
        plan = _plan_for_price(items[0].get("price", {}).get("id"))
        if plan is not None:
            sub.plan = plan
            sub.seats = plan.seats


async def _subscription_for_customer(
    db: AsyncSession, customer_id: str | None
) -> Subscription | None:
    if not customer_id:
        return None
    return await db.scalar(
        select(Subscription).where(Subscription.stripe_customer_id == customer_id)
    )


async def apply_webhook_event(db: AsyncSession, event: stripe.Event) -> None:
    """Update local billing state from a verified Stripe webhook event."""
    event_type = event["type"]
    obj = event["data"]["object"]
    logger.info("stripe.webhook", event_type=event_type, event_id=event["id"])

    if event_type in ("customer.subscription.created", "customer.subscription.updated"):
        sub = await _subscription_for_customer(db, obj.get("customer"))
        if sub is not None:
            first = sub.status
            _apply_subscription_object(sub, obj)
            await db.flush()
            if first == SubscriptionStatus.INCOMPLETE and sub.is_live:
                await audit_service.record(
                    db,
                    AuditAction.BILLING_SUBSCRIPTION_CREATED,
                    organization_id=sub.organization_id,
                    meta={"plan": sub.plan.value},
                )

    elif event_type == "customer.subscription.deleted":
        sub = await _subscription_for_customer(db, obj.get("customer"))
        if sub is not None:
            sub.status = SubscriptionStatus.CANCELED
            await db.flush()

    elif event_type in ("invoice.paid", "invoice.payment_succeeded"):
        await _handle_invoice_paid(db, obj)

    elif event_type == "invoice.payment_failed":
        sub = await _subscription_for_customer(db, obj.get("customer"))
        if sub is not None:
            sub.status = SubscriptionStatus.PAST_DUE
            await db.flush()
            await audit_service.record(
                db,
                AuditAction.BILLING_PAYMENT_FAILED,
                organization_id=sub.organization_id,
                meta={"invoice": obj.get("id")},
            )


async def _handle_invoice_paid(db: AsyncSession, invoice: dict) -> None:
    sub = await _subscription_for_customer(db, invoice.get("customer"))
    if sub is None:
        return
    org = await db.get(Organization, sub.organization_id)
    if org is None:
        return

    amount = invoice.get("amount_paid", 0) / 100
    currency = (invoice.get("currency") or "usd").upper()
    await audit_service.record(
        db,
        AuditAction.BILLING_PAYMENT_SUCCEEDED,
        organization_id=org.id,
        meta={"amount": amount, "currency": currency, "invoice": invoice.get("id")},
    )

    billing_email = invoice.get("customer_email")
    if billing_email:
        await email_service.send_billing_receipt_email(
            db,
            to_email=billing_email,
            organization_name=org.name,
            plan=sub.plan.label,
            amount_label=f"{amount:.2f} {currency}",
            invoice_url=invoice.get("hosted_invoice_url"),
            organization_id=org.id,
        )
