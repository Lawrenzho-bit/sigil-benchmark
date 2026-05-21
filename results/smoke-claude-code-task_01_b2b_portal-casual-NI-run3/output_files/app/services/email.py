"""Transactional email.

In development (no SMTP_HOST configured) emails are rendered to the log instead
of sent, so the whole flow is exercisable without an SMTP account.

Templates are plain-text with a tiny HTML wrapper; this keeps deliverability high
and avoids shipping a heavyweight templating dependency for email.
"""

from __future__ import annotations

import logging
from email.message import EmailMessage

import aiosmtplib

from app.config import settings

logger = logging.getLogger("acme.email")


def _wrap_html(title: str, body_lines: list[str], cta: tuple[str, str] | None) -> str:
    paragraphs = "".join(f"<p>{line}</p>" for line in body_lines)
    button = ""
    if cta:
        label, url = cta
        button = (
            f'<p><a href="{url}" '
            'style="display:inline-block;padding:10px 18px;background:#2563eb;'
            'color:#fff;text-decoration:none;border-radius:6px">'
            f"{label}</a></p>"
        )
    return (
        f"<div style='font-family:system-ui,sans-serif;max-width:520px;margin:auto'>"
        f"<h2>{title}</h2>{paragraphs}{button}"
        "<hr><p style='color:#888;font-size:12px'>Acme Portal — "
        "you received this because of activity on your account.</p></div>"
    )


async def send_email(
    to: str,
    subject: str,
    body_lines: list[str],
    cta: tuple[str, str] | None = None,
) -> None:
    """Send one email. No-op-to-log when SMTP is not configured."""
    text = "\n\n".join(body_lines)
    if cta:
        text += f"\n\n{cta[0]}: {cta[1]}"

    if not settings.smtp_host:
        logger.info("EMAIL (dev, not sent) to=%s subject=%s\n%s", to, subject, text)
        return

    message = EmailMessage()
    message["From"] = settings.email_from
    message["To"] = to
    message["Subject"] = subject
    message.set_content(text)
    message.add_alternative(_wrap_html(subject, body_lines, cta), subtype="html")

    try:
        await aiosmtplib.send(
            message,
            hostname=settings.smtp_host,
            port=settings.smtp_port,
            username=settings.smtp_username or None,
            password=settings.smtp_password or None,
            start_tls=settings.smtp_use_tls,
        )
    except Exception:  # noqa: BLE001 - delivery failure must not break the request
        logger.exception("Failed to send email to=%s subject=%s", to, subject)


# --- Concrete messages -----------------------------------------------------
async def send_welcome(to: str, name: str) -> None:
    await send_email(
        to,
        "Welcome to Acme Portal",
        [
            f"Hi {name or 'there'},",
            "Your account is ready. You can sign in any time and start inviting " "your team.",
        ],
        cta=("Open the portal", f"{settings.base_url}/dashboard"),
    )


async def send_invite(to: str, org_name: str, inviter: str, accept_url: str) -> None:
    await send_email(
        to,
        f"You've been invited to {org_name}",
        [
            f"{inviter} invited you to join {org_name} on Acme Portal.",
            "This invitation link expires in 7 days.",
        ],
        cta=("Accept invitation", accept_url),
    )


async def send_receipt(to: str, org_name: str, plan: str, amount_usd: int) -> None:
    await send_email(
        to,
        "Your Acme Portal receipt",
        [
            f"Thanks — your payment for {org_name} was processed.",
            f"Plan: {plan.title()}  •  Amount: ${amount_usd}.00 / month",
            "A detailed invoice is available in the billing portal.",
        ],
        cta=("View billing", f"{settings.base_url}/billing"),
    )


async def send_password_reset(to: str, reset_url: str) -> None:
    await send_email(
        to,
        "Reset your Acme Portal password",
        [
            "We received a request to reset your password.",
            "If you didn't ask for this, you can safely ignore this email.",
            "The link expires in 1 hour.",
        ],
        cta=("Reset password", reset_url),
    )
