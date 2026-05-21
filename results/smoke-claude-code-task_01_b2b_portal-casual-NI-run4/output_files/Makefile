.PHONY: help install dev migrate seed test lint typecheck up down logs

help:
	@grep -E '^[a-zA-Z_-]+:.*?# .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?# "}; {printf "  %-12s %s\n", $$1, $$2}'

install:        # Install runtime + dev dependencies
	pip install -r requirements-dev.txt

dev:            # Run the app locally with autoreload
	uvicorn app.main:app --reload

migrate:        # Apply database migrations
	alembic upgrade head

seed:           # Load demo organization + users
	python -m app.seed

test:           # Run the test suite
	pytest -q

lint:           # Lint with ruff
	ruff check app tests

typecheck:      # Static type-check with mypy
	mypy app

up:             # Start the full stack in Docker
	docker compose up --build

down:           # Stop the Docker stack
	docker compose down

logs:           # Tail application logs
	docker compose logs -f app
