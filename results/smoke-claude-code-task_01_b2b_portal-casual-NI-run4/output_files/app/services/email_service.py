"""Transactional email service.

Renders Jinja templates from ``templates/emails`` and sends them over SMTP.
With ``EMAIL_BACKEND=console`` (the local-dev default) messages are logged
instead of sent. Every send attempt is recorded in `email_logs`.
"""

from __future__ import annotations

import re
import uuid
from email.message import EmailMessage
from pathlib import Path

import aiosmtplib
from jinja2 import Environment, FileSystemLoader, select_autoescape
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.logging_config import get_logger
from app.models import EmailLog

logger = get_logger(__name__)

_EMAIL_TEMPLATE_DIR = Path(__file__).parent.parent / "templates" / "emails"
_env = Environment(
    loader=FileSystemLoader(str(_EMAIL_TEMPLATE_DIR)),
    autoescape=select_autoescape(["html"]),
)
_env.globals["app_name"] = "Sigil Portal"
_env.globals["base_url"] = settings.base_url

_TAG_RE = re.compile(r"<[^>]+>")


def _html_to_text(html: str) -> str:
    """Crude HTML→text fallback for mail clients that prefer plain text."""
    text = re.sub(r"(?is)<(script|style).*?</\1>", "", html)
    text = _TAG_RE.sub("", text)
    return re.sub(r"\n\s*\n+", "\n\n", text).strip()


async def _deliver(
    db: AsyncSession,
    *,
    to_email: str,
    subject: str,
    template: str,
    html: str,
    organization_id: uuid.UUID | None = None,
) -> None:
    """Send one message and log the outcome. Never raises to the caller —
    a failed receipt email must not roll back a successful payment."""
    status, error = "sent", None
    try:
        if settings.email_backend == "console":
            logger.info(
                "email.console", to=to_email, subject=subject, template=template
            )
        else:
            message = EmailMessage()
            message["From"] = f"{settings.email_from_name} <{settings.email_from}>"
            message["To"] = to_email
            message["Subject"] = subject
            message.set_content(_html_to_text(html))
            message.add_alternative(html, subtype="html")
            await aiosmtplib.send(
                message,
                hostname=settings.smtp_host,
                port=settings.smtp_port,
                username=settings.smtp_username or None,
                password=settings.smtp_password or None,
                start_tls=settings.smtp_use_tls,
            )
    except Exception as exc:  # noqa: BLE001 - email failure must not crash flows
        status, error = "failed", str(exc)[:512]
        logger.error("email.failed", to=to_email, template=template, error=error)

    db.add(
        EmailLog(
            organization_id=organization_id,
            to_email=to_email,
            subject=subject,
            template=template,
            status=status,
            error=error,
        )
    )
    await db.flush()


def _render(template_file: str, **ctx: object) -> str:
    return _env.get_template(template_file).render(**ctx)


# --------------------------------------------------------------------------
# Public API — one function per transactional email.
# --------------------------------------------------------------------------
async def send_welcome_email(
    db: AsyncSession, *, to_email: str, full_name: str, verify_url: str
) -> None:
    html = _render(
        "welcome.html", full_name=full_name, verify_url=verify_url
    )
    await _deliver(
        db,
        to_email=to_email,
        subject="Welcome to Sigil Portal — please confirm your email",
        template="welcome",
        html=html,
    )


async def send_invitation_email(
    db: AsyncSession,
    *,
    to_email: str,
    organization_name: str,
    inviter_name: str,
    role: str,
    accept_url: str,
    organization_id: uuid.UUID,
) -> None:
    html = _render(
        "invitation.html",
        organization_name=organization_name,
        inviter_name=inviter_name,
        role=role,
        accept_url=accept_url,
    )
    await _deliver(
        db,
        to_email=to_email,
        subject=f"You've been invited to {organization_name} on Sigil Portal",
        template="invitation",
        html=html,
        organization_id=organization_id,
    )


async def send_password_reset_email(
    db: AsyncSession, *, to_email: str, full_name: str, reset_url: str
) -> None:
    html = _render("password_reset.html", full_name=full_name, reset_url=reset_url)
    await _deliver(
        db,
        to_email=to_email,
        subject="Reset your Sigil Portal password",
        template="password_reset",
        html=html,
    )


async def send_billing_receipt_email(
    db: AsyncSession,
    *,
    to_email: str,
    organization_name: str,
    plan: str,
    amount_label: str,
    invoice_url: str | None,
    organization_id: uuid.UUID,
) -> None:
    html = _render(
        "billing_receipt.html",
        organization_name=organization_name,
        plan=plan,
        amount_label=amount_label,
        invoice_url=invoice_url,
    )
    await _deliver(
        db,
        to_email=to_email,
        subject=f"Your Sigil Portal receipt — {organization_name}",
        template="billing_receipt",
        html=html,
        organization_id=organization_id,
    )
