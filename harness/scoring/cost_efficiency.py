"""
Cost Efficiency dimension scoring engine.

Implements 10 sub-components per PRS v0.4:
  cost_01: Cost @ 100 users     — requires deployment + cost monitoring
  cost_02: Cost @ 10k users     — requires deployment + cost monitoring
  cost_03: Cost @ 100k users    — requires deployment + cost monitoring
  cost_04: Vendor lock-in        — static analysis
  cost_05: Multi-cloud portability — static analysis (Dockerfile etc.)
  cost_06: OSS dependency ratio  — dependency analysis
  cost_07: Egress cost optimization — static analysis
  cost_08: Auto-shutdown         — static analysis
  cost_09: Resource right-sizing — static analysis
  cost_10: Pricing predictability — static analysis

v0 implementation: 7 static-analysis sub-components implemented.
The 3 cost-at-scale sub-components require live deployment cost data.
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


PROPRIETARY_VENDORS = [
    # Hard lock-in (proprietary, hard to migrate)
    ("aws-amplify", 3),
    ("firebase", 3),
    ("vercel-kv", 3),
    ("supabase", 1),  # Open-source-able
    ("planetscale", 1),
    ("neon", 1),
    ("cloudflare-d1", 2),
    ("dynamodb", 3),
    ("cosmosdb", 3),
    ("appwrite", 1),
    ("upstash", 2),
]

OSS_INDICATORS = [
    "postgres", "postgresql", "mysql", "redis", "rabbitmq", "nginx",
    "kafka", "elasticsearch", "minio", "mongodb", "next.js", "react",
    "vue", "svelte", "django", "flask", "rails", "express", "fastapi",
    "drizzle", "prisma", "sqlalchemy",
]

EDGE_CACHE_PATTERNS = [
    r"Cache-Control",
    r"max-age",
    r"s-maxage",
    r"CDN",
    r"cloudflare",
    r"cloudfront",
    r"fastly",
    r"vercel\s+edge",
    r"@vercel\/edge",
]

AUTO_SHUTDOWN_PATTERNS = [
    r"min_replicas\s*[=:]\s*0",
    r"scale-to-zero",
    r"scaledown",
    r"idle_timeout",
    r"@modal\.web_endpoint.*keep_warm=0",
    r"fly\.toml.*auto_stop_machines",
]

CONTAINER_RESOURCE_PATTERNS = [
    r"memory[\"']?\s*[=:]",
    r"cpu[\"']?\s*[=:]",
    r"resources?:",
    r"limits:",
    r"requests:",
]


class CostEfficiencyScoringEngine(ScoringEngine):
    """Scores the Cost Efficiency dimension."""

    dimension_id = "cost_efficiency"
    dimension_name = "Cost Efficiency"

    async def score(
        self,
        deployment: "DeploymentResult",
        task: "TaskDefinition",
        tool_output: "ToolOutput",
    ) -> ScoreResult:
        start = time.monotonic()
        files = tool_output.output_files

        sub_scores: list[SubComponentScore] = [
            self._score_vendor_lockin(files),
            self._score_multicloud_portability(files),
            self._score_oss_ratio(files),
            self._score_egress_optimization(files),
            self._score_auto_shutdown(files),
            self._score_right_sizing(files),
            self._score_pricing_predictability(files),
        ]

        sub_scores.extend(self._stub_scale_costs(deployment))

        dimension_score = sum(s.score for s in sub_scores)

        return ScoreResult(
            dimension_id=self.dimension_id,
            dimension_name=self.dimension_name,
            sub_component_scores=sub_scores,
            dimension_score=dimension_score,
            scoring_duration_seconds=time.monotonic() - start,
        )

    # ----- Sub-components -----

    def _score_vendor_lockin(self, files: dict[str, str]) -> SubComponentScore:
        """cost_04: Vendor lock-in level (lower = better)."""
        all_text = "\n".join(files.values())
        lockin_score_total = 0
        vendors_found = []

        for vendor, weight in PROPRIETARY_VENDORS:
            if re.search(re.escape(vendor), all_text, re.IGNORECASE):
                lockin_score_total += weight
                vendors_found.append((vendor, weight))

        # Lock-in score → cost-efficiency rubric (inverted: less lock-in = better)
        if lockin_score_total == 0:
            score, rubric = 10.0, "100% OSS or open standards"
        elif lockin_score_total <= 1:
            score, rubric = 8.0, "90%+ OSS"
        elif lockin_score_total <= 3:
            score, rubric = 6.0, "70-89% OSS"
        elif lockin_score_total <= 6:
            score, rubric = 4.0, "50-69%"
        elif lockin_score_total <= 9:
            score, rubric = 2.0, "30-49%"
        else:
            score, rubric = 0.0, "<30%"

        return SubComponentScore(
            sub_component_id="cost_04_vendor_lockin",
            name="Vendor lock-in",
            score=score,
            method="automated",
            tool_used="static_pattern_analysis",
            raw_findings={
                "lockin_weight_total": lockin_score_total,
                "vendors_detected": vendors_found,
            },
            rubric_match=rubric,
        )

    def _score_multicloud_portability(self, files: dict[str, str]) -> SubComponentScore:
        """cost_05: Multi-cloud portability via container readiness."""
        has_dockerfile = "Dockerfile" in files or any("Dockerfile" in p for p in files.keys())
        has_compose = any("compose" in p.lower() for p in files.keys())
        has_k8s = any("k8s" in p.lower() or "kubernetes" in p.lower() for p in files.keys())
        has_helm = any("helm" in p.lower() for p in files.keys())

        all_text = "\n".join(files.values())
        all_paths_text = "\n".join(files.keys())
        aws_specific = bool(re.search(r"aws-amplify|cloudformation|cdk\.|sam\.", all_text + all_paths_text, re.IGNORECASE))
        gcp_specific = bool(re.search(r"app-engine|app\.yaml|cloud-run\.yaml", all_text + all_paths_text, re.IGNORECASE))
        azure_specific = bool(re.search(r"azure-pipelines|arm-template", all_text + all_paths_text, re.IGNORECASE))

        cloud_specific_count = sum([aws_specific, gcp_specific, azure_specific])
        portable_count = sum([has_dockerfile, has_compose, has_k8s, has_helm])

        if has_dockerfile and portable_count >= 2 and cloud_specific_count == 0:
            score, rubric = 10.0, "Same image runs on 5+ platforms"
        elif has_dockerfile and cloud_specific_count == 0:
            score, rubric = 8.0, "Runs on 4 platforms"
        elif has_dockerfile:
            score, rubric = 6.0, "Runs on 3 platforms"
        elif has_compose or has_k8s:
            score, rubric = 4.0, "Runs on 2 platforms"
        elif cloud_specific_count == 1:
            score, rubric = 2.0, "Single platform"
        else:
            score, rubric = 0.0, "Platform-specific"

        return SubComponentScore(
            sub_component_id="cost_05_multicloud_portability",
            name="Multi-cloud portability",
            score=score,
            method="automated",
            tool_used="static_file_analysis",
            raw_findings={
                "dockerfile": has_dockerfile,
                "compose": has_compose,
                "k8s": has_k8s,
                "helm": has_helm,
                "cloud_specific_count": cloud_specific_count,
            },
            rubric_match=rubric,
        )

    def _score_oss_ratio(self, files: dict[str, str]) -> SubComponentScore:
        """cost_06: OSS dependency ratio."""
        # Look for dependency manifest
        manifest_content = ""
        manifest_type = None
        for path, content in files.items():
            if path.endswith("package.json"):
                manifest_content = content
                manifest_type = "npm"
                break
            elif path.endswith("requirements.txt"):
                manifest_content = content
                manifest_type = "pip"
                break
            elif path.endswith("pyproject.toml") or path.endswith("Cargo.toml") or path.endswith("go.mod"):
                manifest_content = content
                manifest_type = path.split(".")[-1]
                break

        if not manifest_content:
            return SubComponentScore(
                sub_component_id="cost_06_oss_ratio",
                name="OSS dependency ratio",
                score=0.0,
                method="automated",
                tool_used="dependency_analyzer",
                rubric_match="No manifest found",
                notes="No dependency manifest detected; cannot compute OSS ratio",
            )

        # Heuristic: count known OSS indicators vs proprietary vendor SDKs
        text_lower = manifest_content.lower()
        oss_hits = sum(1 for oss in OSS_INDICATORS if oss in text_lower)
        proprietary_hits = sum(1 for vendor, _ in PROPRIETARY_VENDORS if vendor in text_lower)

        total = oss_hits + proprietary_hits
        if total == 0:
            ratio = 1.0
        else:
            ratio = oss_hits / total

        if ratio >= 1.0:
            score, rubric = 10.0, "100% OSS"
        elif ratio >= 0.9:
            score, rubric = 8.0, "90%+"
        elif ratio >= 0.7:
            score, rubric = 6.0, "70-89%"
        elif ratio >= 0.5:
            score, rubric = 4.0, "50-69%"
        elif ratio >= 0.3:
            score, rubric = 2.0, "30-49%"
        else:
            score, rubric = 0.0, "<30%"

        return SubComponentScore(
            sub_component_id="cost_06_oss_ratio",
            name="OSS dependency ratio",
            score=score,
            method="automated",
            tool_used=f"dependency_analyzer_{manifest_type}",
            raw_findings={
                "manifest_type": manifest_type,
                "oss_hits": oss_hits,
                "proprietary_hits": proprietary_hits,
                "ratio": round(ratio, 2),
            },
            rubric_match=rubric,
        )

    def _score_egress_optimization(self, files: dict[str, str]) -> SubComponentScore:
        """cost_07: Egress / CDN / caching optimization."""
        all_text = "\n".join(files.values())

        has_cdn = bool(re.search(r"(?i)cloudflare|cloudfront|fastly|cdn", all_text))
        has_cache_headers = bool(re.search(r"Cache-Control:|max-age=", all_text))
        has_compression = bool(re.search(r"(?i)gzip|brotli|compress\(", all_text))
        has_efficient_protocol = bool(re.search(r"(?i)http/2|http2|grpc|websocket", all_text))

        count = sum([has_cdn, has_cache_headers, has_compression, has_efficient_protocol])

        if count == 4:
            score, rubric = 10.0, "CDN + caching + compression + efficient protocol"
        elif count == 3:
            score, rubric = 8.0, "3 of 4"
        elif count == 2:
            score, rubric = 6.0, "2"
        elif count == 1:
            score, rubric = 4.0, "1"
        elif "no-cache" in all_text.lower():
            score, rubric = 2.0, "Configured but inefficient"
        else:
            score, rubric = 0.0, "None"

        return SubComponentScore(
            sub_component_id="cost_07_egress_optimization",
            name="Egress cost optimization",
            score=score,
            method="automated",
            tool_used="static_pattern_analysis",
            raw_findings={
                "cdn": has_cdn,
                "cache_headers": has_cache_headers,
                "compression": has_compression,
                "efficient_protocol": has_efficient_protocol,
            },
            rubric_match=rubric,
        )

    def _score_auto_shutdown(self, files: dict[str, str]) -> SubComponentScore:
        """cost_08: Auto-shutdown / scale-to-zero."""
        all_text = "\n".join(files.values())

        has_scale_to_zero = any(re.search(p, all_text) for p in AUTO_SHUTDOWN_PATTERNS)
        has_serverless = bool(re.search(r"(?i)lambda|cloud-run|modal|fly\.toml|vercel\.json", all_text))

        if has_scale_to_zero:
            score, rubric = 10.0, "Dev/staging shuts down when idle"
        elif has_serverless:
            score, rubric = 8.0, "Can be configured (serverless)"
        elif re.search(r"(?i)docker|kubernetes", all_text):
            score, rubric = 6.0, "Possible with extra work"
        else:
            score, rubric = 4.0, "Manual only"

        return SubComponentScore(
            sub_component_id="cost_08_auto_shutdown",
            name="Auto-shutdown",
            score=score,
            method="automated",
            tool_used="static_pattern_analysis",
            raw_findings={
                "scale_to_zero": has_scale_to_zero,
                "serverless_platform": has_serverless,
            },
            rubric_match=rubric,
        )

    def _score_right_sizing(self, files: dict[str, str]) -> SubComponentScore:
        """cost_09: Container/function right-sizing."""
        all_text = "\n".join(files.values())

        has_resource_limits = any(re.search(p, all_text) for p in CONTAINER_RESOURCE_PATTERNS)
        has_oversized_red_flag = bool(
            re.search(r"memory.*?[\"']?\s*[=:]\s*['\"]?(?:8|16|32)Gi", all_text)
            or re.search(r"cpu.*?[\"']?\s*[=:]\s*['\"]?(?:4|8|16)", all_text)
        )

        if has_resource_limits and not has_oversized_red_flag:
            score, rubric = 10.0, "Containers sized to workload"
        elif has_resource_limits:
            score, rubric = 8.0, "Reasonable defaults"
        elif re.search(r"(?i)docker|kubernetes", all_text):
            score, rubric = 6.0, "Mostly OK (defaults)"
        elif has_oversized_red_flag:
            score, rubric = 2.0, "Mostly oversized"
        else:
            score, rubric = 4.0, "Some oversized"

        return SubComponentScore(
            sub_component_id="cost_09_right_sizing",
            name="Resource right-sizing",
            score=score,
            method="automated",
            tool_used="static_pattern_analysis",
            raw_findings={
                "has_resource_limits": has_resource_limits,
                "oversized_red_flag": has_oversized_red_flag,
            },
            rubric_match=rubric,
        )

    def _score_pricing_predictability(self, files: dict[str, str]) -> SubComponentScore:
        """cost_10: Pricing model predictability."""
        all_text = "\n".join(files.values())

        # Surprise-billing red flags
        has_pay_per_use = bool(re.search(r"(?i)dynamodb|firestore|gcp-functions|lambda", all_text))
        has_egress_heavy = bool(re.search(r"(?i)s3|cloudfront|cloudfront", all_text)
                                 and not re.search(r"(?i)cloudflare", all_text))
        has_flat_pricing = bool(re.search(r"(?i)modal|fly\.io|railway|render", all_text))

        if has_flat_pricing and not has_pay_per_use:
            score, rubric = 10.0, "Flat/predictable, no surprise billing"
        elif has_flat_pricing:
            score, rubric = 8.0, "Mostly predictable"
        elif has_pay_per_use and not has_egress_heavy:
            score, rubric = 6.0, "Usage-based, capped"
        elif has_pay_per_use:
            score, rubric = 4.0, "Usage-based, monitorable"
        elif has_egress_heavy:
            score, rubric = 2.0, "Hard to predict (egress-heavy)"
        else:
            score, rubric = 6.0, "Default unclear"

        return SubComponentScore(
            sub_component_id="cost_10_pricing_predictability",
            name="Pricing model predictability",
            score=score,
            method="automated",
            tool_used="static_pattern_analysis",
            raw_findings={
                "flat_pricing": has_flat_pricing,
                "pay_per_use": has_pay_per_use,
                "egress_heavy": has_egress_heavy,
            },
            rubric_match=rubric,
        )

    def _stub_scale_costs(
        self, deployment: "DeploymentResult"
    ) -> list[SubComponentScore]:
        """cost_01-03: Cost at 100 / 10k / 100k users — requires live deployment."""
        stubs = [
            ("cost_01_cost_100", "Cost @ 100 users"),
            ("cost_02_cost_10k", "Cost @ 10k users"),
            ("cost_03_cost_100k", "Cost @ 100k users"),
        ]
        return [
            SubComponentScore(
                sub_component_id=sub_id,
                name=name,
                score=0.0,
                method="automated",
                tool_used="deployment_cost_monitor",
                notes=(
                    "v0 scaffold: requires live deployment + cost monitoring "
                    "to compute. Returns 0 until deployment harness is operational."
                ),
            )
            for sub_id, name in stubs
        ]
