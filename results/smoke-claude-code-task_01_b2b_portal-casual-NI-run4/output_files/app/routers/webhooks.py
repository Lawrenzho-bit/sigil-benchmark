"""Inbound webhooks (machine-to-machine, no browser session)."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from starlette.requests import Request

from app.dependencies import DbSession
from app.exceptions import BillingError
from app.logging_config import get_logger
from app.services import billing_service

logger = get_logger(__name__)

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


@router.post("/stripe", include_in_schema=False)
async def stripe_webhook(request: Request, db: DbSession) -> JSONResponse:
    """Receive and process Stripe billing events.

    This endpoint is CSRF-exempt by design — it is not a browser form. Its
    authentication is the Stripe signature header, verified before the payload
    is trusted; an unsigned or mis-signed request is rejected with 400.
    """
    payload = await request.body()
    signature = request.headers.get("stripe-signature")

    try:
        event = billing_service.verify_webhook(payload, signature)
    except BillingError:
        # 400 → Stripe records the failure; it never gets to mutate our data.
        return JSONResponse({"error": "invalid signature"}, status_code=400)

    await billing_service.apply_webhook_event(db, event)
    return JSONResponse({"received": True})
