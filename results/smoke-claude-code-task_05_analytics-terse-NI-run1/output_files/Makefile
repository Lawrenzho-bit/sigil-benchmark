.PHONY: help up down logs build test lint seed loadtest fmt

help:
	@echo "up        - start the full stack (db, redis, api, worker, monitoring)"
	@echo "down      - stop the stack and remove volumes"
	@echo "logs      - tail all service logs"
	@echo "build     - build the application image"
	@echo "test      - run the unit test suite"
	@echo "lint      - run ruff"
	@echo "seed      - generate demo tenant + historical events"
	@echo "loadtest  - fire synthetic events at the ingestion API"

up:
	docker compose up -d --build

down:
	docker compose down -v

logs:
	docker compose logs -f

build:
	docker compose build

test:
	pytest -q -m "not integration"

lint:
	ruff check .

fmt:
	ruff check --fix .

seed:
	python -m scripts.seed

loadtest:
	python -m scripts.loadtest
