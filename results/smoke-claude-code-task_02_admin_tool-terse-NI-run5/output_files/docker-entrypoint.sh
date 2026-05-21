#!/bin/sh
set -e

# Apply the Prisma schema to the database. For internal/low-traffic use we use
# `db push`; switch to versioned `prisma migrate deploy` if you adopt migrations.
echo "[entrypoint] syncing database schema..."
npx prisma db push --skip-generate --accept-data-loss=false || npx prisma db push --skip-generate

if [ "${SEED_ON_START}" = "true" ]; then
  echo "[entrypoint] seeding reference data..."
  node dist/../node_modules/.bin/tsx prisma/seed.ts || echo "[entrypoint] seed skipped/failed (non-fatal)"
fi

echo "[entrypoint] starting app..."
exec "$@"
