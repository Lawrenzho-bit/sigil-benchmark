# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# Multi-stage build. The builder compiles wheels (including python3-saml,
# which needs libxmlsec headers); the runtime image stays slim and runs as a
# non-root user.
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS builder

ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1

# Build-time system libs for lxml / xmlsec (python3-saml).
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential pkg-config \
        libxml2-dev libxmlsec1-dev libxmlsec1-openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /wheels
COPY requirements.txt requirements-saml.txt ./
RUN pip wheel --wheel-dir /wheels -r requirements.txt -r requirements-saml.txt


FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8000

# Runtime shared libraries only (no -dev / compilers).
RUN apt-get update && apt-get install -y --no-install-recommends \
        libxml2 libxmlsec1 libxmlsec1-openssl curl \
    && rm -rf /var/lib/apt/lists/*

# Install pre-built wheels.
COPY --from=builder /wheels /wheels
COPY requirements.txt requirements-saml.txt ./
RUN pip install --no-index --find-links=/wheels \
        -r requirements.txt -r requirements-saml.txt \
    && rm -rf /wheels requirements*.txt

# Run as an unprivileged user.
RUN useradd --create-home --uid 10001 appuser
WORKDIR /app
COPY --chown=appuser:appuser . .
RUN chmod +x docker-entrypoint.sh && mkdir -p /app/exports && chown appuser /app/exports
USER appuser

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:${PORT}/healthz || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
