#!/usr/bin/env bash
# Container entrypoint: wait for the DB, apply migrations, seed, then serve.
set -euo pipefail

echo "[entrypoint] applying database migrations..."
alembic upgrade head

echo "[entrypoint] running first-run seed (no-op if already seeded)..."
python -m app.seed

echo "[entrypoint] starting web server..."
exec gunicorn app.main:app \
    --worker-class uvicorn.workers.UvicornWorker \
    --workers "${WEB_CONCURRENCY:-3}" \
    --bind "0.0.0.0:${PORT:-8000}" \
    --access-logfile - \
    --error-logfile - \
    --timeout 60
