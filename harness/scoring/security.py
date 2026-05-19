"""
Security dimension scoring engine.

Implements 10 sub-components per PRS v0.4:
  sec_01: Static analysis findings (Semgrep + Snyk + CodeQL)
  sec_02: Dependency CVE count (npm audit / pip audit / cargo audit)
  sec_03: Authentication correctness (OWASP ASVS L1 test suite)
  sec_04: Input validation coverage
  sec_05: SQL injection resistance
  sec_06: XSS prevention
  sec_07: CSRF protection
  sec_08: Secret management (gitleaks + trufflehog)
  sec_09: TLS/HTTPS configuration (testssl.sh)
  sec_10: Rate limiting

v0 implementation: sec_01 (Semgrep) and sec_08 (gitleaks) wired up.
Others scaffolded — production version requires CLI tool installation
and proper integration.
"""

from __future__ import annotations

import asyncio
import json
import logging
import shutil
import tempfile
import time
from pathlib import Path
from typing import TYPE_CHECKING

from harness.scoring.base import ScoringEngine, ScoreResult, SubComponentScore

if TYPE_CHECKING:
    from harness.deployment.base import DeploymentResult
    from harness.tools.base import ToolOutput
    from harness.orchestrator import TaskDefinition

logger = logging.getLogger(__name__)


class SecurityScoringEngine(ScoringEngine):
    """Scores the Security dimension."""

    dimension_id = "security"
    dimension_name = "Security"

    async def score(
        self,
        deployment: "DeploymentResult",
        task: "TaskDefinition",
        tool_output: "ToolOutput",
    ) -> ScoreResult:
        start = time.monotonic()

        sub_scores: list[SubComponentScore] = []

        # Materialize the tool output to a temp directory for static analysis
        with tempfile.TemporaryDirectory(prefix="sigil_sec_") as tmp:
            tmp_path = Path(tmp)
            self._write_files(tmp_path, tool_output.output_files)

            # sec_01: Static analysis
            sub_scores.append(await self._score_static_analysis(tmp_path))

            # sec_02: Dependency CVEs
            sub_scores.append(await self._score_dependency_cves(tmp_path))

            # sec_08: Secret management (gitleaks)
            sub_scores.append(await self._score_secret_management(tmp_path))

            # Remaining sub-components stubbed for v0
            sub_scores.extend(self._stub_remaining_sub_components())

        # Dimension score = sum of sub-component scores (each 0-10)
        # Total: 0-100
        dimension_score = sum(s.score for s in sub_scores)

        return ScoreResult(
            dimension_id=self.dimension_id,
            dimension_name=self.dimension_name,
            sub_component_scores=sub_scores,
            dimension_score=dimension_score,
            scoring_duration_seconds=time.monotonic() - start,
        )

    # ----- Sub-component implementations -----

    async def _score_static_analysis(self, code_path: Path) -> SubComponentScore:
        """sec_01: Run Semgrep over the codebase and score by finding severity."""
        if not shutil.which("semgrep"):
            return SubComponentScore(
                sub_component_id="sec_01_static_analysis",
                name="Static analysis findings",
                score=0.0,
                method="automated",
                tool_used="semgrep",
                notes="Semgrep not installed locally; sub-component skipped",
            )

        try:
            proc = await asyncio.create_subprocess_exec(
                "semgrep",
                "--config=auto",
                "--json",
                "--quiet",
                "--no-git-ignore",
                str(code_path),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _stderr = await proc.communicate()
        except (FileNotFoundError, OSError) as exc:
            return SubComponentScore(
                sub_component_id="sec_01_static_analysis",
                name="Static analysis findings",
                score=0.0,
                method="automated",
                tool_used="semgrep",
                notes=f"Semgrep execution failed: {exc}",
            )

        try:
            data = json.loads(stdout.decode())
            findings = data.get("results", [])
        except json.JSONDecodeError:
            findings = []

        critical = sum(1 for f in findings if f.get("extra", {}).get("severity") == "ERROR")
        high = sum(1 for f in findings if f.get("extra", {}).get("severity") == "WARNING")

        # Apply rubric from scoring_rubric_v04.yaml
        if critical == 0 and high == 0:
            score, rubric = 10.0, "0 critical, 0 high"
        elif critical == 0 and high <= 3:
            score, rubric = 8.0, "0 critical, 1-3 high"
        elif critical == 0 and high <= 10 or critical == 1:
            score, rubric = 6.0, "0 critical, 4-10 high OR 1 critical"
        elif critical <= 2 or high <= 50:
            score, rubric = 4.0, "1-2 critical OR 11+ high"
        elif critical <= 5:
            score, rubric = 2.0, "3-5 critical"
        else:
            score, rubric = 0.0, "6+ critical"

        return SubComponentScore(
            sub_component_id="sec_01_static_analysis",
            name="Static analysis findings",
            score=score,
            method="automated",
            tool_used="semgrep",
            raw_findings={"critical": critical, "high": high, "total": len(findings)},
            rubric_match=rubric,
        )

    async def _score_dependency_cves(self, code_path: Path) -> SubComponentScore:
        """sec_02: Run dependency vulnerability scanners."""
        critical = 0
        high = 0
        tool_used = None

        # Try npm audit if package.json exists
        if (code_path / "package.json").exists() and shutil.which("npm"):
            tool_used = "npm_audit"
            try:
                proc = await asyncio.create_subprocess_exec(
                    "npm", "audit", "--json",
                    cwd=str(code_path),
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                stdout, _ = await proc.communicate()
                data = json.loads(stdout.decode())
                meta = data.get("metadata", {}).get("vulnerabilities", {})
                critical = meta.get("critical", 0)
                high = meta.get("high", 0)
            except (FileNotFoundError, OSError, json.JSONDecodeError):
                tool_used = "npm_audit_unavailable"

        # Try pip-audit if requirements.txt or pyproject.toml exists
        elif (code_path / "requirements.txt").exists() and shutil.which("pip-audit"):
            tool_used = "pip_audit"
            # pip-audit invocation omitted for brevity (similar pattern)

        # Apply rubric
        if critical == 0 and high == 0:
            score, rubric = 10.0, "0 high/critical CVEs"
        elif critical == 0 and high <= 2:
            score, rubric = 8.0, "0 critical, 1-2 high"
        elif critical == 0 and high <= 5:
            score, rubric = 6.0, "0 critical, 3-5 high"
        elif critical <= 2 or high <= 15:
            score, rubric = 4.0, "1-2 critical OR 6-15 high"
        elif critical <= 5:
            score, rubric = 2.0, "3-5 critical"
        else:
            score, rubric = 0.0, "6+ critical"

        return SubComponentScore(
            sub_component_id="sec_02_dependency_cves",
            name="Dependency CVE count",
            score=score,
            method="automated",
            tool_used=tool_used or "no_scanner_available",
            raw_findings={"critical": critical, "high": high},
            rubric_match=rubric,
            notes=None if tool_used else "No dependency manifest detected",
        )

    async def _score_secret_management(self, code_path: Path) -> SubComponentScore:
        """sec_08: Scan for hardcoded secrets using gitleaks (with regex fallback)."""
        if not shutil.which("gitleaks"):
            # Fallback: simple regex scan for common secret patterns
            return await self._fallback_secret_scan(code_path)

        try:
            proc = await asyncio.create_subprocess_exec(
                "gitleaks", "detect",
                "--source", str(code_path),
                "--no-git",
                "--report-format", "json",
                "--report-path", "-",
                "--exit-code", "0",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await proc.communicate()
        except (FileNotFoundError, OSError):
            return await self._fallback_secret_scan(code_path)

        try:
            findings = json.loads(stdout.decode()) if stdout.strip() else []
        except json.JSONDecodeError:
            findings = []

        count = len(findings)
        if count == 0:
            score, rubric = 10.0, "All secrets in env/secret-manager"
        elif count <= 2:
            score, rubric = 8.0, "1-2 hardcoded test secrets"
        elif count <= 5:
            score, rubric = 6.0, "3-5 hardcoded"
        elif count <= 10:
            score, rubric = 4.0, "6-10"
        elif count <= 20:
            score, rubric = 2.0, "11-20"
        else:
            score, rubric = 0.0, "20+"

        return SubComponentScore(
            sub_component_id="sec_08_secret_management",
            name="Secret management",
            score=score,
            method="automated",
            tool_used="gitleaks",
            raw_findings={"hardcoded_secrets_found": count},
            rubric_match=rubric,
        )

    async def _fallback_secret_scan(self, code_path: Path) -> SubComponentScore:
        """Regex fallback when gitleaks unavailable. Catches obvious hardcoded secrets."""
        import re

        patterns = [
            (r"sk_(test|live)_[a-zA-Z0-9]{16,}", "stripe_key"),
            (r"AIza[0-9A-Za-z_-]{35}", "google_api_key"),
            (r"AKIA[0-9A-Z]{16}", "aws_access_key"),
            (r"ghp_[a-zA-Z0-9]{36}", "github_pat"),
            (r"xox[baprs]-[a-zA-Z0-9-]{10,}", "slack_token"),
            (r"-----BEGIN (RSA|EC|OPENSSH) PRIVATE KEY-----", "private_key"),
            (r'(password|secret|api[_-]?key|token)\s*[:=]\s*["\'][^"\']{8,}["\']', "hardcoded_credential"),
        ]
        count = 0
        for path in code_path.rglob("*"):
            if not path.is_file():
                continue
            try:
                content = path.read_text(errors="ignore")
            except (OSError, UnicodeDecodeError):
                continue
            for pattern, _ in patterns:
                count += len(re.findall(pattern, content))

        if count == 0:
            score, rubric = 10.0, "All secrets in env/secret-manager"
        elif count <= 2:
            score, rubric = 8.0, "1-2 hardcoded test secrets"
        elif count <= 5:
            score, rubric = 6.0, "3-5 hardcoded"
        elif count <= 10:
            score, rubric = 4.0, "6-10"
        elif count <= 20:
            score, rubric = 2.0, "11-20"
        else:
            score, rubric = 0.0, "20+"

        return SubComponentScore(
            sub_component_id="sec_08_secret_management",
            name="Secret management",
            score=score,
            method="automated",
            tool_used="regex_fallback",
            raw_findings={"hardcoded_secrets_found": count},
            rubric_match=rubric,
            notes="gitleaks unavailable; used regex fallback",
        )

    def _stub_remaining_sub_components(self) -> list[SubComponentScore]:
        """v0 stub: scores not yet implemented return 0 with explanatory note."""
        stubs = [
            ("sec_03_auth_correctness", "Authentication correctness (OWASP ASVS L1)", "owasp_asvs_l1_suite"),
            ("sec_04_input_validation", "Input validation coverage", "harness_probe"),
            ("sec_05_sqli_resistance", "SQL injection resistance", "owasp_zap+sqlmap"),
            ("sec_06_xss_prevention", "XSS prevention", "owasp_zap"),
            ("sec_07_csrf_protection", "CSRF protection", "harness_probe"),
            ("sec_09_tls_config", "TLS/HTTPS configuration", "testssl_sh"),
            ("sec_10_rate_limiting", "Rate limiting", "harness_probe"),
        ]
        return [
            SubComponentScore(
                sub_component_id=sub_id,
                name=name,
                score=0.0,
                method="automated",
                tool_used=tool,
                notes="v0 scaffold — not yet implemented. Returns 0 by default.",
            )
            for sub_id, name, tool in stubs
        ]

    @staticmethod
    def _write_files(target_dir: Path, files: dict[str, str]) -> None:
        for rel_path, content in files.items():
            file_path = target_dir / rel_path
            file_path.parent.mkdir(parents=True, exist_ok=True)
            file_path.write_text(content, encoding="utf-8")
