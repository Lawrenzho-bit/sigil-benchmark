"""
Scalability dimension scoring engine.

Implements 10 sub-components per PRS v0.4:
  scale_01: Load test 1k concurrent     — requires deployment
  scale_02: Load test 10k concurrent    — requires deployment
  scale_03: Async processing            — static analysis
  scale_04: Background job system       — static analysis
  scale_05: Read replica support        — static analysis
  scale_06: Stateless architecture      — static analysis
  scale_07: Container readiness         — static analysis (Dockerfile + 12-factor)
  scale_08: Auto-scaling config         — static analysis
  scale_09: CDN configuration           — static analysis
  scale_10: Database indexing           — static analysis

v0 implementation: 8 static-analysis sub-components implemented.
Load tests (scale_01, scale_02) require live deployment + k6.
"""

from __future__ import annotations

import logging
import re
import time
from typing import TYPE_CHECKING

from harness.scoring.base import ScoreResult, ScoringEngine, SubComponentScore

if TYPE_CHECKING:
    from harness.deployment.base import DeploymentResult
    from harness.orchestrator import TaskDefinition
    from harness.tools.base import ToolOutput

logger = logging.getLogger(__name__)


ASYNC_PATTERNS = {
    "async_awaiting": [
        r"async\s+def\s+",
        r"async\s+function\s+",
        r"\.then\(",
        r"await\s+",
        r"Promise\.",
    ],
    "queue_dispatch": [
        r"queue\.publish",
        r"queue\.put",
        r"\.dispatch\(",
        r"\.enqueue\(",
        r"send_message\(",
        r"publish\(",
    ],
}

BG_JOB_PATTERNS = {
    "robust": [
        r"bullmq",
        r"bull\(",
        r"trigger\.dev",
        r"@trigger\.dev",
        r"sidekiq",
        r"resque",
        r"celery",
        r"hatchet",
        r"temporal",
        r"inngest",
    ],
    "simple_queue": [
        r"redis.*lpush",
        r"rabbitmq",
        r"amqp",
        r"@sqs",
        r"aws-sdk.*sqs",
        r"google-cloud-tasks",
    ],
    "dead_letter_queue": [
        r"dead-?letter",
        r"DLQ",
        r"dlq",
        r"redrive",
    ],
    "cron_based": [
        r"cron",
        r"setInterval",
        r"node-schedule",
        r"APScheduler",
    ],
}

READ_REPLICA_PATTERNS = [
    r"read[_-]?replica",
    r"readReplica",
    r"replica[_-]?host",
    r"readonly[_-]?db",
    r"DATABASE_REPLICA",
    r"@@\s*role\s*=\s*['\"]?reader",
    r"replica_url",
]

STATEFUL_RED_FLAGS = [
    r"session\[",
    r"req\.session\s*=",
    r"global\s+state",
    r"app\.locals\[",
    r"in-memory.*cache",
    r"setInterval\(.*?\d+\)",  # Singleton recurring jobs
]

STATELESS_PATTERNS = [
    r"jwt",
    r"JWT",
    r"redis.*session",
    r"redis-?session",
    r"connect-redis",
    r"@fastify\/session.*redis",
    r"sessionStore.*redis",
    r"DynamoDB.*session",
]

TWELVE_FACTOR_PATTERNS = {
    "config_in_env": [
        r"process\.env\.",
        r"os\.environ\.",
        r"os\.getenv\(",
        r"dotenv",
    ],
    "logs_to_stdout": [
        r"console\.log",
        r"print\(",
        r"logger\.",
        r"stdout",
    ],
    "stateless_processes": [
        r"@app\.before_first_request",
        r"app\.use\(",  # Express-style middleware
    ],
}

AUTOSCALING_PATTERNS = [
    r"HorizontalPodAutoscaler",
    r"hpa",
    r"autoscaling\.",
    r"min_replicas",
    r"max_replicas",
    r"min_containers",
    r"max_containers",
    r"@modal\.web_endpoint",
    r"fly\.toml.*\[\[services\]\]",
    r"vercel\.json.*\"functions\"",
]

CDN_PATTERNS = [
    r"cloudflare",
    r"cloudfront",
    r"fastly",
    r"vercel\s+edge",
    r"@vercel\/edge",
    r"_static\/.*\.js",
    r"netlify\s+edge",
    r"bunny\s*cdn",
]

DB_INDEX_PATTERNS = [
    r"CREATE\s+INDEX",
    r"@@index\(",  # Prisma
    r"@Index\(",  # TypeORM
    r"index=True",  # SQLAlchemy
    r"db\.Index\(",  # Django
    r"\.index\(",  # Drizzle
    r"add_index",  # Rails migrations
]


class ScalabilityScoringEngine(ScoringEngine):
    """Scores the Scalability dimension."""

    dimension_id = "scalability"
    dimension_name = "Scalability"

    async def score(
        self,
        deployment: "DeploymentResult",
        task: "TaskDefinition",
        tool_output: "ToolOutput",
    ) -> ScoreResult:
        start = time.monotonic()
        files = tool_output.output_files

        sub_scores: list[SubComponentScore] = [
            self._score_async_processing(files),
            self._score_background_jobs(files),
            self._score_read_replica(files),
            self._score_stateless(files),
            self._score_container_readiness(files),
            self._score_autoscaling(files),
            self._score_cdn(files),
            self._score_db_indexing(files),
        ]

        sub_scores.extend(self._stub_load_tests())

        dimension_score = sum(s.score for s in sub_scores)

        return ScoreResult(
            dimension_id=self.dimension_id,
            dimension_name=self.dimension_name,
            sub_component_scores=sub_scores,
            dimension_score=dimension_score,
            scoring_duration_seconds=time.monotonic() - start,
        )

    # ----- Sub-components -----

    def _score_async_processing(self, files: dict[str, str]) -> SubComponentScore:
        """scale_03: Async processing for slow operations."""
        all_code = "\n".join(files.values())

        async_count = sum(
            len(re.findall(p, all_code)) for p in ASYNC_PATTERNS["async_awaiting"]
        )
        has_queue_dispatch = any(re.search(p, all_code) for p in ASYNC_PATTERNS["queue_dispatch"])

        if async_count > 20 and has_queue_dispatch:
            score, rubric = 10.0, "Queue + workers for all >500ms ops"
        elif async_count > 10 and has_queue_dispatch:
            score, rubric = 8.0, "Queue for most slow ops"
        elif async_count > 5:
            score, rubric = 6.0, "Some async"
        elif async_count > 0:
            score, rubric = 4.0, "Sync but non-blocking"
        elif re.search(r"thread|Thread\(", all_code):
            score, rubric = 2.0, "Blocking but threaded"
        else:
            score, rubric = 0.0, "Single-threaded sync"

        return SubComponentScore(
            sub_component_id="scale_03_async_processing",
            name="Async processing",
            score=score,
            method="automated",
            tool_used="static_pattern_analysis",
            raw_findings={"async_count": async_count, "queue_dispatch": has_queue_dispatch},
            rubric_match=rubric,
        )

    def _score_background_jobs(self, files: dict[str, str]) -> SubComponentScore:
        """scale_04: Background job system."""
        all_code = "\n".join(files.values())

        has_robust = any(re.search(p, all_code, re.IGNORECASE) for p in BG_JOB_PATTERNS["robust"])
        has_simple = any(re.search(p, all_code, re.IGNORECASE) for p in BG_JOB_PATTERNS["simple_queue"])
        has_dlq = any(re.search(p, all_code, re.IGNORECASE) for p in BG_JOB_PATTERNS["dead_letter_queue"])
        has_cron = any(re.search(p, all_code, re.IGNORECASE) for p in BG_JOB_PATTERNS["cron_based"])
        has_retry = bool(re.search(r"(?i)retry|backoff|@retry", all_code))

        if has_robust and has_retry and has_dlq:
            score, rubric = 10.0, "Robust system + retry + DLQ"
        elif has_robust and has_retry:
            score, rubric = 8.0, "Robust system, no DLQ"
        elif has_robust or has_simple:
            score, rubric = 6.0, "Simple queue"
        elif has_cron:
            score, rubric = 4.0, "Cron-based"
        elif re.search(r"setInterval\(", all_code):
            score, rubric = 2.0, "setInterval-based"
        else:
            score, rubric = 0.0, "None"

        return SubComponentScore(
            sub_component_id="scale_04_background_jobs",
            name="Background job system",
            score=score,
            method="automated",
            tool_used="static_pattern_analysis",
            raw_findings={
                "robust_system": has_robust,
                "simple_queue": has_simple,
                "dlq": has_dlq,
                "cron_based": has_cron,
                "retry_logic": has_retry,
            },
            rubric_match=rubric,
        )

    def _score_read_replica(self, files: dict[str, str]) -> SubComponentScore:
        """scale_05: Read replica support."""
        all_code = "\n".join(files.values())

        has_replica_config = any(re.search(p, all_code, re.IGNORECASE) for p in READ_REPLICA_PATTERNS)
        has_db_router = bool(
            re.search(r"(?i)(database_router|db_router|read_db|write_db|primary_db)", all_code)
        )
        has_db_abstraction = bool(
            re.search(r"(?i)(orm|sqlalchemy|prisma|drizzle|typeorm|knex)", all_code)
        )

        if has_replica_config and has_db_router:
            score, rubric = 10.0, "R/W split via config"
        elif has_replica_config:
            score, rubric = 8.0, "Replica supported, not configured"
        elif has_db_abstraction:
            score, rubric = 6.0, "Possible with minor refactor"
        elif re.search(r"(?i)(pg|psycopg|mysql)", all_code):
            score, rubric = 4.0, "Possible with significant refactor"
        else:
            score, rubric = 2.0, "Mostly compatible"

        return SubComponentScore(
            sub_component_id="scale_05_read_replica",
            name="Read replica support",
            score=score,
            method="automated",
            tool_used="static_pattern_analysis",
            raw_findings={
                "replica_config": has_replica_config,
                "db_router": has_db_router,
                "db_abstraction": has_db_abstraction,
            },
            rubric_match=rubric,
        )

    def _score_stateless(self, files: dict[str, str]) -> SubComponentScore:
        """scale_06: Stateless architecture."""
        all_code = "\n".join(files.values())

        stateful_red_flags = sum(
            len(re.findall(p, all_code, re.IGNORECASE)) for p in STATEFUL_RED_FLAGS
        )
        has_external_session = any(
            re.search(p, all_code, re.IGNORECASE) for p in STATELESS_PATTERNS
        )

        if has_external_session and stateful_red_flags == 0:
            score, rubric = 10.0, "No local state, session in store"
        elif has_external_session and stateful_red_flags <= 2:
            score, rubric = 8.0, "95%+ stateless"
        elif has_external_session:
            score, rubric = 6.0, "Mixed"
        elif stateful_red_flags <= 3:
            score, rubric = 4.0, "Mostly stateful"
        elif stateful_red_flags <= 6:
            score, rubric = 2.0, "Heavy local state"
        else:
            score, rubric = 0.0, "All state local"

        return SubComponentScore(
            sub_component_id="scale_06_stateless",
            name="Stateless architecture",
            score=score,
            method="automated",
            tool_used="static_pattern_analysis",
            raw_findings={
                "stateful_red_flags": stateful_red_flags,
                "external_session": has_external_session,
            },
            rubric_match=rubric,
        )

    def _score_container_readiness(self, files: dict[str, str]) -> SubComponentScore:
        """scale_07: Container readiness + 12-factor compliance."""
        has_dockerfile = "Dockerfile" in files or any(
            p == "Dockerfile" or p.endswith("/Dockerfile") for p in files.keys()
        )

        all_code = "\n".join(files.values())
        factors_satisfied = 0
        for _, patterns in TWELVE_FACTOR_PATTERNS.items():
            if any(re.search(p, all_code) for p in patterns):
                factors_satisfied += 1

        # Bonus factors
        has_env_example = any(".env.example" in p or ".env.sample" in p for p in files.keys())
        if has_env_example:
            factors_satisfied += 1
        has_readme = any(p.upper().startswith("README") for p in files.keys())
        if has_readme:
            factors_satisfied += 1

        if has_dockerfile and factors_satisfied >= 5:
            score, rubric = 10.0, "Dockerfile + 12-factor compliance"
        elif has_dockerfile and factors_satisfied >= 3:
            score, rubric = 8.0, "Dockerfile + most 12-factor"
        elif has_dockerfile:
            score, rubric = 6.0, "Dockerfile basic"
        elif any("compose" in p.lower() for p in files.keys()):
            score, rubric = 4.0, "Compose-only"
        elif "Makefile" in files:
            score, rubric = 2.0, "Manual build required"
        else:
            score, rubric = 0.0, "Can't containerize"

        return SubComponentScore(
            sub_component_id="scale_07_container_readiness",
            name="Container readiness",
            score=score,
            method="automated",
            tool_used="static_file_analysis",
            raw_findings={
                "has_dockerfile": has_dockerfile,
                "twelve_factor_count": factors_satisfied,
                "has_env_example": has_env_example,
                "has_readme": has_readme,
            },
            rubric_match=rubric,
        )

    def _score_autoscaling(self, files: dict[str, str]) -> SubComponentScore:
        """scale_08: Auto-scaling configuration."""
        all_text = "\n".join([*files.keys(), *files.values()])

        has_explicit_autoscale = any(re.search(p, all_text, re.IGNORECASE) for p in AUTOSCALING_PATTERNS)
        has_serverless = bool(
            re.search(r"(?i)(modal|lambda|cloud-?run|vercel|cloudflare-?workers)", all_text)
        )
        documented = bool(re.search(r"(?i)(auto-?scaling|scale up|scale down)", all_text))

        if has_explicit_autoscale and has_serverless:
            score, rubric = 10.0, "HPA configured + serverless ready"
        elif has_explicit_autoscale:
            score, rubric = 8.0, "Autoscaling configured"
        elif has_serverless:
            score, rubric = 6.0, "Serverless platform (implicit autoscale)"
        elif documented:
            score, rubric = 4.0, "Documented for ops to enable"
        elif "Dockerfile" in files:
            score, rubric = 2.0, "Possible but unconfigured"
        else:
            score, rubric = 0.0, "Impossible"

        return SubComponentScore(
            sub_component_id="scale_08_autoscaling",
            name="Auto-scaling config",
            score=score,
            method="automated",
            tool_used="static_pattern_analysis",
            raw_findings={
                "explicit_autoscale": has_explicit_autoscale,
                "serverless_platform": has_serverless,
                "documented": documented,
            },
            rubric_match=rubric,
        )

    def _score_cdn(self, files: dict[str, str]) -> SubComponentScore:
        """scale_09: CDN configuration."""
        all_text = "\n".join([*files.keys(), *files.values()])

        has_cdn = any(re.search(p, all_text, re.IGNORECASE) for p in CDN_PATTERNS)
        has_cache_headers = bool(re.search(r"(?i)(Cache-Control|max-age)", all_text))
        has_static_dir = any(
            p.startswith("static/") or p.startswith("public/") or "/static/" in p
            for p in files.keys()
        )

        if has_cdn and has_cache_headers:
            score, rubric = 10.0, "Static assets at edge + cache headers"
        elif has_cdn:
            score, rubric = 8.0, "CDN configured"
        elif has_cache_headers:
            score, rubric = 6.0, "Cache headers correct"
        elif has_static_dir:
            score, rubric = 4.0, "Some caching possible"
        elif re.search(r"(?i)no-cache", all_text):
            score, rubric = 2.0, "Anti-cache headers"
        else:
            score, rubric = 0.0, "None"

        return SubComponentScore(
            sub_component_id="scale_09_cdn",
            name="CDN configuration",
            score=score,
            method="automated",
            tool_used="static_pattern_analysis",
            raw_findings={
                "cdn": has_cdn,
                "cache_headers": has_cache_headers,
                "static_dir": has_static_dir,
            },
            rubric_match=rubric,
        )

    def _score_db_indexing(self, files: dict[str, str]) -> SubComponentScore:
        """scale_10: Database indexing on common queries."""
        all_code = "\n".join(files.values())

        index_definitions = sum(
            len(re.findall(p, all_code, re.IGNORECASE)) for p in DB_INDEX_PATTERNS
        )

        # Heuristic: count likely "indexable" columns (foreign keys, lookup fields)
        likely_lookups = sum(
            len(re.findall(p, all_code))
            for p in [
                r"_id\s*=\s*",  # foreign-key-style usage
                r"@\s*ForeignKey",
                r"references\(",  # Prisma/Drizzle
            ]
        )

        if likely_lookups == 0:
            ratio = 1.0
        else:
            ratio = min(1.0, index_definitions / max(likely_lookups, 1))

        if ratio >= 0.8:
            score, rubric = 10.0, "Indexes on all queried columns"
        elif ratio >= 0.6:
            score, rubric = 8.0, "80%+ coverage"
        elif ratio >= 0.4:
            score, rubric = 6.0, "60-79%"
        elif ratio >= 0.2:
            score, rubric = 4.0, "40-59%"
        elif index_definitions > 0:
            score, rubric = 2.0, "Some indexes"
        else:
            score, rubric = 0.0, "<20%"

        return SubComponentScore(
            sub_component_id="scale_10_db_indexing",
            name="Database indexing",
            score=score,
            method="automated",
            tool_used="static_pattern_analysis",
            raw_findings={
                "index_definitions": index_definitions,
                "likely_lookups": likely_lookups,
                "coverage_ratio": round(ratio, 2),
            },
            rubric_match=rubric,
        )

    def _stub_load_tests(self) -> list[SubComponentScore]:
        """scale_01, scale_02 load tests require live deployment + k6."""
        stubs = [
            ("scale_01_load_1k", "Load test 1k concurrent"),
            ("scale_02_load_10k", "Load test 10k concurrent"),
        ]
        return [
            SubComponentScore(
                sub_component_id=sub_id,
                name=name,
                score=0.0,
                method="automated",
                tool_used="k6_load_test",
                notes=(
                    "v0 scaffold: requires live deployment + k6. "
                    "Returns 0 until deployment harness is operational."
                ),
            )
            for sub_id, name in stubs
        ]
