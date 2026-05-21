"""Prometheus metrics."""
from prometheus_client import Counter, Gauge, Histogram

events_ingested = Counter(
    "analytics_events_ingested_total", "Events accepted by the ingestion API", ["tenant"]
)
events_persisted = Counter(
    "analytics_events_persisted_total", "Events written to time-series storage"
)
rollups_computed = Counter(
    "analytics_rollups_computed_total", "Rollup computation passes", ["granularity"]
)
request_latency = Histogram(
    "analytics_request_latency_seconds", "HTTP request latency", ["endpoint"]
)
active_streams = Gauge(
    "analytics_active_streams", "Currently connected SSE dashboard clients"
)
ingest_queue_depth = Gauge(
    "analytics_ingest_queue_depth", "Unprocessed entries in the ingest stream"
)
