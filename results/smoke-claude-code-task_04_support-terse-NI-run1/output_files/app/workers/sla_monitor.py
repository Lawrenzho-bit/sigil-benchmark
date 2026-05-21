"""Long-running SLA breach monitor.

Polls `sla_targets` for past-due unmet clocks, marks them breached, and emits
alerts. Uses a Redis lease so only one instance is active even if the deployment
has multiple replicas.
"""

import time
from datetime import datetime, timezone

import structlog
from redis import Redis

from app.config import get_settings
from app.db import SessionLocal
from app.services import audit, sla_engine

log = structlog.get_logger(__name__)
settings = get_settings()

LEASE_KEY = "lease:sla_monitor"
LEASE_TTL_S = 30
POLL_INTERVAL_S = 15


def _acquire_lease(r: Redis, owner: str) -> bool:
    return bool(r.set(LEASE_KEY, owner, ex=LEASE_TTL_S, nx=True))


def _renew_lease(r: Redis, owner: str) -> bool:
    val = r.get(LEASE_KEY)
    if val and val.decode() == owner:
        r.expire(LEASE_KEY, LEASE_TTL_S)
        return True
    return False


def _alert(target) -> None:
    log.warning(
        "sla.breach",
        ticket_id=str(target.ticket_id),
        kind=target.kind.value,
        due_at=target.due_at.isoformat(),
    )
    # TODO: dispatch to Slack/Pagerduty via a job (out of scope for this PR).


def tick() -> int:
    """One sweep — returns number of breaches alerted."""
    db = SessionLocal()
    try:
        breached = sla_engine.find_breached(db)
        now = datetime.now(timezone.utc)
        for target in breached:
            target.breached = True
            target.breach_alerted_at = now
            audit.record(
                db,
                actor_type="system",
                actor_id=None,
                action="sla.breach",
                target_type="ticket",
                target_id=str(target.ticket_id),
                metadata={"kind": target.kind.value, "due_at": target.due_at.isoformat()},
            )
            _alert(target)
        db.commit()
        return len(breached)
    finally:
        db.close()


def main() -> None:
    import os
    import uuid

    owner = f"{os.getpid()}-{uuid.uuid4().hex[:8]}"
    r = Redis.from_url(settings.redis_url)
    log.info("sla_monitor.start", owner=owner)
    while True:
        if _acquire_lease(r, owner) or _renew_lease(r, owner):
            n = tick()
            if n:
                log.info("sla_monitor.swept", breached=n)
        time.sleep(POLL_INTERVAL_S)


if __name__ == "__main__":
    main()
