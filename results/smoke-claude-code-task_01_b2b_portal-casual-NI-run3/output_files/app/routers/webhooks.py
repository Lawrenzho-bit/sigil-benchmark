"""Stripe webhook receiver.

Security: the endpoint trusts nothing until `stripe_service.verify_webhook` has
validated the signature against STRIPE_WEBHOOK_SECRET. It is deliberately exempt
from CSRF (it is a server-to-server call authenticated by that signature).

Idempotency: handlers are written so re-delivery of the same event is harmless —
they upsert the local projection rather than applying deltas.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Request
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.responses import JSONResponse

from app.database import SessionLocal
from app.models.enums import Plan, SubscriptionStatus
from app.models.organization import Organization
from app.models.subscription import Subscription
from app.services import stripe_service
from app.services.audit import Action, record
from app.services.email import send_receipt

logger = logging.getLogger("acme.webhooks")
router = APIRouter(tags=["webhooks"])


def _org_by_customer(db: Session, customer_id: str | None) -> Organization | None:
    if not customer_id:
        return None
    return db.scalar(select(Organization).where(Organization.stripe_customer_id == customer_id))


def _ts(value: int | None) -> datetime | None:
    return datetime.fromtimestamp(value, tz=UTC) if value else None


def _sync_subscription(db: Session, org: Organization, stripe_sub: dict) -> Subscription:
    """Upsert the local Subscription projection from a Stripe subscription object."""
    items = stripe_sub.get("items", {}).get("data", [])
    price_id = items[0]["price"]["id"] if items else None
    plan = stripe_service.plan_for_price(price_id) if price_id else None
    seats = items[0].get("quantity", 1) if items else 1

    sub = org.subscription
    if sub is None:
        sub = Subscription(organization_id=org.id, plan=plan or org.plan)
        db.add(sub)

    sub.stripe_subscription_id = stripe_sub["id"]
    sub.stripe_customer_id = stripe_sub.get("customer")
    sub.status = stripe_service.map_status(stripe_sub.get("status", "incomplete"))
    sub.seats = seats
    sub.cancel_at_period_end = bool(stripe_sub.get("cancel_at_period_end"))
    sub.current_period_end = _ts(stripe_sub.get("current_period_end"))
    if plan is not None:
        sub.plan = plan
        # Keep the org's denormalized plan in step while the sub is live.
        if sub.status in {SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING}:
            org.plan = plan

    if sub.status == SubscriptionStatus.CANCELED:
        # On cancellation the org falls back to the Starter tier.
        org.plan = Plan.STARTER
    return sub


@router.post("/webhooks/stripe", include_in_schema=False)
async def stripe_webhook(request: Request) -> JSONResponse:
    payload = await request.body()
    signature = request.headers.get("stripe-signature")

    try:
        event = stripe_service.verify_webhook(payload, signature)
    except stripe_service.BillingNotConfigured:
        logger.warning("Stripe webhook received but billing is not configured.")
        return JSONResponse({"error": "billing not configured"}, status_code=503)
    except Exception:  # noqa: BLE001 - signature failure / malformed payload
        logger.warning("Rejected Stripe webhook with bad signature.")
        return JSONResponse({"error": "invalid signature"}, status_code=400)

    event_type = event["type"]
    obj = event["data"]["object"]

    # Each handler opens its own DB session — webhooks run outside request scope.
    db = SessionLocal()
    try:
        if event_type in {
            "customer.subscription.created",
            "customer.subscription.updated",
            "customer.subscription.deleted",
        }:
            org = _org_by_customer(db, obj.get("customer"))
            if org is not None:
                sub = _sync_subscription(db, org, obj)
                db.commit()
                record(
                    db,
                    action=Action.PLAN_CHANGED
                    if event_type != "customer.subscription.deleted"
                    else Action.SUBSCRIPTION_CANCELED,
                    organization_id=org.id,
                    actor_email="stripe-webhook",
                    target_type="subscription",
                    target_id=sub.stripe_subscription_id,
                    details={"status": sub.status.value, "plan": sub.plan.value},
                )

        elif event_type == "checkout.session.completed":
            org = _org_by_customer(db, obj.get("customer"))
            if org is not None and obj.get("subscription"):
                # Pull the full subscription so the projection is complete.
                import stripe

                full_sub = stripe.Subscription.retrieve(obj["subscription"])
                _sync_subscription(db, org, full_sub)
                db.commit()

        elif event_type == "invoice.paid":
            org = _org_by_customer(db, obj.get("customer"))
            if org is not None:
                amount = int(obj.get("amount_paid", 0) / 100)
                owner_email = obj.get("customer_email")
                if owner_email:
                    await send_receipt(owner_email, org.name, org.plan.value, amount)

        else:
            logger.debug("Ignoring unhandled Stripe event: %s", event_type)

    except Exception:  # noqa: BLE001
        logger.exception("Error handling Stripe event %s", event_type)
        db.rollback()
        # 500 tells Stripe to retry later.
        return JSONResponse({"error": "processing error"}, status_code=500)
    finally:
        db.close()

    return JSONResponse({"received": True})
