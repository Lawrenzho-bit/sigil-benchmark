"""
Production Operations dimension scoring engine.

Implements 10 sub-components per PRS v0.4:
  ops_01: Error handling (fuzz testing) — requires deployment
  ops_02: Observability (structured logs + metrics + traces) — static analysis
  ops_03: Health checks — static + probe
  ops_04: Backup strategy — static
  ops_05: DB connection pooling — static
  ops_06: N+1 query detection — requires deployment
  ops_07: Cache strategy — static
  ops_08: Graceful degradation — requires deployment
  ops_09: Deployment automation (CI/CD) — static
  ops_10: Time correctness (NEW in v0.2) — static + probe

v0 implementation: 6 static-analysis sub-components implemented.
Deployment-requiring sub-components return scaffold scores.
"""

from __future__ import annotations

import logging
import re
import time
from pathlib import Path
from typing import TYPE_CHECKING

from harness.scoring.base import ScoreResult, ScoringEngine, SubComponentScore

if TYPE_CHECKING:
    from harness.deployment.base import DeploymentResult
    from harness.orchestrator import TaskDefinition
    from harness.tools.base import ToolOutput

logger = logging.getLogger(__name__)


# Patterns for static code analysis
OBSERVABILITY_PATTERNS = {
    "structured_logging": [
        r"import\s+logging",
        r"import\s+structlog",
        r"from\s+loguru",
        r"pino\(",
        r"winston\.createLogger",
        r"console\.log\(\s*JSON",
        r"@opentelemetry",
        r"logger\.info\(.*?json",
    ],
    "metrics": [
        r"prometheus_client",
        r"prom-client",
        r"@prometheus/client",
        r"datadog",
        r"DD_API_KEY",
        r"StatsD",
        r"/metrics",
        r"Counter\(",
        r"Gauge\(",
        r"Histogram\(",
    ],
    "tracing": [
        r"@opentelemetry/api",
        r"opentelemetry-",
        r"jaeger",
        r"zipkin",
        r"trace\.start_span",
        r"tracer\.startSpan",
    ],
}

HEALTH_CHECK_PATTERNS = [
    r"['\"]/health['\"]",
    r"['\"]/healthz['\"]",
    r"['\"]/readyz['\"]",
    r"['\"]/livez['\"]",
    r"['\"]/_health['\"]",
    r"['\"]/ping['\"]",
    r"['\"]/status['\"]",
]

DB_POOL_PATTERNS = {
    "explicit_pool": [
        r"pool_size\s*=",
        r"max_overflow\s*=",
        r"poolclass=",
        r"createPool\(",
        r"new\s+Pool\(",
        r"PgBouncer",
        r"pgbouncer",
    ],
    "max_connections": [
        r"max_connections\s*[=:]",
        r"connectionLimit\s*[=:]",
        r"maxConnections\s*[=:]",
    ],
    "timeout": [
        r"pool_timeout",
        r"connectionTimeoutMillis",
        r"idleTimeoutMillis",
        r"connect_timeout",
    ],
}

CACHE_PATTERNS = {
    "cache_layer": [
        r"import\s+redis",
        r"from\s+redis",
        r"redis\.Redis\(",
        r"createClient\(",  # Redis
        r"memcached",
        r"NodeCache",
        r"lru-cache",
        r"cachetools",
    ],
    "ttl": [
        r"setex\(",
        r"\.set\([^)]*EX\s*=",
        r"ttl\s*[=:]",
        r"expire_in",
    ],
    "invalidation": [
        r"\.delete\(",
        r"\.del\(",
        r"flush",
        r"invalidate",
    ],
}

CI_CD_FILES = [
    ".github/workflows",
    ".gitlab-ci.yml",
    ".circleci/config.yml",
    "Jenkinsfile",
    "azure-pipelines.yml",
    "bitbucket-pipelines.yml",
    "buildkite",
    ".buildkite",
]

BACKUP_PATTERNS = [
    r"pg_dump",
    r"mysqldump",
    r"backup",
    r"snapshot",
    r"restore",
    r"point-in-time recovery",
    r"PITR",
    r"barman",
]

TIME_CORRECTNESS = {
    "utc": [
        r"datetime\.utc",
        r"timezone\.utc",
        r"UTC",
        r"timezone\(['\"]UTC['\"]",
        r"new\s+Date\(\)\.toISOString",
        r"new\s+Date\(\)\.getTime",
    ],
    "tz_aware": [
        r"tz_localize",
        r"astimezone",
        r"DateTimeWithZone",
        r"luxon",
        r"date-fns-tz",
        r"moment-timezone",
        r"@js-temporal",
    ],
    "naive_time_red_flag": [
        r"datetime\.now\(\)\s*(?!\.replace\()",  # naive datetime.now() with no tzinfo
        r"new\s+Date\(\)\.toLocaleString\(",
        r"server[_-]?local",
    ],
}


class ProductionOpsScoringEngine(ScoringEngine):
    """Scores the Production Readiness Ops dimension."""

    dimension_id = "production_ops"
    dimension_name = "Production Readiness Ops"

    async def score(
        self,
        deployment: "DeploymentResult",
        task: "TaskDefinition",
        tool_output: "ToolOutput",
    ) -> ScoreResult:
        start = time.monotonic()
        files = tool_output.output_files

        # All static-analysis sub-components run on the parsed files
        sub_scores: list[SubComponentScore] = [
            self._score_observability(files),
            self._score_health_checks(files),
            self._score_backup_strategy(files),
            self._score_db_pooling(files),
            self._score_cache_strategy(files),
            self._score_deployment_automation(files),
            self._score_time_correctness(files),
        ]

        # Deployment-requiring sub-components stubbed
        sub_scores.extend(self._stub_deployment_required())

        dimension_score = sum(s.score for s in sub_scores)

        return ScoreResult(
            dimension_id=self.dimension_id,
            dimension_name=self.dimension_name,
            sub_component_scores=sub_scores,
            dimension_score=dimension_score,
            scoring_duration_seconds=time.monotonic() - start,
        )

    # ----- Sub-components -----

    def _score_observability(self, files: dict[str, str]) -> SubComponentScore:
        """ops_02: Structured logs + metrics + traces."""
        all_code = "\n".join(files.values())

        has_structured = any(
            re.search(p, all_code, re.IGNORECASE) for p in OBSERVABILITY_PATTERNS["structured_logging"]
        )
        has_metrics = any(
            re.search(p, all_code, re.IGNORECASE) for p in OBSERVABILITY_PATTERNS["metrics"]
        )
        has_tracing = any(
            re.search(p, all_code, re.IGNORECASE) for p in OBSERVABILITY_PATTERNS["tracing"]
        )

        # Rubric
        if has_structured and has_metrics and has_tracing:
            score, rubric = 10.0, "Structured logs + metrics + traces"
        elif has_structured and has_metrics:
            score, rubric = 8.0, "Logs + metrics"
        elif has_structured:
            score, rubric = 6.0, "Structured logs only"
        elif "console.log" in all_code or "print(" in all_code:
            score, rubric = 4.0, "Unstructured logs"
        elif "console" in all_code or "print" in all_code:
            score, rubric = 2.0, "Console only"
        else:
            score, rubric = 0.0, "None"

        return SubComponentScore(
            sub_component_id="ops_02_observability",
            name="Observability",
            score=score,
            method="hybrid",
            tool_used="static_pattern_analysis",
            raw_findings={
                "structured_logging": has_structured,
                "metrics": has_metrics,
                "tracing": has_tracing,
            },
            rubric_match=rubric,
        )

    def _score_health_checks(self, files: dict[str, str]) -> SubComponentScore:
        """ops_03: Health check endpoint presence."""
        all_code = "\n".join(files.values())

        endpoints_found = [p for p in HEALTH_CHECK_PATTERNS if re.search(p, all_code)]

        # Check for dependency checks within health endpoint
        has_dep_checks = bool(
            re.search(r"(?i)(health|ready|live).*?(db|database|redis|cache|queue)", all_code)
        )
        has_separate_ready_live = (
            any("readyz" in p or "ready" in p.lower() for p in endpoints_found)
            and any("livez" in p or "live" in p.lower() for p in endpoints_found)
        )

        if endpoints_found and has_dep_checks and has_separate_ready_live:
            score, rubric = 10.0, "/health + dependency checks + readiness/liveness"
        elif endpoints_found and has_dep_checks:
            score, rubric = 8.0, "/health with deps"
        elif endpoints_found:
            score, rubric = 6.0, "/health basic"
        elif re.search(r"@app\.route\([^)]*\).*return\s+['\"]ok", all_code, re.IGNORECASE):
            score, rubric = 4.0, "200-OK endpoint only"
        else:
            score, rubric = 0.0, "None"

        return SubComponentScore(
            sub_component_id="ops_03_health_checks",
            name="Health checks",
            score=score,
            method="hybrid",
            tool_used="static_pattern_analysis",
            raw_findings={
                "endpoints_found": endpoints_found,
                "has_dep_checks": has_dep_checks,
                "has_separate_ready_live": has_separate_ready_live,
            },
            rubric_match=rubric,
        )

    def _score_backup_strategy(self, files: dict[str, str]) -> SubComponentScore:
        """ops_04: Backup strategy."""
        all_text = "\n".join(files.values())
        all_paths = "\n".join(files.keys())

        has_backup_script = any(
            re.search(p, all_text, re.IGNORECASE) for p in BACKUP_PATTERNS
        )
        has_backup_doc = any(
            "backup" in path.lower() or "disaster" in path.lower() or "recovery" in path.lower()
            for path in files.keys()
        )
        has_cron_or_schedule = bool(
            re.search(r"(?i)(cron|schedule|@daily|@hourly|0\s+\*\s+\*)", all_text)
        )
        mentions_restore = bool(re.search(r"(?i)restore|recover", all_text))

        if has_backup_script and has_cron_or_schedule and mentions_restore:
            score, rubric = 8.0, "Automated daily, untested restore"
        elif has_backup_script and has_cron_or_schedule:
            score, rubric = 6.0, "Manual backup process documented"
        elif has_backup_script or has_backup_doc:
            score, rubric = 4.0, "Backup possible but not configured"
        elif "backup" in all_text.lower():
            score, rubric = 2.0, "Mentioned in code"
        else:
            score, rubric = 0.0, "None"

        return SubComponentScore(
            sub_component_id="ops_04_backup_strategy",
            name="Backup strategy",
            score=score,
            method="manual_review",
            tool_used="static_pattern_analysis",
            raw_findings={
                "has_backup_script": has_backup_script,
                "has_backup_doc": has_backup_doc,
                "has_schedule": has_cron_or_schedule,
                "mentions_restore": mentions_restore,
            },
            rubric_match=rubric,
            notes="Static analysis only; manual review needed to verify backups actually run",
        )

    def _score_db_pooling(self, files: dict[str, str]) -> SubComponentScore:
        """ops_05: Database connection pooling."""
        all_code = "\n".join(files.values())

        has_explicit_pool = any(
            re.search(p, all_code) for p in DB_POOL_PATTERNS["explicit_pool"]
        )
        has_max_connections = any(
            re.search(p, all_code) for p in DB_POOL_PATTERNS["max_connections"]
        )
        has_timeout = any(re.search(p, all_code) for p in DB_POOL_PATTERNS["timeout"])

        if has_explicit_pool and has_max_connections and has_timeout:
            score, rubric = 10.0, "Pool sized + max connections + timeout"
        elif has_explicit_pool:
            score, rubric = 8.0, "Pool configured"
        elif re.search(r"(?i)(sqlalchemy|prisma|drizzle|knex|pg|psycopg)", all_code):
            score, rubric = 6.0, "Default pool used"
        elif re.search(r"(?i)create_engine|new\s+Client\(", all_code):
            score, rubric = 4.0, "Connection per request"
        else:
            score, rubric = 0.0, "Single connection"

        return SubComponentScore(
            sub_component_id="ops_05_db_pooling",
            name="DB connection pooling",
            score=score,
            method="hybrid",
            tool_used="static_pattern_analysis",
            raw_findings={
                "explicit_pool": has_explicit_pool,
                "max_connections": has_max_connections,
                "timeout": has_timeout,
            },
            rubric_match=rubric,
        )

    def _score_cache_strategy(self, files: dict[str, str]) -> SubComponentScore:
        """ops_07: Cache strategy."""
        all_code = "\n".join(files.values())

        has_cache = any(re.search(p, all_code) for p in CACHE_PATTERNS["cache_layer"])
        has_ttl = any(re.search(p, all_code) for p in CACHE_PATTERNS["ttl"])
        has_invalidation = any(
            re.search(p, all_code) for p in CACHE_PATTERNS["invalidation"]
        )

        if has_cache and has_ttl and has_invalidation:
            score, rubric = 10.0, "Cache + TTL + invalidation strategy"
        elif has_cache and has_ttl:
            score, rubric = 8.0, "Cache with TTL"
        elif has_cache:
            score, rubric = 6.0, "Cache layer present but minimal"
        elif re.search(r"Cache-Control|max-age", all_code, re.IGNORECASE):
            score, rubric = 4.0, "HTTP caching only"
        elif re.search(r"Cache-Control:\s*no-cache", all_code, re.IGNORECASE):
            score, rubric = 2.0, "No-cache headers"
        else:
            score, rubric = 0.0, "None"

        return SubComponentScore(
            sub_component_id="ops_07_cache_strategy",
            name="Cache strategy",
            score=score,
            method="hybrid",
            tool_used="static_pattern_analysis",
            raw_findings={
                "cache_layer": has_cache,
                "ttl": has_ttl,
                "invalidation": has_invalidation,
            },
            rubric_match=rubric,
        )

    def _score_deployment_automation(self, files: dict[str, str]) -> SubComponentScore:
        """ops_09: CI/CD configuration."""
        has_ci_file = any(
            any(ci_path in file_path for file_path in files.keys())
            for ci_path in CI_CD_FILES
        )

        all_code = "\n".join(files.values())
        has_cd = bool(
            re.search(r"(?i)(deploy|release|publish)", "\n".join(files.keys()))
            or re.search(r"(?i)(modal\s+deploy|fly\s+deploy|kubectl\s+apply)", all_code)
        )
        has_rollback = bool(re.search(r"(?i)rollback|revert", all_code))

        if has_ci_file and has_cd and has_rollback:
            score, rubric = 10.0, "CI + CD + rollback configured"
        elif has_ci_file and has_cd:
            score, rubric = 8.0, "CI + CD"
        elif has_ci_file:
            score, rubric = 6.0, "CI only"
        elif (
            "Makefile" in files
            or any("build" in p.lower() for p in files.keys())
        ):
            score, rubric = 4.0, "Build scripts only"
        elif any("DEPLOY" in p.upper() for p in files.keys()):
            score, rubric = 2.0, "Documented manual process"
        else:
            score, rubric = 0.0, "Nothing"

        return SubComponentScore(
            sub_component_id="ops_09_deployment_automation",
            name="Deployment automation",
            score=score,
            method="hybrid",
            tool_used="static_pattern_analysis",
            raw_findings={
                "has_ci_file": has_ci_file,
                "has_cd": has_cd,
                "has_rollback": has_rollback,
            },
            rubric_match=rubric,
        )

    def _score_time_correctness(self, files: dict[str, str]) -> SubComponentScore:
        """ops_10: Time correctness (UTC storage + TZ display + DST-aware)."""
        all_code = "\n".join(files.values())

        has_utc = any(re.search(p, all_code) for p in TIME_CORRECTNESS["utc"])
        has_tz_aware = any(re.search(p, all_code) for p in TIME_CORRECTNESS["tz_aware"])
        has_naive = any(re.search(p, all_code) for p in TIME_CORRECTNESS["naive_time_red_flag"])

        if has_utc and has_tz_aware and not has_naive:
            score, rubric = 10.0, "UTC stored, displayed in user TZ, DST-aware"
        elif has_utc and has_tz_aware:
            score, rubric = 8.0, "UTC storage + TZ display"
        elif has_utc:
            score, rubric = 6.0, "UTC storage only"
        elif has_naive:
            score, rubric = 4.0, "Server-local time used"
        elif "datetime" in all_code.lower() or "Date" in all_code:
            score, rubric = 2.0, "Mixed TZ handling"
        else:
            score, rubric = 0.0, "TZ ignored"

        return SubComponentScore(
            sub_component_id="ops_10_time_correctness",
            name="Time correctness",
            score=score,
            method="automated",
            tool_used="static_pattern_analysis",
            raw_findings={
                "utc": has_utc,
                "tz_aware": has_tz_aware,
                "naive_red_flag": has_naive,
            },
            rubric_match=rubric,
        )

    def _stub_deployment_required(self) -> list[SubComponentScore]:
        """Sub-components requiring active deployment, stubbed for v0."""
        stubs = [
            ("ops_01_error_handling", "Error handling (fuzz testing)", "harness_fuzzer"),
            ("ops_06_n_plus_one", "N+1 query detection", "query_analyzer"),
            ("ops_08_graceful_degradation", "Graceful degradation", "chaos_test"),
        ]
        return [
            SubComponentScore(
                sub_component_id=sub_id,
                name=name,
                score=0.0,
                method="automated",
                tool_used=tool,
                notes=(
                    "v0 scaffold: requires active deployment to test. "
                    "Returns 0 until deployment harness is operational."
                ),
            )
            for sub_id, name, tool in stubs
        ]
