"""Event ingestion API.

Designed for ~1k events/sec: the request handler only validates and pushes
events onto a Redis stream. Durable storage happens asynchronously in the worker.
"""
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from .auth import require_api_tenant
from .config import settings
from .metrics import events_ingested
from .models import EventBatch
from .rate_limit import check_rate_limit
from .redis_client import get_redis

router = APIRouter(prefix="/api", tags=["ingestion"])


@router.post("/events", status_code=202)
async def ingest_events(batch: EventBatch, tenant_id: int = Depends(require_api_tenant)):
    """Accept a batch of events for the authenticated tenant."""
    await check_rate_limit(f"ingest:{tenant_id}", settings.ingest_rate_limit, 1)

    redis = get_redis()
    pipe = redis.pipeline(transaction=False)
    now = datetime.now(timezone.utc)

    for event in batch.events:
        ts = event.ts or now
        pipe.xadd(
            settings.ingest_stream,
            {
                "tenant_id": str(tenant_id),
                "ts": ts.isoformat(),
                "event_type": event.event_type,
                "value": str(event.value),
                "metadata": json.dumps(event.metadata),
            },
            maxlen=settings.ingest_stream_maxlen,
            approximate=True,
        )
    await pipe.execute()

    events_ingested.labels(tenant=str(tenant_id)).inc(len(batch.events))
    return {"accepted": len(batch.events)}
