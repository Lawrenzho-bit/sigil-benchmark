# Acme Portal — B2B SaaS Portal

A production-ready multi-tenant B2B SaaS portal built with **FastAPI**, **PostgreSQL**,
**Stripe**, and **SAML SSO**. It is not a demo: it has real authentication, role-based
access control, billing, audit logging, GDPR tooling, rate limiting, CSRF protection,
security headers, migrations, tests, Docker packaging, and CI/CD.

## Features

| Area            | What you get |
|-----------------|--------------|
| **Auth**        | Email/password sign-up & login, server-side revocable sessions, bcrypt hashing, password reset |
| **SSO**         | SP-initiated SAML 2.0 sign-in (Okta / Azure AD / OneLogin compatible) |
| **RBAC**        | Org-scoped roles: `owner`, `admin`, `viewer` — enforced on every route |
| **Multi-tenant**| Organizations with memberships; every query is tenant-scoped |
| **Dashboard**   | Live metrics: seats used, active sessions, plan, MRR, recent activity |
| **Billing**     | Stripe Checkout + Customer Portal, 3 plans (starter/pro/enterprise), upgrade/downgrade, webhooks |
| **Audit log**   | Every security-relevant action recorded; searchable admin view; CSV export |
| **Team mgmt**   | Invite by email, change roles, remove members, seat enforcement |
| **Settings**    | Organization settings + per-user profile/security settings |
| **Email**       | Transactional email (welcome, invite, receipt, password reset) via SMTP, console fallback in dev |
| **GDPR**        | Cookie consent banner, privacy policy, full data export (JSON), account & org deletion |
| **Security**    | ORM-only queries (no SQLi), Jinja autoescape (no XSS), CSRF tokens, rate limiting, HSTS/CSP headers, secure cookies |
| **Ops**         | Docker + docker-compose, Alembic migrations, GitHub Actions CI, deploy configs for Fly.io & Railway |

## Quick start (local)

```bash
cp .env.example .env            # then edit secrets
docker compose up --build       # app on http://localhost:8000
```

The `web` container runs migrations automatically on boot. A first-run seed creates
an organization and an owner account if `SEED_OWNER_EMAIL` is set.

### Without Docker

```bash
python -m venv .venv && . .venv/Scripts/activate   # Windows
pip install -e ".[dev]"
alembic upgrade head
uvicorn app.main:app --reload
```

> SAML requires the native `xmlsec` library. The Docker image installs it
> (`libxmlsec1-dev`). For local non-Docker use on Windows, either skip SSO or run
> inside WSL.

## Configuration

All configuration is environment-driven (see `.env.example`). Nothing secret is
committed. The app refuses to start in production with insecure defaults
(see `app/config.py`).

## Tests

```bash
pytest                # unit + integration tests, SQLite-backed
ruff check . && ruff format --check .
```

CI runs the same on every push (`.github/workflows/ci.yml`).

## Deployment

- **Fly.io**: `fly launch --copy-config` then `fly deploy` (see `fly.toml`)
- **Railway**: connect the repo; `railway.json` configures the build
- Any Docker host: build `Dockerfile`, provide a Postgres URL + the env vars

After deploy, run `alembic upgrade head` (Fly/Railway release commands are
pre-wired to do this).

## Project layout

```
app/
  main.py            ASGI app, middleware wiring
  config.py          Settings (pydantic-settings), production safety checks
  database.py        SQLAlchemy engine/session
  security.py        Hashing, CSRF, session helpers, security headers
  rate_limit.py      Login rate limiting
  models/            SQLAlchemy ORM models
  schemas/           Pydantic request/response schemas
  routers/           HTTP routes (auth, sso, dashboard, users, billing, ...)
  services/          Email, Stripe, SAML, audit, metrics
  templates/         Jinja2 templates (autoescaped)
  static/            CSS/JS
alembic/             Database migrations
tests/               pytest suite
```

## Security model

See [`SECURITY.md`](SECURITY.md) for the threat model, the controls that mitigate
each item in the OWASP Top 10, and responsible-disclosure contact.
