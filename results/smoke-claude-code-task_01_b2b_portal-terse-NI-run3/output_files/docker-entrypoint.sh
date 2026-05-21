#!/bin/sh
# Apply pending DB migrations, then hand off to the app process.
set -e

echo "[entrypoint] applying database migrations..."
npx prisma migrate deploy

echo "[entrypoint] starting application..."
exec "$@"
