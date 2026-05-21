from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from app.db import get_db
from app.services import email_inbound, slack

router = APIRouter()


@router.post("/inbound-email")
async def inbound_email(
    request: Request,
    db: Session = Depends(get_db),
    x_signature: str | None = Header(default=None, alias="X-Signature"),
):
    raw = await request.body()
    if not x_signature or not email_inbound.verify_signature(raw, x_signature):
        raise HTTPException(401, "bad_signature")
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(400, "invalid_json")
    ticket = email_inbound.handle_inbound(db, payload)
    return {"ticket_id": str(ticket.id), "number": ticket.number}


@router.post("/slack")
async def slack_webhook(
    request: Request,
    db: Session = Depends(get_db),
    x_slack_request_timestamp: str | None = Header(default=None, alias="X-Slack-Request-Timestamp"),
    x_slack_signature: str | None = Header(default=None, alias="X-Slack-Signature"),
):
    raw = await request.body()
    if not (x_slack_request_timestamp and x_slack_signature):
        raise HTTPException(401, "missing_signature")
    if not slack.verify_signature(x_slack_request_timestamp, raw, x_slack_signature):
        raise HTTPException(401, "bad_signature")
    payload = await request.json()
    result = slack.handle_event(payload)
    if result is None:
        return {"ok": True}
    if "challenge" in result:
        return {"challenge": result["challenge"]}

    # Synthesize and route through the inbound pipeline.
    ticket = email_inbound.handle_inbound(db, result)
    return {"ticket_id": str(ticket.id)}
