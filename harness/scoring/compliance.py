"""
Compliance dimension scoring engine.

v0.4 §17 three-tier functional scoring:
  Each sub-component scored on Presence (0-3) + Functionality (0-4) + Defaults (0-3)
  Total: 0-10 per sub-component.

Sub-components (10 total per PRS v0.4):
  comp_01: GDPR cookie consent
  comp_02: Privacy policy
  comp_03: Terms of service
  comp_04: Data export endpoint
  comp_05: Data deletion endpoint
  comp_06: Audit logging
  comp_07: Access controls
  comp_08: Encryption at rest
  comp_09: DPA template
  comp_10: EU AI Act provenance disclosure

v0 implementation: Presence + heuristic Functionality + heuristic Defaults
via static analysis. True functional testing (actual network log of blocked
tracking, real encryption verification) requires deployed test environment.
"""

from __future__ import annotations

import logging
import re
import time
from typing import TYPE_CHECKING, Iterable

from harness.scoring.base import ScoreResult, ScoringEngine, SubComponentScore

if TYPE_CHECKING:
    from harness.deployment.base import DeploymentResult
    from harness.orchestrator import TaskDefinition
    from harness.tools.base import ToolOutput

logger = logging.getLogger(__name__)


COOKIE_BANNER_PATTERNS = [
    r"cookie-?banner",
    r"cookie-?consent",
    r"CookieBanner",
    r"CookieConsent",
    r"gdpr",
    r"@analytics-ai\/consent",
    r"react-cookie-consent",
    r"vanilla-cookieconsent",
    r"orestbida/cookieconsent",
]

PRIVACY_POLICY_FILES = [
    "privacy",
    "privacy-policy",
    "privacy_policy",
    "PRIVACY",
]

TOS_FILES = [
    "terms",
    "tos",
    "terms-of-service",
    "terms_of_service",
    "TERMS",
]

DATA_EXPORT_PATTERNS = [
    r"['\"]/.*?(export|download|my-data|user-data)['\"]",
    r"def\s+export_user_data",
    r"function\s+exportUserData",
    r"data-portability",
    r"data_portability",
]

DATA_DELETION_PATTERNS = [
    r"def\s+delete_user",
    r"def\s+delete_account",
    r"DELETE\s+/api/.*?(me|account|user)",
    r"\.delete_user\(",
    r"\.deleteAccount\(",
    r"right-to-erasure",
    r"right_to_erasure",
]

AUDIT_LOG_PATTERNS = [
    r"audit[_-]?log",
    r"AuditLog",
    r"audit_trail",
    r"event[_-]?log",
    r"activity[_-]?log",
]

RBAC_PATTERNS = [
    r"role[_-]?based",
    r"RBAC",
    r"@require_role",
    r"@requires_permission",
    r"check_permission",
    r"can_access",
    r"authorize\(",
]

ENCRYPTION_PATTERNS = {
    "db_encryption": [
        r"encrypted",
        r"crypt\.",
        r"AES",
        r"PGP",
        r"sqlalchemy_utils\.EncryptedType",
        r"@vault",
        r"transparent_data_encryption",
    ],
    "file_encryption": [
        r"S3.*sse",
        r"server-side-encryption",
        r"encryption_at_rest",
    ],
}

EU_AI_ACT_PATTERNS = [
    r"ai-?provenance",
    r"model-?card",
    r"model[_-]?disclosure",
    r"ai[_-]?usage[_-]?disclosure",
    r"transparency[_-]?report",
]


class ComplianceScoringEngine(ScoringEngine):
    """Scores the Compliance dimension using 3-tier functional scoring (v0.4 §17)."""

    dimension_id = "compliance"
    dimension_name = "Compliance"

    async def score(
        self,
        deployment: "DeploymentResult",
        task: "TaskDefinition",
        tool_output: "ToolOutput",
    ) -> ScoreResult:
        start = time.monotonic()
        files = tool_output.output_files

        sub_scores: list[SubComponentScore] = [
            self._score_cookie_consent(files),
            self._score_privacy_policy(files),
            self._score_terms_of_service(files),
            self._score_data_export(files),
            self._score_data_deletion(files),
            self._score_audit_logging(files),
            self._score_access_controls(files),
            self._score_encryption_at_rest(files),
            self._score_dpa_template(files),
            self._score_eu_ai_act(files),
        ]

        dimension_score = sum(s.score for s in sub_scores)

        return ScoreResult(
            dimension_id=self.dimension_id,
            dimension_name=self.dimension_name,
            sub_component_scores=sub_scores,
            dimension_score=dimension_score,
            scoring_duration_seconds=time.monotonic() - start,
        )

    # ----- 3-tier scoring helper -----

    @staticmethod
    def _three_tier(presence: int, functionality: int, defaults: int) -> tuple[float, str]:
        """Combine 3-tier scoring into 0-10 with descriptive label."""
        total = presence + functionality + defaults
        label = f"P={presence}/3 F={functionality}/4 D={defaults}/3"
        return float(total), label

    # ----- Sub-components -----

    def _score_cookie_consent(self, files: dict[str, str]) -> SubComponentScore:
        """comp_01: GDPR cookie consent (3-tier functional)."""
        all_code = "\n".join(files.values())
        all_paths = "\n".join(files.keys())

        has_library = any(re.search(p, all_code, re.IGNORECASE) for p in COOKIE_BANNER_PATTERNS)
        has_banner_component = any(
            re.search(p, all_paths, re.IGNORECASE) for p in COOKIE_BANNER_PATTERNS
        )
        has_preferences = bool(
            re.search(r"preferences|customize|granular|essential|functional|analytics|marketing",
                      all_code, re.IGNORECASE)
        )

        # Presence (0-3)
        if has_library and has_banner_component and has_preferences:
            presence = 3
        elif has_library and has_preferences:
            presence = 2
        elif has_library or has_banner_component:
            presence = 1
        else:
            presence = 0

        # Functionality (0-4) — heuristic via code patterns
        blocks_tracking = bool(
            re.search(r"if\s*\(.*?consent.*?\).*?(load|init|track)", all_code, re.IGNORECASE | re.DOTALL)
            or re.search(r"consent\s*\?\s*track", all_code, re.IGNORECASE)
        )
        records_consent = bool(re.search(r"set.*?consent|saveConsent|consent_log",
                                        all_code, re.IGNORECASE))

        if blocks_tracking and records_consent:
            functionality = 3
        elif records_consent:
            functionality = 2
        elif has_library:
            functionality = 1
        else:
            functionality = 0
        # Functionality=4 only via actual network-log verification (deployment-only)

        # Defaults (0-3) — opt-in vs opt-out
        is_opt_in = bool(
            re.search(r"default.*?(false|off)", all_code, re.IGNORECASE)
            and not re.search(r"default.*?(true|on).*?tracking", all_code, re.IGNORECASE)
        )
        is_opt_out = bool(re.search(r"default.*?(true|on).*?(track|analytics)", all_code, re.IGNORECASE))

        if is_opt_in:
            defaults = 2
        elif is_opt_out:
            defaults = 0
        else:
            defaults = 1

        score, label = self._three_tier(presence, functionality, defaults)

        return SubComponentScore(
            sub_component_id="comp_01_cookie_consent",
            name="GDPR cookie consent",
            score=score,
            method="hybrid",
            tool_used="static_pattern_analysis",
            raw_findings={
                "has_library": has_library,
                "has_banner_component": has_banner_component,
                "has_preferences": has_preferences,
                "blocks_tracking_heuristic": blocks_tracking,
                "records_consent": records_consent,
            },
            rubric_match=label,
            notes="Functionality tier 4 requires deployment + network log verification",
        )

    def _score_privacy_policy(self, files: dict[str, str]) -> SubComponentScore:
        """comp_02: Privacy policy (presence + tailoring)."""
        privacy_file = self._find_file_by_keywords(files, PRIVACY_POLICY_FILES)

        if privacy_file:
            content = files[privacy_file]
            # Tailored if mentions specific stack/services
            is_tailored = bool(
                re.search(r"(?i)(stripe|sendgrid|postgres|aws|google\s+analytics|cloudflare)", content)
            ) and len(content) > 1000
            generic = len(content) < 500

            if is_tailored:
                score, label = 10.0, "Auto-generated from actual data collection"
            elif len(content) > 1000:
                score, label = 6.0, "Generic template, substantial content"
            elif generic:
                score, label = 4.0, "Boilerplate"
            else:
                score, label = 2.0, "Placeholder"
        else:
            score, label = 0.0, "None"

        return SubComponentScore(
            sub_component_id="comp_02_privacy_policy",
            name="Privacy policy",
            score=score,
            method="hybrid",
            tool_used="static_file_analysis",
            raw_findings={"file": privacy_file},
            rubric_match=label,
        )

    def _score_terms_of_service(self, files: dict[str, str]) -> SubComponentScore:
        """comp_03: Terms of service."""
        tos_file = self._find_file_by_keywords(files, TOS_FILES)

        if tos_file:
            content = files[tos_file]
            if len(content) > 1500:
                score, label = 8.0, "Substantial ToS document"
            elif len(content) > 500:
                score, label = 6.0, "Basic ToS"
            else:
                score, label = 4.0, "Placeholder"
        else:
            score, label = 0.0, "None"

        return SubComponentScore(
            sub_component_id="comp_03_terms_of_service",
            name="Terms of service",
            score=score,
            method="hybrid",
            tool_used="static_file_analysis",
            raw_findings={"file": tos_file},
            rubric_match=label,
        )

    def _score_data_export(self, files: dict[str, str]) -> SubComponentScore:
        """comp_04: Data export endpoint."""
        all_code = "\n".join(files.values())
        has_endpoint = any(re.search(p, all_code) for p in DATA_EXPORT_PATTERNS)
        machine_readable = bool(re.search(r"(?i)json|csv|xml", all_code))

        if has_endpoint and machine_readable:
            score, label = 10.0, "Endpoint + machine-readable format"
        elif has_endpoint:
            score, label = 6.0, "Endpoint exists, format unclear"
        elif "data-portability" in all_code.lower():
            score, label = 2.0, "Mentioned but not implemented"
        else:
            score, label = 0.0, "None"

        return SubComponentScore(
            sub_component_id="comp_04_data_export",
            name="Data export endpoint",
            score=score,
            method="automated",
            tool_used="static_pattern_analysis",
            raw_findings={"has_endpoint": has_endpoint, "machine_readable": machine_readable},
            rubric_match=label,
        )

    def _score_data_deletion(self, files: dict[str, str]) -> SubComponentScore:
        """comp_05: Data deletion endpoint."""
        all_code = "\n".join(files.values())
        has_endpoint = any(re.search(p, all_code) for p in DATA_DELETION_PATTERNS)
        has_cascading = bool(
            re.search(r"(?i)cascade|cascading|ON\s+DELETE\s+CASCADE", all_code)
        )
        has_audit = bool(re.search(r"(?i)log.*?deletion|deletion.*?log|audit.*?delete", all_code))

        if has_endpoint and has_cascading and has_audit:
            score, label = 10.0, "Cascading delete, audit logged"
        elif has_endpoint and has_cascading:
            score, label = 8.0, "Cascading delete"
        elif has_endpoint:
            score, label = 6.0, "Endpoint exists"
        elif "soft_delete" in all_code or "softDelete" in all_code:
            score, label = 6.0, "Soft delete"
        else:
            score, label = 0.0, "None"

        return SubComponentScore(
            sub_component_id="comp_05_data_deletion",
            name="Data deletion endpoint",
            score=score,
            method="automated",
            tool_used="static_pattern_analysis",
            raw_findings={
                "has_endpoint": has_endpoint,
                "cascading": has_cascading,
                "audited": has_audit,
            },
            rubric_match=label,
        )

    def _score_audit_logging(self, files: dict[str, str]) -> SubComponentScore:
        """comp_06: Audit logging."""
        all_code = "\n".join(files.values())
        has_audit_table = any(re.search(p, all_code, re.IGNORECASE) for p in AUDIT_LOG_PATTERNS)
        has_immutable = bool(
            re.search(r"(?i)immutable|append-?only|read-?only|cannot\s+be\s+modified", all_code)
        )
        has_actor_action = bool(
            re.search(r"(?i)actor.*?action|user_id.*?action_type|who.*?did.*?what", all_code)
        )

        if has_audit_table and has_immutable and has_actor_action:
            score, label = 10.0, "All sensitive actions + immutable + actor/action recorded"
        elif has_audit_table and has_actor_action:
            score, label = 8.0, "Actions logged with actor/target"
        elif has_audit_table:
            score, label = 6.0, "Audit table exists"
        elif re.search(r"(?i)log.*?(login|create|update|delete)", all_code):
            score, label = 4.0, "Some actions logged"
        elif re.search(r"(?i)error.*?log", all_code):
            score, label = 2.0, "Errors only"
        else:
            score, label = 0.0, "None"

        return SubComponentScore(
            sub_component_id="comp_06_audit_logging",
            name="Audit logging",
            score=score,
            method="automated",
            tool_used="static_pattern_analysis",
            raw_findings={
                "audit_table": has_audit_table,
                "immutable": has_immutable,
                "actor_action": has_actor_action,
            },
            rubric_match=label,
        )

    def _score_access_controls(self, files: dict[str, str]) -> SubComponentScore:
        """comp_07: Access controls (RBAC/ABAC)."""
        all_code = "\n".join(files.values())
        has_rbac = any(re.search(p, all_code, re.IGNORECASE) for p in RBAC_PATTERNS)
        has_abac = bool(
            re.search(r"(?i)attribute-?based|policy-?engine|opa|casbin|oso", all_code)
        )
        has_per_endpoint_check = bool(
            re.search(r"@require[_-]?role|@requires?_permission|requireRole\(",
                      all_code, re.IGNORECASE)
        )

        if has_rbac and has_abac and has_per_endpoint_check:
            score, label = 10.0, "RBAC + ABAC + per-endpoint enforcement"
        elif has_rbac and has_per_endpoint_check:
            score, label = 8.0, "Solid RBAC with enforcement"
        elif has_rbac:
            score, label = 6.0, "Basic RBAC"
        elif re.search(r"(?i)(is_admin|is_owner|role\s*[=:]\s*['\"]admin)", all_code):
            score, label = 4.0, "Simple roles"
        elif re.search(r"(?i)admin|owner", all_code):
            score, label = 2.0, "Admin/user only"
        else:
            score, label = 0.0, "None"

        return SubComponentScore(
            sub_component_id="comp_07_access_controls",
            name="Access controls",
            score=score,
            method="automated",
            tool_used="static_pattern_analysis",
            raw_findings={
                "rbac": has_rbac,
                "abac": has_abac,
                "per_endpoint": has_per_endpoint_check,
            },
            rubric_match=label,
        )

    def _score_encryption_at_rest(self, files: dict[str, str]) -> SubComponentScore:
        """comp_08: Encryption at rest."""
        all_code = "\n".join(files.values())
        has_db_encryption = any(
            re.search(p, all_code, re.IGNORECASE) for p in ENCRYPTION_PATTERNS["db_encryption"]
        )
        has_file_encryption = any(
            re.search(p, all_code, re.IGNORECASE) for p in ENCRYPTION_PATTERNS["file_encryption"]
        )
        has_secrets_encryption = bool(
            re.search(r"(?i)vault|sops|sealed-?secret|secrets-?manager", all_code)
        )

        if has_db_encryption and has_file_encryption and has_secrets_encryption:
            score, label = 10.0, "DB + files + secrets encrypted"
        elif has_db_encryption and has_file_encryption:
            score, label = 8.0, "DB + files"
        elif has_db_encryption:
            score, label = 6.0, "DB only"
        elif has_file_encryption:
            score, label = 4.0, "Files only"
        elif "encrypt" in all_code.lower():
            score, label = 2.0, "Mentioned but not configured"
        else:
            score, label = 0.0, "None"

        return SubComponentScore(
            sub_component_id="comp_08_encryption_at_rest",
            name="Encryption at rest",
            score=score,
            method="hybrid",
            tool_used="static_pattern_analysis",
            raw_findings={
                "db": has_db_encryption,
                "files": has_file_encryption,
                "secrets": has_secrets_encryption,
            },
            rubric_match=label,
        )

    def _score_dpa_template(self, files: dict[str, str]) -> SubComponentScore:
        """comp_09: DPA template for B2B."""
        dpa_file = self._find_file_by_keywords(files, ["dpa", "data-processing", "data_processing"])

        if dpa_file:
            content = files[dpa_file]
            if len(content) > 1500:
                score, label = 10.0, "Substantial DPA template generated"
            elif len(content) > 500:
                score, label = 6.0, "DPA mentioned in compliance docs"
            else:
                score, label = 4.0, "Placeholder DPA"
        else:
            all_text = "\n".join(files.values())
            if "data processing agreement" in all_text.lower():
                score, label = 2.0, "Title only"
            else:
                score, label = 0.0, "None"

        return SubComponentScore(
            sub_component_id="comp_09_dpa_template",
            name="DPA template",
            score=score,
            method="hybrid",
            tool_used="static_file_analysis",
            raw_findings={"file": dpa_file},
            rubric_match=label,
        )

    def _score_eu_ai_act(self, files: dict[str, str]) -> SubComponentScore:
        """comp_10: EU AI Act provenance disclosure."""
        all_code = "\n".join(files.values())
        all_text = "\n".join([*files.keys(), *files.values()])

        has_disclosure = any(re.search(p, all_text, re.IGNORECASE) for p in EU_AI_ACT_PATTERNS)
        has_model_info = bool(re.search(r"(?i)gpt-|claude-|llama-|gemini-|model.*version", all_text))
        mentions_ai = bool(re.search(r"(?i)\bai\b|artificial intelligence|machine learning", all_text))

        if has_disclosure and has_model_info:
            score, label = 10.0, "Full model/training data disclosure"
        elif has_disclosure:
            score, label = 8.0, "Model name + version"
        elif has_model_info:
            score, label = 6.0, "Mentions AI use"
        elif mentions_ai:
            score, label = 4.0, "Implicit"
        else:
            score, label = 0.0, "None"

        return SubComponentScore(
            sub_component_id="comp_10_eu_ai_act",
            name="EU AI Act provenance disclosure",
            score=score,
            method="automated",
            tool_used="static_pattern_analysis",
            raw_findings={
                "disclosure": has_disclosure,
                "model_info": has_model_info,
                "mentions_ai": mentions_ai,
            },
            rubric_match=label,
        )

    # ----- Helpers -----

    @staticmethod
    def _find_file_by_keywords(
        files: dict[str, str], keywords: Iterable[str]
    ) -> str | None:
        """Find a file whose path contains any of the keywords (case-insensitive)."""
        for path in files.keys():
            path_lower = path.lower()
            for keyword in keywords:
                if keyword.lower() in path_lower:
                    return path
        return None
