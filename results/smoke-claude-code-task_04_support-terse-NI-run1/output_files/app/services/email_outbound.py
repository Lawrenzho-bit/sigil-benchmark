"""Outbound email — SMTP send, threading headers, plus-address reply-to."""

import smtplib
import ssl
import uuid
from email.message import EmailMessage

import structlog

from app.config import get_settings
from app.models.message import Message
from app.models.ticket import Ticket

log = structlog.get_logger(__name__)
settings = get_settings()


def _reply_to(ticket: Ticket) -> str:
    user, _, host = settings.smtp_from.partition("@")
    domain = host or settings.inbound_address_domain
    return f"{user}+{ticket.number}@{domain}"


def _build(message: Message, ticket: Ticket) -> EmailMessage:
    em = EmailMessage()
    em["From"] = settings.smtp_from
    em["To"] = ticket.customer.email
    em["Reply-To"] = _reply_to(ticket)
    em["Subject"] = f"Re: {ticket.subject} [#{ticket.number}]"

    message_id = f"<{uuid.uuid4().hex}@{settings.inbound_address_domain}>"
    em["Message-ID"] = message_id
    message.external_id = message_id

    # Stitch threading: In-Reply-To is the most-recent prior message;
    # References is the chain of all prior Message-IDs.
    prior = [m for m in ticket.messages if m.external_id and m.id != message.id]
    if prior:
        em["In-Reply-To"] = prior[-1].external_id
        em["References"] = " ".join(p.external_id for p in prior if p.external_id)

    em.set_content(message.body_text)
    if message.body_html:
        em.add_alternative(message.body_html, subtype="html")
    return em


def send(message: Message, ticket: Ticket) -> None:
    em = _build(message, ticket)
    if settings.app_env == "test":
        log.info("smtp.skip_test_mode", to=em["To"])
        return
    try:
        ctx = ssl.create_default_context()
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=30) as smtp:
            smtp.ehlo()
            if settings.smtp_tls:
                smtp.starttls(context=ctx)
                smtp.ehlo()
            if settings.smtp_user and settings.smtp_password:
                smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.send_message(em)
        log.info("smtp.sent", to=em["To"], message_id=em["Message-ID"])
    except Exception as e:
        log.exception("smtp.error", error=str(e))
        raise
