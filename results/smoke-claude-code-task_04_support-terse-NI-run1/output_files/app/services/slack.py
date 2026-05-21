"""Slack channel adapter.

Inbound: messages from a designated channel become tickets (or replies if the
ticket's `metadata.slack_thread_ts` matches).

Outbound: agent reply gets posted back to the thread.

Configuration lives in env (SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET) — when those
are absent, the adapter is a no-op so the rest of the system works fine.
"""

import hashlib
import hmac
import time
from typing import Any

import httpx
import structlog

from app.config import get_settings
from app.models.ticket import Ticket

log = structlog.get_logger(__name__)
settings = get_settings()


def enabled() -> bool:
    return bool(settings.slack_bot_token and settings.slack_signing_secret)


def verify_signature(timestamp: str, body: bytes, signature: str) -> bool:
    if not settings.slack_signing_secret:
        return False
    if abs(time.time() - int(timestamp)) > 60 * 5:
        return False
    base = f"v0:{timestamp}:".encode() + body
    expected = "v0=" + hmac.new(
        settings.slack_signing_secret.encode(), base, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


def post_reply(ticket: Ticket, text: str) -> None:
    if not enabled():
        return
    thread_ts = (ticket.metadata_ or {}).get("slack_thread_ts")
    channel = (ticket.metadata_ or {}).get("slack_channel")
    if not (thread_ts and channel):
        return
    try:
        httpx.post(
            "https://slack.com/api/chat.postMessage",
            headers={"Authorization": f"Bearer {settings.slack_bot_token}"},
            json={"channel": channel, "thread_ts": thread_ts, "text": text},
            timeout=10,
        ).raise_for_status()
    except Exception as e:
        log.exception("slack.post_failed", error=str(e))


def handle_event(payload: dict[str, Any]) -> dict[str, Any] | None:
    """Translate a Slack `event_callback` payload into a normalized inbound shape."""
    if payload.get("type") == "url_verification":
        return {"challenge": payload.get("challenge")}
    event = payload.get("event") or {}
    if event.get("type") != "message" or event.get("bot_id"):
        return None
    # We synthesize a fake "email-shaped" envelope so the inbound pipeline can reuse routing.
    return {
        "channel": "slack",
        "from": f"slack:{event.get('user')}",
        "subject": (event.get("text") or "")[:120] or "Slack message",
        "text": event.get("text") or "",
        "headers": {
            "X-Slack-Channel": event.get("channel"),
            "X-Slack-Thread-Ts": event.get("thread_ts") or event.get("ts"),
        },
    }
