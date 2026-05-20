"""
Maintainability / Code Quality dimension scoring engine.

Proposed for PRS v0.5 as the sixth core dimension. Implements 10
sub-components covering complexity, duplication, sizing, documentation,
type safety, test coverage, linter compliance, naming conventions, module
structure, and dead code.

Static-analysis only (no external tools required). When mature tools
like radon, ruff, jscpd, coverage.py are available, the scoring engine
prefers them. Otherwise it falls back to AST and pattern analysis.

v0.5 candidate — see METHODOLOGY.md §16.6.
"""

from __future__ import annotations

import ast
import logging
import re
import time
from collections import Counter
from typing import TYPE_CHECKING

from harness.scoring.base import ScoreResult, ScoringEngine, SubComponentScore

if TYPE_CHECKING:
    from harness.deployment.base import DeploymentResult
    from harness.orchestrator import TaskDefinition
    from harness.tools.base import ToolOutput

logger = logging.getLogger(__name__)


# ---------- File classification ----------

CODE_EXT_LANG: dict[str, str] = {
    ".py": "python",
    ".js": "javascript",
    ".jsx": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".rb": "ruby",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".php": "php",
}

DOC_EXT = {".md", ".rst", ".adoc", ".txt"}

TEST_FILENAME_PATTERNS = (
    r"^test_",
    r"_test\.",
    r"\.test\.",
    r"\.spec\.",
    r"^tests?/",
    r"/__tests__/",
)


def _classify_files(files: dict[str, str]) -> dict[str, list[tuple[str, str]]]:
    """Group files by language; ignore obvious non-code/binary."""
    by_lang: dict[str, list[tuple[str, str]]] = {}
    for path, content in files.items():
        if content.startswith("<binary file"):
            continue
        # Skip lockfiles, generated, vendored
        if any(p in path for p in (
            "package-lock.json", "yarn.lock", "pnpm-lock", "poetry.lock",
            "/dist/", "/build/", "/.next/", "node_modules", "/coverage/",
        )):
            continue
        for ext, lang in CODE_EXT_LANG.items():
            if path.endswith(ext):
                by_lang.setdefault(lang, []).append((path, content))
                break
    return by_lang


def _is_test_file(path: str) -> bool:
    return any(re.search(p, path) for p in TEST_FILENAME_PATTERNS)


def _split_test_and_src(files: list[tuple[str, str]]) -> tuple[list[tuple[str, str]], list[tuple[str, str]]]:
    src, tests = [], []
    for path, content in files:
        (tests if _is_test_file(path) else src).append((path, content))
    return src, tests


# ---------- Sub-component implementations ----------


class QualityScoringEngine(ScoringEngine):
    """Scores the Maintainability/Quality dimension (v0.5 candidate)."""

    dimension_id = "quality"
    dimension_name = "Maintainability / Code Quality"

    async def score(
        self,
        deployment: "DeploymentResult",
        task: "TaskDefinition",
        tool_output: "ToolOutput",
    ) -> ScoreResult:
        start = time.monotonic()
        files = tool_output.output_files
        by_lang = _classify_files(files)
        flat_files = [(p, c) for fs in by_lang.values() for (p, c) in fs]

        sub_scores: list[SubComponentScore] = [
            self._score_cyclomatic_complexity(by_lang),
            self._score_duplication(flat_files),
            self._score_function_size(by_lang),
            self._score_documentation_coverage(by_lang),
            self._score_type_safety(by_lang, files),
            self._score_test_coverage(by_lang, files),
            self._score_linter_compliance(by_lang),
            self._score_naming_consistency(by_lang),
            self._score_module_structure(files),
            self._score_dead_code(by_lang),
        ]

        dimension_score = sum(s.score for s in sub_scores)

        return ScoreResult(
            dimension_id=self.dimension_id,
            dimension_name=self.dimension_name,
            sub_component_scores=sub_scores,
            dimension_score=dimension_score,
            scoring_duration_seconds=time.monotonic() - start,
        )

    # ----- qual_01: cyclomatic complexity -----

    def _score_cyclomatic_complexity(
        self, by_lang: dict[str, list[tuple[str, str]]]
    ) -> SubComponentScore:
        complexities: list[int] = []

        # Python: use AST for precise count
        for _path, content in by_lang.get("python", []):
            try:
                tree = ast.parse(content)
            except SyntaxError:
                continue
            for node in ast.walk(tree):
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    complexities.append(_python_cc(node))

        # JS/TS/others: regex count of branching constructs per function
        for lang in ("javascript", "typescript", "ruby", "go", "rust", "java", "php"):
            for _path, content in by_lang.get(lang, []):
                complexities.extend(_regex_cc(content))

        if not complexities:
            return _no_data_score(
                "qual_01_cyclomatic_complexity",
                "Cyclomatic complexity",
                "ast_or_regex_cc",
                "No analyzable functions found",
            )

        avg_cc = sum(complexities) / len(complexities)
        max_cc = max(complexities)

        if avg_cc < 5 and max_cc < 15:
            score, rubric = 10.0, "avg<5, max<15"
        elif avg_cc < 7 and max_cc < 20:
            score, rubric = 8.0, "avg<7, max<20"
        elif avg_cc < 10 and max_cc < 25:
            score, rubric = 6.0, "avg<10, max<25"
        elif avg_cc < 15 and max_cc < 35:
            score, rubric = 4.0, "avg<15, max<35"
        elif avg_cc < 20 and max_cc < 50:
            score, rubric = 2.0, "avg<20, max<50"
        else:
            score, rubric = 0.0, "avg>=20 or max>=50"

        return SubComponentScore(
            sub_component_id="qual_01_cyclomatic_complexity",
            name="Cyclomatic complexity",
            score=score,
            method="automated",
            tool_used="ast_or_regex_cc",
            raw_findings={
                "function_count": len(complexities),
                "avg": round(avg_cc, 2),
                "max": max_cc,
            },
            rubric_match=rubric,
        )

    # ----- qual_02: duplication -----

    def _score_duplication(
        self, files: list[tuple[str, str]]
    ) -> SubComponentScore:
        """Detect duplicate 6-line blocks across all source files."""
        block_counter: Counter[str] = Counter()
        total_lines = 0
        for _path, content in files:
            lines = [ln.strip() for ln in content.splitlines()]
            non_blank = [ln for ln in lines if ln and not ln.startswith(("//", "#"))]
            total_lines += len(non_blank)
            for i in range(len(non_blank) - 5):
                block = "\n".join(non_blank[i:i + 6])
                block_counter[block] += 1

        if total_lines == 0:
            return _no_data_score(
                "qual_02_duplication", "Code duplication", "block_hashing", "No code"
            )

        dup_lines = sum((c - 1) * 6 for c in block_counter.values() if c > 1)
        ratio = dup_lines / total_lines

        if ratio < 0.02:
            score, rubric = 10.0, "<2% duplicated"
        elif ratio < 0.05:
            score, rubric = 8.0, "2-5%"
        elif ratio < 0.10:
            score, rubric = 6.0, "5-10%"
        elif ratio < 0.20:
            score, rubric = 4.0, "10-20%"
        elif ratio < 0.30:
            score, rubric = 2.0, "20-30%"
        else:
            score, rubric = 0.0, ">30%"

        return SubComponentScore(
            sub_component_id="qual_02_duplication",
            name="Code duplication",
            score=score,
            method="automated",
            tool_used="block_hashing",
            raw_findings={"dup_ratio": round(ratio, 4), "total_lines": total_lines},
            rubric_match=rubric,
        )

    # ----- qual_03: function/method size -----

    def _score_function_size(
        self, by_lang: dict[str, list[tuple[str, str]]]
    ) -> SubComponentScore:
        max_func, max_class = 0, 0
        # Python AST for accuracy
        for _path, content in by_lang.get("python", []):
            try:
                tree = ast.parse(content)
            except SyntaxError:
                continue
            for node in ast.walk(tree):
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    size = (node.end_lineno or node.lineno) - node.lineno + 1
                    max_func = max(max_func, size)
                elif isinstance(node, ast.ClassDef):
                    size = (node.end_lineno or node.lineno) - node.lineno + 1
                    max_class = max(max_class, size)

        # JS/TS regex approximation: function bodies between matching braces
        for lang in ("javascript", "typescript"):
            for _path, content in by_lang.get(lang, []):
                for size in _js_function_sizes(content):
                    max_func = max(max_func, size)

        if max_func == 0 and max_class == 0:
            return _no_data_score(
                "qual_03_function_size", "Function/method size",
                "ast_or_regex_size", "No functions detected",
            )

        if max_func < 30 and max_class < 200:
            score, rubric = 10.0, "max_func<30, max_class<200"
        elif max_func < 50 and max_class < 300:
            score, rubric = 8.0, "max_func<50, max_class<300"
        elif max_func < 100 and max_class < 500:
            score, rubric = 6.0, "max_func<100, max_class<500"
        elif max_func < 200 and max_class < 1000:
            score, rubric = 4.0, "max_func<200, max_class<1000"
        else:
            score, rubric = 0.0, "max_func>=200 or max_class>=1000"

        return SubComponentScore(
            sub_component_id="qual_03_function_size",
            name="Function/method size",
            score=score,
            method="automated",
            tool_used="ast_or_regex_size",
            raw_findings={"max_function_lines": max_func, "max_class_lines": max_class},
            rubric_match=rubric,
        )

    # ----- qual_04: documentation coverage -----

    def _score_documentation_coverage(
        self, by_lang: dict[str, list[tuple[str, str]]]
    ) -> SubComponentScore:
        documented, total = 0, 0
        for _path, content in by_lang.get("python", []):
            try:
                tree = ast.parse(content)
            except SyntaxError:
                continue
            for node in ast.walk(tree):
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                    if not node.name.startswith("_"):  # public only
                        total += 1
                        if ast.get_docstring(node):
                            documented += 1

        # JS/TS: count JSDoc preceding `export function` / `export class`
        for lang in ("javascript", "typescript"):
            for _path, content in by_lang.get(lang, []):
                d, t = _jsdoc_coverage(content)
                documented += d
                total += t

        if total == 0:
            return _no_data_score(
                "qual_04_documentation_coverage",
                "Documentation coverage", "ast_jsdoc", "No public APIs detected",
            )

        ratio = documented / total

        if ratio >= 0.90:
            score, rubric = 10.0, "90%+ documented"
        elif ratio >= 0.70:
            score, rubric = 8.0, "70-89%"
        elif ratio >= 0.50:
            score, rubric = 6.0, "50-69%"
        elif ratio >= 0.30:
            score, rubric = 4.0, "30-49%"
        elif ratio >= 0.10:
            score, rubric = 2.0, "10-29%"
        else:
            score, rubric = 0.0, "<10%"

        return SubComponentScore(
            sub_component_id="qual_04_documentation_coverage",
            name="Documentation coverage",
            score=score,
            method="automated",
            tool_used="ast_jsdoc",
            raw_findings={"documented": documented, "total": total, "ratio": round(ratio, 3)},
            rubric_match=rubric,
        )

    # ----- qual_05: type safety -----

    def _score_type_safety(
        self,
        by_lang: dict[str, list[tuple[str, str]]],
        files: dict[str, str],
    ) -> SubComponentScore:
        # TypeScript: strict mode in tsconfig
        ts_strict = False
        for path, content in files.items():
            if path.endswith("tsconfig.json"):
                if re.search(r'"strict"\s*:\s*true', content):
                    ts_strict = True
                    break

        has_ts = "typescript" in by_lang
        has_python = "python" in by_lang

        # Python: % of function defs with type hints
        py_typed, py_total = 0, 0
        for _path, content in by_lang.get("python", []):
            try:
                tree = ast.parse(content)
            except SyntaxError:
                continue
            for node in ast.walk(tree):
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    py_total += 1
                    has_arg_types = all(arg.annotation for arg in node.args.args if arg.arg != "self")
                    has_return = node.returns is not None
                    if has_arg_types and has_return:
                        py_typed += 1

        signals: list[str] = []
        if has_ts:
            signals.append("ts_strict" if ts_strict else "ts_default")
        if has_python and py_total > 0:
            ratio = py_typed / py_total
            signals.append(f"py_typed_ratio={ratio:.2f}")

        if not signals:
            return _no_data_score(
                "qual_05_type_safety", "Type safety",
                "tsconfig_or_ast", "Untyped language or no type-checking config",
            )

        # Score: prefer strict
        score: float = 0.0
        rubric_parts: list[str] = []
        if has_ts:
            if ts_strict:
                score = max(score, 10.0)
                rubric_parts.append("TS strict")
            else:
                score = max(score, 6.0)
                rubric_parts.append("TS default")
        if has_python and py_total > 0:
            ratio = py_typed / py_total
            if ratio >= 0.9:
                score = max(score, 10.0)
                rubric_parts.append("Python 90%+ typed")
            elif ratio >= 0.7:
                score = max(score, 8.0)
                rubric_parts.append("Python 70%+ typed")
            elif ratio >= 0.5:
                score = max(score, 6.0)
                rubric_parts.append("Python 50%+ typed")
            elif ratio >= 0.3:
                score = max(score, 4.0)
                rubric_parts.append("Python 30%+ typed")
            else:
                score = max(score, 2.0)
                rubric_parts.append("Python <30% typed")

        return SubComponentScore(
            sub_component_id="qual_05_type_safety",
            name="Type safety",
            score=score,
            method="automated",
            tool_used="tsconfig_or_ast",
            raw_findings={
                "ts_strict": ts_strict,
                "py_typed": py_typed,
                "py_total": py_total,
            },
            rubric_match=" + ".join(rubric_parts) if rubric_parts else "n/a",
        )

    # ----- qual_06: test coverage -----

    def _score_test_coverage(
        self,
        by_lang: dict[str, list[tuple[str, str]]],
        files: dict[str, str],
    ) -> SubComponentScore:
        # We can't run tests here, so use proxy: test:source LOC ratio +
        # presence of test framework imports + count of test functions.
        src_loc, test_loc = 0, 0
        test_funcs = 0
        for files_for_lang in by_lang.values():
            src, tests = _split_test_and_src(files_for_lang)
            src_loc += sum(c.count("\n") for _p, c in src)
            test_loc += sum(c.count("\n") for _p, c in tests)
            for _p, content in tests:
                test_funcs += len(re.findall(r"(?:def\s+test_|it\(['\"]|test\(['\"]|describe\()", content))

        has_test_config = any(
            path.endswith(("vitest.config.ts", "jest.config.js", "jest.config.ts",
                          "pytest.ini", "pyproject.toml"))
            and re.search(r"(?:vitest|jest|pytest|mocha)", content, re.IGNORECASE)
            for path, content in files.items()
        )

        if src_loc == 0:
            return _no_data_score(
                "qual_06_test_coverage", "Test coverage (proxy)",
                "static_proxy", "No source code",
            )

        ratio = test_loc / src_loc
        if ratio >= 0.50 and test_funcs >= 15:
            score, rubric = 10.0, "tests:src>=0.5, 15+ test fns"
        elif ratio >= 0.30 and test_funcs >= 10:
            score, rubric = 8.0, "tests:src>=0.3, 10+ test fns"
        elif ratio >= 0.15 and test_funcs >= 5:
            score, rubric = 6.0, "tests:src>=0.15, 5+ test fns"
        elif has_test_config and test_funcs >= 1:
            score, rubric = 4.0, "test framework configured, few tests"
        elif has_test_config:
            score, rubric = 2.0, "test framework configured, no tests"
        else:
            score, rubric = 0.0, "no tests"

        return SubComponentScore(
            sub_component_id="qual_06_test_coverage",
            name="Test coverage (proxy)",
            score=score,
            method="automated",
            tool_used="static_proxy",
            raw_findings={
                "src_loc": src_loc,
                "test_loc": test_loc,
                "test_funcs": test_funcs,
                "tests_src_ratio": round(ratio, 3),
                "has_test_config": has_test_config,
            },
            rubric_match=rubric,
            notes="Static proxy. Real coverage + mutation testing requires execution.",
        )

    # ----- qual_07: linter compliance -----

    def _score_linter_compliance(
        self, by_lang: dict[str, list[tuple[str, str]]]
    ) -> SubComponentScore:
        # Static proxy: count common code smells per 1k LOC
        warnings = 0
        total_lines = 0
        for files_for_lang in by_lang.values():
            for _path, content in files_for_lang:
                total_lines += content.count("\n")
                # Common smells
                warnings += len(re.findall(r"\bconsole\.log\b", content))  # leftover debug
                warnings += len(re.findall(r"\bdebugger\b", content))
                warnings += len(re.findall(r"\bprint\(", content)) if "python" in str(_path) else 0
                warnings += len(re.findall(r"#\s*FIXME|#\s*TODO|//\s*FIXME|//\s*TODO", content))
                warnings += len(re.findall(r"\bany\b\s*[,)>]", content))  # TS `any`

        if total_lines == 0:
            return _no_data_score(
                "qual_07_linter_compliance", "Linter compliance (proxy)",
                "smell_density", "No code",
            )

        density = warnings / (total_lines / 1000)

        if density < 1:
            score, rubric = 10.0, "<1 smell per 1k LOC"
        elif density < 5:
            score, rubric = 8.0, "1-5 per 1k"
        elif density < 15:
            score, rubric = 6.0, "5-15 per 1k"
        elif density < 30:
            score, rubric = 4.0, "15-30 per 1k"
        else:
            score, rubric = 2.0, ">=30 per 1k"

        return SubComponentScore(
            sub_component_id="qual_07_linter_compliance",
            name="Linter compliance (proxy)",
            score=score,
            method="automated",
            tool_used="smell_density",
            raw_findings={
                "warnings": warnings, "total_lines": total_lines,
                "density_per_1k": round(density, 2),
            },
            rubric_match=rubric,
            notes="Proxy via code-smell pattern density. Real linter run requires installation.",
        )

    # ----- qual_08: naming consistency -----

    def _score_naming_consistency(
        self, by_lang: dict[str, list[tuple[str, str]]]
    ) -> SubComponentScore:
        py_conform, py_total = 0, 0
        for _path, content in by_lang.get("python", []):
            for match in re.finditer(r"^\s*def\s+(\w+)", content, re.MULTILINE):
                name = match.group(1)
                py_total += 1
                if re.fullmatch(r"[a-z_][a-z0-9_]*", name):
                    py_conform += 1

        js_conform, js_total = 0, 0
        for lang in ("javascript", "typescript"):
            for _path, content in by_lang.get(lang, []):
                for match in re.finditer(
                    r"(?:function|const|let|var)\s+(\w+)", content
                ):
                    name = match.group(1)
                    js_total += 1
                    # camelCase or UPPER_SNAKE for constants
                    if re.fullmatch(r"[a-z][a-zA-Z0-9]*|[A-Z][A-Z0-9_]*", name):
                        js_conform += 1

        total = py_total + js_total
        if total == 0:
            return _no_data_score(
                "qual_08_naming_consistency", "Naming convention consistency",
                "regex_naming", "No identifiers analyzed",
            )

        conformance = (py_conform + js_conform) / total

        if conformance >= 0.95:
            score, rubric = 10.0, "95%+ conformant"
        elif conformance >= 0.85:
            score, rubric = 8.0, "85-94%"
        elif conformance >= 0.70:
            score, rubric = 6.0, "70-84%"
        elif conformance >= 0.50:
            score, rubric = 4.0, "50-69%"
        else:
            score, rubric = 2.0, "<50%"

        return SubComponentScore(
            sub_component_id="qual_08_naming_consistency",
            name="Naming convention consistency",
            score=score,
            method="automated",
            tool_used="regex_naming",
            raw_findings={
                "conformant": py_conform + js_conform,
                "total": total,
                "conformance": round(conformance, 3),
            },
            rubric_match=rubric,
        )

    # ----- qual_09: module structure -----

    def _score_module_structure(
        self, files: dict[str, str]
    ) -> SubComponentScore:
        # Heuristic: count separation of concerns via directory naming
        dir_signals = set()
        max_depth = 0
        for path in files.keys():
            parts = path.split("/")
            max_depth = max(max_depth, len(parts))
            lowered = "/" + "/".join(parts[:-1]).lower() + "/"
            for keyword in (
                "/api/", "/routes/", "/handlers/", "/controllers/",
                "/lib/", "/utils/", "/helpers/", "/services/",
                "/models/", "/schemas/", "/types/", "/entities/",
                "/components/", "/pages/", "/views/",
                "/tests/", "/spec/", "/__tests__/",
                "/db/", "/migrations/", "/data/",
                "/config/", "/settings/",
                "/middleware/", "/auth/",
            ):
                if keyword in lowered:
                    dir_signals.add(keyword)

        # Avg directory depth as proxy for organization
        depth_score = min(max_depth, 6)  # cap

        if len(dir_signals) >= 5 and depth_score >= 4:
            score, rubric = 10.0, "5+ concerns separated, deep structure"
        elif len(dir_signals) >= 4:
            score, rubric = 8.0, "4 concerns separated"
        elif len(dir_signals) >= 3:
            score, rubric = 6.0, "3 concerns separated"
        elif len(dir_signals) >= 2:
            score, rubric = 4.0, "2 concerns separated"
        elif len(dir_signals) >= 1:
            score, rubric = 2.0, "1 concern separated"
        else:
            score, rubric = 0.0, "no apparent separation"

        return SubComponentScore(
            sub_component_id="qual_09_module_structure",
            name="Module structure / separation of concerns",
            score=score,
            method="automated",
            tool_used="directory_signal_heuristic",
            raw_findings={
                "concern_signals_detected": sorted(dir_signals),
                "max_depth": max_depth,
            },
            rubric_match=rubric,
        )

    # ----- qual_10: dead code / unused imports -----

    def _score_dead_code(
        self, by_lang: dict[str, list[tuple[str, str]]]
    ) -> SubComponentScore:
        unused_count = 0
        total_lines = 0

        for _path, content in by_lang.get("python", []):
            total_lines += content.count("\n")
            try:
                tree = ast.parse(content)
            except SyntaxError:
                continue
            imported_names: set[str] = set()
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        imported_names.add(alias.asname or alias.name.split(".")[0])
                elif isinstance(node, ast.ImportFrom):
                    for alias in node.names:
                        imported_names.add(alias.asname or alias.name)
            # Heuristic: count imports that don't appear later in source
            for name in imported_names:
                if name == "*":
                    continue
                # Count occurrences past import section
                if content.count(name) <= 1:  # only the import itself
                    unused_count += 1

        if total_lines == 0:
            return _no_data_score(
                "qual_10_dead_code", "Dead code / unused imports",
                "ast_import_check", "No Python code (other langs not yet supported)",
            )

        density = unused_count / max(total_lines / 1000, 0.001)

        if density < 1:
            score, rubric = 10.0, "<1 unused per 1k LOC"
        elif density < 3:
            score, rubric = 8.0, "1-3 per 1k"
        elif density < 10:
            score, rubric = 6.0, "3-10 per 1k"
        elif density < 20:
            score, rubric = 4.0, "10-20 per 1k"
        else:
            score, rubric = 2.0, ">=20 per 1k"

        return SubComponentScore(
            sub_component_id="qual_10_dead_code",
            name="Dead code / unused imports",
            score=score,
            method="automated",
            tool_used="ast_import_check",
            raw_findings={"unused_imports": unused_count, "total_lines": total_lines},
            rubric_match=rubric,
        )


# ---------- Helpers ----------


def _python_cc(func_node) -> int:
    """Cyclomatic complexity of a Python function via AST."""
    cc = 1
    for node in ast.walk(func_node):
        if isinstance(node, (ast.If, ast.While, ast.For, ast.AsyncFor, ast.ExceptHandler)):
            cc += 1
        elif isinstance(node, ast.BoolOp) and len(node.values) > 1:
            cc += len(node.values) - 1
    return cc


def _regex_cc(content: str) -> list[int]:
    """Approximate cyclomatic complexity for non-Python languages."""
    # Naive: count branching constructs total / function count
    function_starts = re.findall(
        r"(?:function\s+\w+|const\s+\w+\s*=\s*(?:async\s*)?\(|def\s+\w+|fn\s+\w+|func\s+\w+)",
        content,
    )
    if not function_starts:
        return []
    branches = len(re.findall(
        r"\b(?:if|else if|elif|while|for|case|catch)\b|&&|\|\|", content
    ))
    avg = branches / len(function_starts) + 1
    return [int(avg)] * len(function_starts)


def _js_function_sizes(content: str) -> list[int]:
    """Best-effort function-body line counts for JS/TS via brace matching."""
    sizes: list[int] = []
    lines = content.splitlines()
    for i, line in enumerate(lines):
        if re.search(r"(?:function\s+\w+|=>\s*\{|=\s*(?:async\s*)?\([^)]*\)\s*=>)", line):
            depth = 0
            started = False
            for j in range(i, min(i + 500, len(lines))):
                depth += lines[j].count("{") - lines[j].count("}")
                if "{" in lines[j]:
                    started = True
                if started and depth == 0:
                    sizes.append(j - i + 1)
                    break
    return sizes


def _jsdoc_coverage(content: str) -> tuple[int, int]:
    """Count exported public APIs and how many have JSDoc preceding them."""
    documented, total = 0, 0
    lines = content.splitlines()
    for i, line in enumerate(lines):
        if re.search(r"^\s*export\s+(?:async\s+)?(?:function|class|const|interface|type)\s+\w+", line):
            total += 1
            # Walk backward to find JSDoc
            j = i - 1
            while j >= 0 and lines[j].strip() == "":
                j -= 1
            if j >= 0 and (lines[j].strip().endswith("*/") or lines[j].strip().startswith("///")):
                documented += 1
    return documented, total


def _no_data_score(
    sub_id: str, name: str, tool: str, note: str
) -> SubComponentScore:
    return SubComponentScore(
        sub_component_id=sub_id,
        name=name,
        score=0.0,
        method="automated",
        tool_used=tool,
        notes=note,
    )
