#!/usr/bin/env bash
# Container entrypoint: apply migrations, then start the app.
# Migrations run here (not in app code) so they happen exactly once per deploy.
set -euo pipefail

echo "[entrypoint] Applying database migrations..."
alembic upgrade head

if [[ "${SEED_ON_START:-false}" == "true" ]]; then
  echo "[entrypoint] Seeding demo data..."
  python -m app.seed || echo "[entrypoint] Seed skipped (data already present)."
fi

echo "[entrypoint] Starting Gunicorn (Uvicorn workers)..."
exec gunicorn app.main:app \
  --worker-class uvicorn.workers.UvicornWorker \
  --workers "${WEB_CONCURRENCY:-2}" \
  --bind "0.0.0.0:${PORT:-8000}" \
  --access-logfile - \
  --error-logfile - \
  --timeout 60 \
  --graceful-timeout 30
