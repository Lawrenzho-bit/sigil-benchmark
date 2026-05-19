"""
Claude tool adapter (via Anthropic API).

Tests Claude as a benchmarked codegen tool. Generates code in a single API call
or as an agentic multi-turn loop depending on configuration.
"""

from __future__ import annotations

import os
import re
import time
from datetime import datetime, timezone
from typing import Any

from anthropic import AsyncAnthropic
from tenacity import retry, stop_after_attempt, wait_exponential

from harness.tools.base import ToolAdapter, ToolOutput


SYSTEM_PROMPT_DEFAULT = """You are a senior engineer producing production-ready code.

For the given task, output a complete codebase. Use markdown code blocks
with explicit file paths in the format:

```language path/to/file.ext
<code contents>
```

Include:
- All source files needed to deploy
- Dockerfile
- README with setup instructions
- .env.example with required variables
- CI/CD configuration

Do not omit files for brevity. The output must be deployable as-is."""


FILE_BLOCK_PATTERN = re.compile(
    r"```([a-zA-Z0-9_-]*)\s+([^\n`]+?)\n(.*?)```",
    re.DOTALL,
)


class ClaudeAdapter(ToolAdapter):
    """Tool adapter for Claude via Anthropic API."""

    spectrum_position = 2  # Augmentative (when used as IDE assistant)

    def __init__(
        self,
        model: str = "claude-sonnet-4-5",
        max_tokens: int = 16000,
        temperature: float = 0.7,
        system_prompt: str = SYSTEM_PROMPT_DEFAULT,
        api_key: str | None = None,
    ):
        self.tool_id = f"claude-{model}"
        self.model = model
        self.max_tokens = max_tokens
        self.temperature = temperature
        self.system_prompt = system_prompt
        self.client = AsyncAnthropic(api_key=api_key or os.environ.get("ANTHROPIC_API_KEY"))

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=2, min=4, max=60),
    )
    async def generate(self, prompt: str, mode: str = "prs_autonomous") -> ToolOutput:
        """Generate code for the prompt."""
        started = time.monotonic()
        started_dt = datetime.now(timezone.utc)

        response = await self.client.messages.create(
            model=self.model,
            max_tokens=self.max_tokens,
            temperature=self.temperature,
            system=self.system_prompt,
            messages=[{"role": "user", "content": prompt}],
        )

        elapsed = time.monotonic() - started

        # Extract text content
        text_content = "\n".join(
            block.text for block in response.content if block.type == "text"
        )

        # Detect refusal
        completion_status, refusal_reason = self._detect_refusal(text_content)

        # Parse file blocks from the response
        output_files = self._parse_file_blocks(text_content)

        # If we got nothing parseable, completion is partial
        if not output_files and completion_status == "complete":
            completion_status = "partial"

        return ToolOutput(
            tool_id=self.tool_id,
            model=self.model,
            mode=mode,
            prompt=prompt,
            output_files=output_files,
            completion_status=completion_status,
            refusal_reason=refusal_reason,
            tokens_input=response.usage.input_tokens,
            tokens_output=response.usage.output_tokens,
            wall_clock_seconds=elapsed,
            generated_at=started_dt,
            raw_response={
                "id": response.id,
                "model": response.model,
                "stop_reason": response.stop_reason,
                "usage": {
                    "input_tokens": response.usage.input_tokens,
                    "output_tokens": response.usage.output_tokens,
                },
            },
        )

    def configuration_disclosure(self) -> dict[str, Any]:
        return {
            "tool_id": self.tool_id,
            "tool_name": "Claude (Anthropic API)",
            "model": self.model,
            "max_tokens": self.max_tokens,
            "temperature": self.temperature,
            "system_prompt_hash": _short_hash(self.system_prompt),
            "system_prompt_length": len(self.system_prompt),
            "spectrum_position": self.spectrum_position,
            "spectrum_position_label": "Augmentative",
        }

    # ----- Helpers -----

    @staticmethod
    def _parse_file_blocks(text: str) -> dict[str, str]:
        """Extract files from markdown code blocks with path annotations."""
        files: dict[str, str] = {}
        for match in FILE_BLOCK_PATTERN.finditer(text):
            _language, path, content = match.groups()
            path = path.strip()
            if path and not path.startswith("#"):
                files[path] = content.rstrip("\n")
        return files

    @staticmethod
    def _detect_refusal(text: str) -> tuple[str, str | None]:
        """Heuristic refusal detection. Returns (status, reason)."""
        text_lower = text.lower()
        refusal_phrases = [
            "i can't help with",
            "i cannot assist with",
            "i won't provide",
            "i'm not able to provide",
            "i don't feel comfortable",
            "against my guidelines",
        ]
        for phrase in refusal_phrases:
            if phrase in text_lower:
                return "refused", phrase
        return "complete", None


def _short_hash(text: str) -> str:
    """Stable short hash for configuration disclosure."""
    import hashlib

    return hashlib.sha256(text.encode()).hexdigest()[:16]
