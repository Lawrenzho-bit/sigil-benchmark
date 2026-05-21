"""
Diagnostic: capture EXACTLY what claude -p says when the smoke harness
reports 'No files written to workdir'. Mimics the adapter's subprocess
invocation precisely but prints stdout/stderr verbatim regardless of
file output, so we can see whether claude is asking for confirmation,
refusing, erroring, or doing something else.

Usage:
    python scripts/diag_claude_silent_decline.py
"""

from __future__ import annotations

import asyncio
import os
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from harness.tools.claude_code import ClaudeCodeAdapter


async def main() -> None:
    prompt_path = REPO_ROOT / "tasks" / "task_01_b2b_portal" / "prompt_terse.md"
    suffix_path = REPO_ROOT / "tasks" / "shared" / "non_interactive_suffix.md"

    prompt = prompt_path.read_text(encoding="utf-8")
    suffix_text = suffix_path.read_text(encoding="utf-8")
    marker = "appended to the prompt after a blank line and `---`)\n\n"
    suffix = suffix_text[suffix_text.find(marker) + len(marker):].strip()
    prompt = f"{prompt.rstrip()}\n\n---\n\n{suffix}\n"

    adapter = ClaudeCodeAdapter()
    cli_path = adapter.cli_path
    print(f"CLI resolved to: {cli_path}")
    print(f"Prompt length: {len(prompt)} chars")
    print(f"Prompt tail (last 300 chars):")
    print(repr(prompt[-300:]))
    print("---")

    cmd = [cli_path, "-p", "--permission-mode", "bypassPermissions", "--output-format", "text", prompt]
    child_env = {**os.environ, "PYTHONIOENCODING": "utf-8"}

    with tempfile.TemporaryDirectory(prefix="sigil_diag_", ignore_cleanup_errors=True) as tmpdir:
        print(f"workdir: {tmpdir}")

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=tmpdir,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=child_env,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=120)
        except asyncio.TimeoutError:
            proc.kill()
            print("[TIMED OUT at 120s]")
            return

        print(f"returncode: {proc.returncode}")
        print("---STDOUT---")
        print(stdout.decode(errors="ignore"))
        print("---STDERR---")
        print(stderr.decode(errors="ignore"))
        print("---FILES IN WORKDIR---")
        for p in Path(tmpdir).rglob("*"):
            if p.is_file():
                print(f"  {p.relative_to(tmpdir).as_posix()} ({p.stat().st_size} bytes)")


if __name__ == "__main__":
    asyncio.run(main())
