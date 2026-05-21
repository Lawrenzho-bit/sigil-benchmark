"""Application exception hierarchy.

Handlers and services raise these instead of returning ad-hoc errors; a single
exception handler in app.main maps them to HTTP responses (or flash messages
for HTML form posts).
"""

from __future__ import annotations


class AppError(Exception):
    """Base class for all expected, handled application errors."""

    status_code: int = 400
    # A safe, user-facing message. Never leak internals here.
    message: str = "Something went wrong."

    def __init__(self, message: str | None = None) -> None:
        if message:
            self.message = message
        super().__init__(self.message)


class AuthenticationError(AppError):
    status_code = 401
    message = "Invalid email or password."


class PermissionDenied(AppError):
    status_code = 403
    message = "You do not have permission to perform this action."


class NotFoundError(AppError):
    status_code = 404
    message = "The requested resource was not found."


class ConflictError(AppError):
    status_code = 409
    message = "That action conflicts with the current state."


class ValidationError(AppError):
    status_code = 422
    message = "The submitted data is invalid."


class RateLimitedError(AppError):
    status_code = 429
    message = "Too many attempts. Please try again later."

    def __init__(self, message: str | None = None, retry_after: int | None = None) -> None:
        self.retry_after = retry_after
        super().__init__(message)


class CSRFError(AppError):
    status_code = 403
    message = "Your session expired or the form was tampered with. Please retry."


class BillingError(AppError):
    status_code = 402
    message = "We could not process the billing request."


class SSOError(AppError):
    status_code = 400
    message = "Single sign-on failed. Contact your administrator."
