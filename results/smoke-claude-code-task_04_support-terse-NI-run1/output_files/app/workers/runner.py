"""Entrypoint for the RQ worker container.

Workers consume jobs from the default queue: outbound email retries,
attachment processing, CSAT dispatch, etc.
"""

import structlog
from redis import Redis
from rq import Connection, Worker

from app.config import get_settings

log = structlog.get_logger(__name__)


def main() -> None:
    settings = get_settings()
    log.info("worker.start", redis=settings.redis_url)
    with Connection(Redis.from_url(settings.redis_url)):
        Worker(["default", "outbound-email", "csat"]).work(with_scheduler=True)


if __name__ == "__main__":
    main()
