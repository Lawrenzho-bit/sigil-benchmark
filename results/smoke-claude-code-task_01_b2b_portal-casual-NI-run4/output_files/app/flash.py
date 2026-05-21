"""One-shot 'flash' messages.

A flash message is shown to the user on the page they are redirected to after
an action (e.g. "Member invited."). It is carried in a short-lived signed
cookie so it cannot be tampered with and is cleared after being read once.
"""

from __future__ import annotations

import json
from typing import Literal

from itsdangerous import BadSignature, URLSafeSerializer
from starlette.requests import Request
from starlette.responses import Response

from app.config import settings

FlashLevel = Literal["success", "error", "info"]

_COOKIE_NAME = "portal_flash"
_serializer = URLSafeSerializer(settings.secret_key, salt="flash")


def set_flash(response: Response, message: str, level: FlashLevel = "success") -> None:
    """Attach a flash message to `response` (typically a redirect)."""
    payload = _serializer.dumps({"m": message, "l": level})
    response.set_cookie(
        _COOKIE_NAME,
        payload,
        max_age=30,
        httponly=True,
        samesite="lax",
        secure=settings.session_cookie_secure,
    )


def read_flash(request: Request) -> dict[str, str] | None:
    """Decode the flash message from the request cookie, if present and valid.

    Pair with `clear_flash` on the rendered response so the message is shown
    only once.
    """
    raw = request.cookies.get(_COOKIE_NAME)
    if not raw:
        return None
    try:
        data = _serializer.loads(raw)
    except (BadSignature, json.JSONDecodeError):
        return None
    return {"message": data.get("m", ""), "level": data.get("l", "info")}


def clear_flash(response: Response) -> None:
    """Delete the flash cookie on `response`."""
    response.delete_cookie(_COOKIE_NAME)
