"""
Dockerfile auto-generation.

When a tool's output doesn't include a Dockerfile, this module
detects the stack from the file layout and generates one.

Stack detection priority:
  1. package.json (Node.js — Next.js / Express / etc.)
  2. pyproject.toml or requirements.txt (Python — FastAPI / Django / Flask)
  3. Gemfile (Ruby — Rails / Sinatra)
  4. go.mod (Go)
  5. Cargo.toml (Rust)
  6. composer.json (PHP)
  7. Fallback: generic Alpine + serve static

Each generated Dockerfile aims for v0.4 §5.7 (Container Readiness) sub-component
to pass at score 6+ ("Dockerfile basic").
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass


@dataclass
class StackDetection:
    """Detected stack characteristics from tool output files."""

    language: str  # "node" | "python" | "ruby" | "go" | "rust" | "php" | "unknown"
    framework: str | None = None
    package_manager: str | None = None
    entry_point: str | None = None
    needs_build: bool = False
    port: int = 8080


def detect_stack(files: dict[str, str]) -> StackDetection:
    """Detect the stack from file layout."""

    # Node.js
    if "package.json" in files or any(p.endswith("/package.json") for p in files):
        pkg_content = files.get("package.json", "")
        if not pkg_content:
            pkg_content = next(
                (v for k, v in files.items() if k.endswith("package.json")),
                "{}",
            )
        try:
            pkg = json.loads(pkg_content)
        except json.JSONDecodeError:
            pkg = {}

        deps = {**(pkg.get("dependencies") or {}), **(pkg.get("devDependencies") or {})}
        scripts = pkg.get("scripts", {})

        framework = None
        if "next" in deps:
            framework = "next"
        elif "@remix-run/serve" in deps or "@remix-run/dev" in deps:
            framework = "remix"
        elif "express" in deps:
            framework = "express"
        elif "fastify" in deps:
            framework = "fastify"
        elif "nestjs" in str(deps) or "@nestjs/core" in deps:
            framework = "nestjs"
        elif "hono" in deps:
            framework = "hono"

        # Detect package manager from lockfile
        package_manager = "npm"
        if any(p.endswith("pnpm-lock.yaml") for p in files):
            package_manager = "pnpm"
        elif any(p.endswith("yarn.lock") for p in files):
            package_manager = "yarn"
        elif any(p.endswith("bun.lockb") for p in files):
            package_manager = "bun"

        needs_build = "build" in scripts
        return StackDetection(
            language="node",
            framework=framework,
            package_manager=package_manager,
            entry_point=scripts.get("start") or scripts.get("dev"),
            needs_build=needs_build,
            port=3000 if framework in ("next", "remix") else 8080,
        )

    # Python
    is_python = any(
        p.endswith(("pyproject.toml", "requirements.txt", "setup.py", "Pipfile"))
        for p in files
    )
    if is_python:
        all_text = "\n".join(files.values())
        framework = None
        if "fastapi" in all_text.lower():
            framework = "fastapi"
        elif "django" in all_text.lower():
            framework = "django"
        elif "flask" in all_text.lower():
            framework = "flask"
        elif "starlette" in all_text.lower():
            framework = "starlette"

        package_manager = "pip"
        if any(p.endswith("pyproject.toml") for p in files):
            content = next(
                (v for k, v in files.items() if k.endswith("pyproject.toml")), ""
            )
            if "poetry" in content:
                package_manager = "poetry"
            elif "[tool.uv]" in content or "uv.lock" in str(files.keys()):
                package_manager = "uv"
            elif "hatch" in content:
                package_manager = "hatch"

        return StackDetection(
            language="python",
            framework=framework,
            package_manager=package_manager,
            port=8000,
        )

    # Ruby
    if "Gemfile" in files:
        return StackDetection(language="ruby", framework="rails", package_manager="bundler", port=3000)

    # Go
    if "go.mod" in files:
        return StackDetection(language="go", package_manager="go-mod", needs_build=True, port=8080)

    # Rust
    if "Cargo.toml" in files:
        return StackDetection(language="rust", package_manager="cargo", needs_build=True, port=8080)

    # PHP
    if "composer.json" in files:
        return StackDetection(language="php", framework="laravel", package_manager="composer", port=8000)

    return StackDetection(language="unknown", port=8080)


def generate_dockerfile(detection: StackDetection) -> str:
    """Generate a Dockerfile appropriate to the detected stack."""

    if detection.language == "node":
        return _node_dockerfile(detection)
    if detection.language == "python":
        return _python_dockerfile(detection)
    if detection.language == "ruby":
        return _ruby_dockerfile(detection)
    if detection.language == "go":
        return _go_dockerfile(detection)
    if detection.language == "rust":
        return _rust_dockerfile(detection)
    if detection.language == "php":
        return _php_dockerfile(detection)

    # Fallback
    return _generic_dockerfile(detection)


# ----- Per-stack Dockerfile templates -----


def _node_dockerfile(d: StackDetection) -> str:
    pm = d.package_manager or "npm"
    install_cmd = {
        "npm": "npm ci --omit=dev",
        "pnpm": "pnpm install --frozen-lockfile --prod",
        "yarn": "yarn install --frozen-lockfile --production",
        "bun": "bun install --frozen-lockfile --production",
    }.get(pm, "npm install")

    build_cmd = ""
    if d.needs_build:
        build_install_cmd = install_cmd.replace(" --omit=dev", "").replace(" --production", "")
        build_cmd = f"""
# Build stage
COPY . .
RUN {pm} run build
"""

    start_cmd = "node ."
    if d.framework == "next":
        start_cmd = "node node_modules/next/dist/bin/next start"
    elif d.framework == "remix":
        start_cmd = "node node_modules/@remix-run/serve/dist/cli.js build/index.js"
    elif d.framework in ("express", "fastify", "hono", "nestjs"):
        start_cmd = f"node {d.entry_point or 'index.js'}".replace("node node ", "node ")

    return f"""# Sigil Benchmark auto-generated Dockerfile (Node/{d.framework or 'generic'})
FROM node:20-alpine AS base
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN {install_cmd}

{build_cmd}

EXPOSE {d.port}
ENV PORT={d.port}
ENV NODE_ENV=production

# Health check (Sigil benchmark probes /health or /)
HEALTHCHECK --interval=10s --timeout=5s --retries=3 \\
  CMD wget --quiet --spider http://localhost:{d.port}/health || \\
      wget --quiet --spider http://localhost:{d.port}/ || exit 1

CMD {json.dumps(start_cmd.split())}
"""


def _python_dockerfile(d: StackDetection) -> str:
    pm = d.package_manager or "pip"

    if pm == "poetry":
        install_block = """
RUN pip install poetry==1.7.1
COPY pyproject.toml poetry.lock* ./
RUN poetry config virtualenvs.create false && \\
    poetry install --no-dev --no-interaction
"""
    elif pm == "uv":
        install_block = """
RUN pip install uv
COPY pyproject.toml uv.lock* ./
RUN uv pip install --system --no-cache .
"""
    else:
        install_block = """
COPY requirements*.txt ./
RUN pip install --no-cache-dir -r requirements.txt
"""

    framework_cmd = {
        "fastapi": f"uvicorn main:app --host 0.0.0.0 --port {d.port}",
        "django": f"gunicorn --bind 0.0.0.0:{d.port} wsgi:application",
        "flask": f"gunicorn --bind 0.0.0.0:{d.port} app:app",
        "starlette": f"uvicorn main:app --host 0.0.0.0 --port {d.port}",
    }.get(d.framework or "", f"python -m http.server {d.port}")

    return f"""# Sigil Benchmark auto-generated Dockerfile (Python/{d.framework or 'generic'})
FROM python:3.11-slim
WORKDIR /app

{install_block}

COPY . .

EXPOSE {d.port}
ENV PORT={d.port}
ENV PYTHONUNBUFFERED=1

HEALTHCHECK --interval=10s --timeout=5s --retries=3 \\
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:{d.port}/health', timeout=2)" || \\
      python -c "import urllib.request; urllib.request.urlopen('http://localhost:{d.port}/', timeout=2)" || exit 1

CMD ["sh", "-c", "{framework_cmd}"]
"""


def _ruby_dockerfile(d: StackDetection) -> str:
    return f"""# Sigil Benchmark auto-generated Dockerfile (Ruby/Rails)
FROM ruby:3.3-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \\
    build-essential libpq-dev nodejs && rm -rf /var/lib/apt/lists/*

COPY Gemfile Gemfile.lock ./
RUN bundle install --without development test

COPY . .

EXPOSE {d.port}
ENV RAILS_ENV=production

HEALTHCHECK --interval=10s --timeout=5s --retries=3 \\
  CMD curl --fail http://localhost:{d.port}/up || exit 1

CMD ["bundle", "exec", "rails", "server", "-b", "0.0.0.0"]
"""


def _go_dockerfile(d: StackDetection) -> str:
    return f"""# Sigil Benchmark auto-generated Dockerfile (Go)
FROM golang:1.22-alpine AS builder
WORKDIR /build
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /app .

FROM alpine:3.19
WORKDIR /app
COPY --from=builder /app /app
EXPOSE {d.port}
ENV PORT={d.port}
HEALTHCHECK --interval=10s --timeout=5s --retries=3 \\
  CMD wget --quiet --spider http://localhost:{d.port}/health || exit 1
CMD ["/app"]
"""


def _rust_dockerfile(d: StackDetection) -> str:
    return f"""# Sigil Benchmark auto-generated Dockerfile (Rust)
FROM rust:1.78 AS builder
WORKDIR /build
COPY Cargo.toml Cargo.lock* ./
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /build/target/release/app /app/app
EXPOSE {d.port}
HEALTHCHECK --interval=10s --timeout=5s --retries=3 \\
  CMD wget --quiet --spider http://localhost:{d.port}/health || exit 1
CMD ["/app/app"]
"""


def _php_dockerfile(d: StackDetection) -> str:
    return f"""# Sigil Benchmark auto-generated Dockerfile (PHP/Laravel)
FROM php:8.3-fpm-alpine
WORKDIR /app
RUN apk add --no-cache nginx
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
COPY composer.json composer.lock ./
RUN composer install --no-dev --optimize-autoloader
COPY . .
EXPOSE {d.port}
HEALTHCHECK --interval=10s --timeout=5s --retries=3 \\
  CMD curl --fail http://localhost:{d.port}/up || exit 1
CMD ["php", "-S", "0.0.0.0:{d.port}", "-t", "public"]
"""


def _generic_dockerfile(d: StackDetection) -> str:
    return f"""# Sigil Benchmark auto-generated Dockerfile (generic fallback)
FROM alpine:3.19
WORKDIR /app
COPY . .
EXPOSE {d.port}
HEALTHCHECK --interval=10s --timeout=5s --retries=3 \\
  CMD true
CMD ["sh", "-c", "echo 'No entry point detected'; sleep infinity"]
"""
