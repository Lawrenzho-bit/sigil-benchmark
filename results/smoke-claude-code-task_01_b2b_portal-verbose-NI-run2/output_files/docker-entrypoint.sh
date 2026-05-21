#!/bin/sh
set -e

# Apply any pending database migrations before the app accepts traffic.
# `migrate deploy` is idempotent and safe to run on every container start.
echo "Running database migrations..."
npx prisma migrate deploy

echo "Starting application..."
exec "$@"
