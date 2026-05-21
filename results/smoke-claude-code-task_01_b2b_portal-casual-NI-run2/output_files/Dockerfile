# syntax=docker/dockerfile:1
# ---- builder ---------------------------------------------------------------
FROM python:3.12-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

# Build deps for psycopg, argon2-cffi and xmlsec (python3-saml).
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential libpq-dev libxml2-dev libxmlsec1-dev libxmlsec1-openssl \
        pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml ./
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir --prefix=/install .

# ---- runtime ---------------------------------------------------------------
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8000

# Runtime libraries only (no compilers).
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpq5 libxml2 libxmlsec1 libxmlsec1-openssl curl \
    && rm -rf /var/lib/apt/lists/*

# Run as an unprivileged user.
RUN useradd --create-home --uid 10001 appuser
WORKDIR /app

COPY --from=builder /install /usr/local
COPY app ./app
COPY migrations ./migrations
COPY templates ./templates
COPY static ./static
COPY alembic.ini docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh && chown -R appuser:appuser /app

USER appuser
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:${PORT}/healthz || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["gunicorn", "app.main:app", \
     "--worker-class", "uvicorn.workers.UvicornWorker", \
     "--bind", "0.0.0.0:8000", "--workers", "4", \
     "--access-logfile", "-", "--error-logfile", "-"]
