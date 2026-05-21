"""Parse inbound email and route to ticket.

Routing strategy:
  1. Look at To:/Delivered-To for plus-address `support+<ticket_number>@…`
  2. Else match In-Reply-To / References against `messages.external_id`
  3. Else create a new ticket.
"""

import hashlib
import hmac
import re
from email.utils import parseaddr
from typing import Any

import html2text
import structlog
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.message import Message, MessageChannel, MessageKind
from app.models.ticket import Ticket, TicketChannel
from app.schemas.ticket import TicketCreate
from app.services import audit, tickets

log = structlog.get_logger(__name__)
settings = get_settings()

PLUS_ADDR = re.compile(r"support\+(\d+)@", re.IGNORECASE)
SIG_DELIM = re.compile(r"^-- \s*$", re.MULTILINE)
QUOTE_LINE = re.compile(r"^>", re.MULTILINE)
ON_WROTE = re.compile(r"^On .* wrote:\s*$", re.MULTILINE | re.IGNORECASE)


def verify_signature(raw_body: bytes, signature: str) -> bool:
    expected = hmac.new(
        settings.inbound_webhook_secret.encode("utf-8"),
        raw_body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


def strip_signature(text: str) -> str:
    """Remove sig blocks and trailing quoted replies. Heuristic but robust."""
    if not text:
        return ""
    # Cut at `-- ` delimiter (RFC 3676 sig convention).
    m = SIG_DELIM.search(text)
    if m:
        text = text[: m.start()].rstrip()
    # Cut at the first "On <date>, <person> wrote:" block.
    m = ON_WROTE.search(text)
    if m:
        text = text[: m.start()].rstrip()
    # Drop trailing quoted-reply lines.
    lines = text.splitlines()
    while lines and (QUOTE_LINE.match(lines[-1]) or not lines[-1].strip()):
        lines.pop()
    return "\n".join(lines).strip()


def _html_to_text(html: str) -> str:
    h = html2text.HTML2Text()
    h.body_width = 0
    h.ignore_images = True
    return h.handle(html).strip()


def _find_ticket_by_recipient(db: Session, recipients: list[str]) -> Ticket | None:
    for addr in recipients:
        _, email = parseaddr(addr)
        m = PLUS_ADDR.search(email or "")
        if m:
            num = int(m.group(1))
            t = db.execute(select(Ticket).where(Ticket.number == num)).scalar_one_or_none()
            if t:
                return t
    return None


def _find_ticket_by_references(db: Session, refs: list[str]) -> Ticket | None:
    if not refs:
        return None
    msg = db.execute(
        select(Message).where(Message.external_id.in_(refs)).order_by(Message.created_at.desc())
    ).scalar_one_or_none()
    return msg.ticket if msg else None


def parse_inbound(payload: dict[str, Any]) -> dict[str, Any]:
    """Normalize a provider-specific payload (SES, Postmark, Mailgun) into our shape."""
    # We accept either {raw_mime: "..."} or a pre-parsed body shape; pre-parsed is preferred.
    headers = payload.get("headers") or {}
    body_text = (payload.get("text") or "").strip()
    body_html = payload.get("html")
    if not body_text and body_html:
        body_text = _html_to_text(body_html)
    body_text = strip_signature(body_text)

    return {
        "from": payload.get("from") or headers.get("From"),
        "to": payload.get("to") or [headers.get("To")],
        "cc": payload.get("cc") or [],
        "subject": payload.get("subject") or headers.get("Subject") or "(no subject)",
        "body_text": body_text,
        "body_html": body_html,
        "message_id": headers.get("Message-ID") or payload.get("message_id"),
        "in_reply_to": headers.get("In-Reply-To"),
        "references": headers.get("References"),
        "attachments": payload.get("attachments") or [],
        "headers": headers,
    }


def handle_inbound(db: Session, payload: dict[str, Any]) -> Ticket:
    parsed = parse_inbound(payload)
    _, from_email = parseaddr(parsed["from"] or "")
    if not from_email:
        raise ValueError("inbound email missing From")

    recipients = [r for r in (parsed.get("to") or []) + (parsed.get("cc") or []) if r]
    refs = []
    if parsed.get("in_reply_to"):
        refs.append(parsed["in_reply_to"])
    if parsed.get("references"):
        refs.extend(re.findall(r"<[^>]+>", parsed["references"]))

    ticket = _find_ticket_by_recipient(db, recipients) or _find_ticket_by_references(db, refs)

    if ticket is None:
        # New ticket.
        created = tickets.create_ticket(
            db,
            TicketCreate(
                subject=parsed["subject"][:500],
                body=parsed["body_text"] or "(empty)",
                customer_email=from_email,
                channel=TicketChannel.EMAIL,
            ),
        )
        # Stamp message with email headers.
        first = created.messages[0] if created.messages else None
        if first is not None:
            first.external_id = parsed.get("message_id")
            first.headers = parsed.get("headers", {})
            first.body_html = parsed.get("body_html")
            db.commit()
        log.info("inbound.new_ticket", ticket_id=str(created.id), number=created.number)
        return created

    # Reply to existing ticket.
    tickets.reply(
        db,
        ticket.id,
        body=parsed["body_text"] or "(empty)",
        customer_id=ticket.customer_id,
        kind=MessageKind.CUSTOMER_REPLY,
        channel=MessageChannel.EMAIL,
        external_id=parsed.get("message_id"),
        in_reply_to=parsed.get("in_reply_to"),
        references=parsed.get("references"),
        headers=parsed.get("headers", {}),
    )
    log.info("inbound.reply", ticket_id=str(ticket.id), number=ticket.number)
    return ticket
