/**
 * Lightweight in-process metrics. Good enough to power the health dashboard
 * for a low-traffic internal tool; swap for Prometheus/StatsD if this ever
 * needs to survive restarts or aggregate across replicas.
 */
interface Counters {
  requests: number;
  errors4xx: number;
  errors5xx: number;
}

const startedAt = Date.now();
const counters: Counters = { requests: 0, errors4xx: 0, errors5xx: 0 };

// Rolling per-minute window of request/error counts for a short trend.
const WINDOW_MINUTES = 15;
const buckets: { minute: number; requests: number; errors: number }[] = [];

function currentMinute(): number {
  return Math.floor(Date.now() / 60_000);
}

function bucket() {
  const minute = currentMinute();
  let b = buckets[buckets.length - 1];
  if (!b || b.minute !== minute) {
    b = { minute, requests: 0, errors: 0 };
    buckets.push(b);
    while (buckets.length > WINDOW_MINUTES) buckets.shift();
  }
  return b;
}

export function recordRequest(statusCode: number): void {
  counters.requests++;
  const b = bucket();
  b.requests++;
  if (statusCode >= 500) {
    counters.errors5xx++;
    b.errors++;
  } else if (statusCode >= 400) {
    counters.errors4xx++;
  }
}

export function metricsSnapshot() {
  const recentRequests = buckets.reduce((s, b) => s + b.requests, 0);
  const recentErrors = buckets.reduce((s, b) => s + b.errors, 0);
  const errorRate = recentRequests > 0 ? recentErrors / recentRequests : 0;
  return {
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    totals: { ...counters },
    window: {
      minutes: WINDOW_MINUTES,
      requests: recentRequests,
      serverErrors: recentErrors,
      errorRate: Number(errorRate.toFixed(4)),
    },
    memory: process.memoryUsage(),
  };
}
