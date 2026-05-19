"""
Claude Code CLI adapter.

Benchmarks Claude Code (the agentic CLI tool) rather than the raw Claude model.
This is AI-Involvement Spectrum position 4 (Agentic), distinct from the
ClaudeAdapter which benchmarks position 2 (Augmentative).

Advantages over the API adapter:
  - Uses the user's existing Claude Code subscription — no API key management
  - Benchmarks the actual agentic experience real users get
  - Captures tool-use, file editing, multi-step execution

Same CLI pattern works for: codex (OpenAI), gh copilot, cursor-agent (when CLI exists).
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from harness.tools.base import ToolAdapter, ToolOutput

logger = logging.getLogger(__name__)


# Common build artifacts / caches we don't want to score
IGNORE_DIRS = {
    "node_modules", ".git", ".venv", "venv", "__pycache__",
    ".next", "dist", "build", ".cache", "target", ".pytest_cache",
    ".mypy_cache", ".ruff_cache",
}
IGNORE_FILES = {".DS_Store", "Thumbs.db"}
MAX_FILE_SIZE = 1_000_000  # 1MB — skip larger files (binary, large data)


class ClaudeCodeAdapter(ToolAdapter):
    """
    Benchmarks Claude Code via the `claude` CLI.

    Workflow:
      1. Create temp directory
      2. Invoke `claude -p "<prompt>"` in that directory
      3. Wait for Claude Code to finish (it writes files to the directory)
      4. Read all files into ToolOutput
      5. Cleanup
    """

    spectrum_position = 4  # Agentic

    DEFAULT_ARGS: list[str] = [
        # Auto-accept file edits — benchmark runs in isolated temp dirs
        "--permission-mode", "bypassPermissions",
        # Plain text output rather than streaming JSON
        "--output-format", "text",
    ]

    def __init__(
        self,
        cli_path: str = "claude",
        extra_args: list[str] | None = None,
        timeout_seconds: int = 1800,  # 30 min default
        model: str | None = None,  # Optional model override
        bare_mode: bool = False,
    ):
        self.tool_id = "claude-code"
        self.cli_path = self._resolve_cli_path(cli_path)
        # Combine default permission-granting args with any user-provided extras
        self.extra_args = list(self.DEFAULT_ARGS) + (extra_args or [])
        if bare_mode:
            self.extra_args.append("--bare")
        self.timeout_seconds = timeout_seconds
        self.model = model

    @staticmethod
    def _resolve_cli_path(cli_path: str) -> str:
        """
        Resolve the CLI path with Windows-aware extension lookup.

        On Windows, npm-installed shims (`.cmd`) mangle multi-line arguments —
        a 5-line prompt gets truncated to its first line because the shim's
        ``%*`` expansion doesn't preserve newlines. Instead, find the native
        ``.exe`` that the shim wraps and invoke it directly.

        Priority order on Windows:
          1. The path the user provided, if it's already a file
          2. The bundled native ``.exe`` under ``@anthropic-ai/claude-code/bin``
          3. ``.exe`` anywhere on PATH
          4. ``.cmd`` on PATH (last resort — known multi-line issue)

        On POSIX: standard ``shutil.which`` resolution.
        """
        import os

        # If already a full path with extension, trust it
        if os.path.isfile(cli_path):
            return cli_path

        if os.name == "nt":
            # First: try the npm-bundled native .exe (best on Windows)
            for npm_root in (
                os.environ.get("APPDATA", ""),
                os.path.expanduser("~"),
            ):
                if not npm_root:
                    continue
                bundled = os.path.join(
                    npm_root, "npm", "node_modules",
                    "@anthropic-ai", "claude-code", "bin", "claude.exe",
                )
                if os.path.isfile(bundled):
                    return bundled

            # Then: parse the cmd shim if it exists, to find the .exe it wraps
            cmd_path = shutil.which(cli_path + ".cmd")
            if cmd_path and os.path.isfile(cmd_path):
                try:
                    shim_text = open(cmd_path, "r", encoding="utf-8", errors="ignore").read()
                    # Look for a quoted .exe path the shim invokes
                    import re
                    match = re.search(r'"([^"]+\.exe)"', shim_text)
                    if match:
                        exe_rel = match.group(1).replace("%dp0%", os.path.dirname(cmd_path) + os.sep)
                        if os.path.isfile(exe_rel):
                            return exe_rel
                except OSError:
                    pass

            # Then: try .exe on PATH
            for ext in (".exe", ".bat", ".cmd", ""):
                candidate = cli_path if cli_path.endswith(ext) else cli_path + ext
                resolved = shutil.which(candidate)
                if resolved:
                    return resolved
            return cli_path

        # POSIX: shutil.which is reliable
        resolved = shutil.which(cli_path)
        return resolved or cli_path

    async def generate(
        self, prompt: str, mode: str = "prs_autonomous"
    ) -> ToolOutput:
        """Run claude -p in a temp directory and capture the output."""

        if not shutil.which(self.cli_path):
            return ToolOutput(
                tool_id=self.tool_id,
                model="unknown",
                mode=mode,
                prompt=prompt,
                output_files={},
                completion_status="failed",
                refusal_reason=f"Claude Code CLI not found at: {self.cli_path}",
                generated_at=datetime.now(timezone.utc),
            )

        started = time.monotonic()
        started_dt = datetime.now(timezone.utc)

        # On Windows, claude.exe may spawn child processes that lock the temp dir
        # past parent exit. Use ignore_cleanup_errors so the context manager
        # doesn't raise during teardown.
        with tempfile.TemporaryDirectory(
            prefix="sigil_claude_code_",
            ignore_cleanup_errors=True,
        ) as tmpdir:
            workdir = Path(tmpdir)

            # Build the CLI command. Pipe the prompt via stdin rather than
            # passing as a command-line argument — avoids Windows cmd quoting
            # issues with Unicode (em dashes, etc.), markdown separators (---),
            # and the 8191-char arg limit.
            cmd = [self.cli_path, "-p"]
            if self.model:
                cmd.extend(["--model", self.model])
            cmd.extend(self.extra_args)
            # Pass prompt as positional argument — stdin closure makes Claude
            # Code think the agent conversation has ended and it exits early.
            cmd.append(prompt)

            # UTF-8 environment for the child process so Unicode in the prompt
            # survives the trip through the Windows process boundary.
            child_env = {**os.environ, "PYTHONIOENCODING": "utf-8"}

            try:
                proc = await asyncio.create_subprocess_exec(
                    *cmd,
                    cwd=str(workdir),
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    env=child_env,
                )

                timed_out = False
                try:
                    stdout, stderr = await asyncio.wait_for(
                        proc.communicate(),
                        timeout=self.timeout_seconds,
                    )
                except asyncio.TimeoutError:
                    timed_out = True
                    proc.kill()
                    try:
                        stdout, stderr = await asyncio.wait_for(
                            proc.communicate(), timeout=10.0
                        )
                    except asyncio.TimeoutError:
                        stdout, stderr = b"", b""

                # Even on timeout, try to collect partial files
                if timed_out:
                    partial_files = self._collect_files(workdir)
                    return ToolOutput(
                        tool_id=self.tool_id,
                        model=self.model or "claude-code-default",
                        mode=mode,
                        prompt=prompt,
                        output_files=partial_files,
                        completion_status="partial" if partial_files else "timeout",
                        refusal_reason=f"Exceeded {self.timeout_seconds}s timeout"
                                       f"; {len(partial_files)} partial files preserved",
                        wall_clock_seconds=float(self.timeout_seconds),
                        generated_at=started_dt,
                        raw_response={
                            "returncode": -1,
                            "timed_out": True,
                            "files_collected": len(partial_files),
                            "stdout_tail": stdout.decode(errors="ignore")[-2000:],
                            "stderr_tail": stderr.decode(errors="ignore")[-2000:],
                        },
                    )

            except (FileNotFoundError, OSError) as exc:
                return ToolOutput(
                    tool_id=self.tool_id,
                    model="unknown",
                    mode=mode,
                    prompt=prompt,
                    output_files={},
                    completion_status="failed",
                    refusal_reason=f"Failed to execute {self.cli_path}: {exc}",
                    generated_at=started_dt,
                )

            elapsed = time.monotonic() - started

            # Read files Claude Code wrote to the workdir
            output_files = self._collect_files(workdir)

            # Detect refusal / completion status from stdout
            stdout_text = stdout.decode(errors="ignore")
            stderr_text = stderr.decode(errors="ignore")
            completion_status, refusal_reason = self._detect_status(
                stdout_text, stderr_text, proc.returncode, output_files
            )

            # Detect "not logged in" specifically — common first-run blocker
            if "Not logged in" in stdout_text or "Please run /login" in stdout_text:
                completion_status = "failed"
                refusal_reason = (
                    "Claude Code CLI not authenticated. "
                    "Run `claude` once interactively to log in, then retry."
                )

            return ToolOutput(
                tool_id=self.tool_id,
                model=self.model or "claude-code-default",
                mode=mode,
                prompt=prompt,
                output_files=output_files,
                completion_status=completion_status,
                refusal_reason=refusal_reason,
                wall_clock_seconds=elapsed,
                generated_at=started_dt,
                raw_response={
                    "returncode": proc.returncode,
                    "stdout_tail": stdout_text[-2000:],
                    "stderr_tail": stderr_text[-2000:],
                    "files_collected": len(output_files),
                },
            )

    def configuration_disclosure(self) -> dict[str, Any]:
        return {
            "tool_id": self.tool_id,
            "tool_name": "Claude Code (CLI)",
            "cli_path": self.cli_path,
            "model_override": self.model,
            "extra_args": self.extra_args,
            "timeout_seconds": self.timeout_seconds,
            "spectrum_position": self.spectrum_position,
            "spectrum_position_label": "Agentic",
        }

    # ----- Helpers -----

    @staticmethod
    def _collect_files(workdir: Path) -> dict[str, str]:
        """Read all reasonable text files Claude wrote to the workdir."""
        files: dict[str, str] = {}
        for path in workdir.rglob("*"):
            if not path.is_file():
                continue

            # Skip ignored directories
            if any(part in IGNORE_DIRS for part in path.parts):
                continue
            if path.name in IGNORE_FILES:
                continue

            try:
                if path.stat().st_size > MAX_FILE_SIZE:
                    continue
            except OSError:
                continue

            rel = path.relative_to(workdir).as_posix()
            try:
                files[rel] = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                # Skip binary; record name only
                files[rel] = f"<binary file, {path.stat().st_size} bytes>"
            except OSError as exc:
                logger.debug("Skipped %s: %s", path, exc)

        return files

    @staticmethod
    def _detect_status(
        stdout: str,
        stderr: str,
        returncode: int | None,
        output_files: dict[str, str],
    ) -> tuple[str, str | None]:
        """Classify completion based on CLI exit + output."""
        if returncode != 0:
            return "failed", f"Non-zero exit: {returncode}"

        if not output_files:
            return "partial", "No files written to workdir"

        lower = stdout.lower()
        for phrase in (
            "i can't help with",
            "i cannot assist with",
            "i won't provide",
            "i'm not able to",
        ):
            if phrase in lower:
                return "refused", phrase

        return "complete", None
