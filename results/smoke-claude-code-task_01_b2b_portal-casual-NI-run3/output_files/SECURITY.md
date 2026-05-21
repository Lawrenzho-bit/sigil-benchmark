# Security Model

## Reporting

Email `security@acme.example`. We aim to acknowledge within 2 business days.
Please do not open public issues for vulnerabilities.

## Controls vs. OWASP Top 10

| Risk | Mitigation |
|------|-----------|
| **A01 Broken Access Control** | Every route resolves the current membership and checks role via `require_role`. Tenant isolation: all queries filter by `organization_id` from the session, never from user input. |
| **A02 Cryptographic Failures** | Passwords hashed with bcrypt (cost 12). Sessions are random 256-bit tokens stored hashed in the DB. Cookies are `HttpOnly`, `SameSite=Lax`, `Secure` in production. |
| **A03 Injection** | All DB access goes through SQLAlchemy ORM with bound parameters — no string-built SQL. Templates use Jinja2 autoescaping (XSS). `Content-Security-Policy` blocks inline/3rd-party scripts. |
| **A04 Insecure Design** | Seat limits enforced server-side, audit logging is non-optional, destructive actions require CSRF + re-auth context. |
| **A05 Security Misconfiguration** | `app/config.py` refuses to boot in production with a default `SECRET_KEY`, `COOKIE_SECURE=false`, or a non-TLS `BASE_URL`. Security headers set on every response. |
| **A06 Vulnerable Components** | Dependencies pinned in `pyproject.toml`; CI can run `pip-audit`. |
| **A07 Auth Failures** | Login is rate limited (per IP + per account). Generic error messages prevent user enumeration. Sessions are server-side and revocable; expired/invalid sessions are rejected. |
| **A08 Data Integrity** | Stripe webhooks are signature-verified. CSRF tokens on all state-changing forms. |
| **A09 Logging Failures** | `audit_logs` records actor, action, target, IP, and user agent for every security-relevant event. |
| **A10 SSRF** | SAML IdP metadata fetched only from admin-configured URLs; no user-supplied URL fetching elsewhere. |

## Rate limiting

`POST /auth/login` and `POST /auth/signup` are limited (default 10/min/IP, plus a
per-account lockout window). Backed by in-memory storage in dev; point
`RATELIMIT_STORAGE_URI` at Redis for multi-instance deployments.

## Data protection / GDPR

- Cookie consent banner; only strictly-necessary cookies set before consent.
- `/gdpr/export` produces a complete JSON export of the user's personal data.
- `/gdpr/delete-account` permanently deletes the user (and the org if they are the
  sole owner) after confirmation.
- Privacy policy served at `/legal/privacy`.
