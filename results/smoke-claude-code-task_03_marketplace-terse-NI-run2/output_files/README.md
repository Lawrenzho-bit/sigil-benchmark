# Marketplace Platform — Backend Foundation

A B2C two-sided marketplace backend. This repository is a **foundation**, not a
deploy-ready system. Read `STATUS.md` before doing anything with money or PII.

## Stack

- Node 20 + TypeScript
- Fastify (HTTP)
- Prisma + PostgreSQL
- MinIO (S3-compatible object storage, for listing photos)
- Docker Compose for local development

## Quick start

```bash
cp .env.example .env
docker compose up -d postgres minio
cd backend
npm install
npx prisma migrate dev --name init
npm run dev
```

The API listens on `http://localhost:3000`. Health check: `GET /health`.

To run the whole stack in containers instead:

```bash
docker compose up --build
```

## Layout

```
backend/
  prisma/schema.prisma   Data model for all 12 domains
  src/
    app.ts               Fastify app + route registration
    server.ts            Process entrypoint
    config.ts            Env-driven config
    db.ts                Prisma client
    auth/                Password hashing, JWT, auth middleware
    lib/                 Errors, logging, S3, validation helpers
    modules/             One folder per domain
```

## Domains

| # | Domain      | Status (see STATUS.md) |
|---|-------------|------------------------|
| 1 | Accounts    | Implemented            |
| 2 | Seller KYC  | Interface + stub       |
| 3 | Listings    | Implemented            |
| 4 | Search      | Implemented            |
| 5 | Cart        | Implemented            |
| 6 | Checkout    | Stripe integration code, untested |
| 7 | Orders      | Implemented            |
| 8 | Reviews     | Implemented            |
| 9 | Messaging   | Implemented            |
| 10| Disputes    | Implemented (state machine) |
| 11| Payouts     | Fee logic implemented, transfer call stubbed |
| 12| Tax         | Facilitator logic implemented |
| - | Admin       | Implemented            |

## Compliance notes

This foundation makes compliance *possible* but does not *achieve* it. See
`STATUS.md` for the PCI DSS / GDPR / DSA gap list.
