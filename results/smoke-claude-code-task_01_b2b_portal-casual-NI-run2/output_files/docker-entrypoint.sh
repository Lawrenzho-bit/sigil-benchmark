#!/usr/bin/env sh
# Entrypoint: apply database migrations, then hand off to the given command.
set -e

echo "[entrypoint] running database migrations..."
alembic upgrade head

echo "[entrypoint] starting: $*"
exec "$@"
