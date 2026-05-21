# Sigil — B2B SaaS Portal

A production-grade multi-tenant B2B customer portal.

- **Auth** — email/password sign-up + verification, password reset, and SAML 2.0 SSO per organization.
- **RBAC** — three roles (`owner`, `admin`, `viewer`) enforced by a central permission matrix.
- **Dashboard** — seat usage, role breakdown, subscription status, and 30-day activity metrics.
- **Billing** — Stripe Checkout + Customer Portal across three plans (`starter`, `pro`, `enterprise`) with upgrade/downgrade and webhook reconciliation.
- **Audit log** — every security-relevant action is recorded with actor, IP, and metadata; exportable as CSV for auditors.
- **Member management** — invite by email, change roles, remove members; "last owner" is protected.
- **Settings** — organization profile + SSO config, and per-user profile/security/consent.
- **Transactional email** — welcome, invitation, password reset, and billing receipt emails (SMTP, with a console backend for local dev).
- **GDPR** — cookie consent banner, privacy/terms/cookie pages, full personal-data export (JSON), and account deletion.
- **Security** — server-side sessions, Argon2 password hashing, CSRF protection, security headers + CSP, parameterised ORM queries, output escaping, and DB-backed login rate limiting.

## Tech stack

Python 3.12 · FastAPI · SQLAlchemy 2.0 (async) · PostgreSQL · Alembic · Jinja2 · Stripe · python3-saml

## Quick start (local)

```bash
cp .env.example .env          # then edit secrets
docker compose up --build     # app on http://localhost:8000
```

The `app` container runs migrations on boot. To load demo data:

```bash
docker compose exec app python -m app.seed
```

That creates an organization with an owner (`owner@demo.test` / `Demo-pass-1`),
an admin, a viewer, and sample audit + usage history.

## Running without Docker

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-saml.txt
alembic upgrade head
uvicorn app.main:app --reload
```

## Tests

```bash
pip install -r requirements-dev.txt
pytest                        # uses an isolated SQLite database
```

## Project layout

```
app/
  config.py        Pydantic settings (12-factor env config)
  database.py      Async SQLAlchemy engine + session
  security.py      Password hashing, signed tokens, CSRF
  middleware.py    Security headers, request IDs, session loading
  rbac.py          Role → permission matrix + enforcement
  models/          SQLAlchemy ORM models
  schemas/         Pydantic request/response models
  services/        Business logic (auth, billing, audit, email, gdpr, saml…)
  routers/         HTTP route handlers
  templates/       Jinja2 server-rendered pages + emails
  static/          CSS / JS
alembic/           Database migrations
tests/             Pytest suite
```

## Deployment

The repo ships configs for three platforms — pick one:

- **Fly.io** — `fly launch` then `fly deploy` (see `fly.toml`).
- **Railway** — connect the repo; `railway.json` defines build + start.
- **Modal** — `modal deploy modal_app.py`.

All three run the same `Dockerfile`. CI (`.github/workflows/ci.yml`) lints,
type-checks, runs the test suite, and builds the image on every push.

See `docs/SECURITY.md` and `docs/DEPLOYMENT.md` for details.
