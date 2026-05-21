#!/bin/sh
set -e

# Apply pending database migrations before the app accepts traffic.
echo "==> Applying database migrations"
npx prisma migrate deploy

exec "$@"
