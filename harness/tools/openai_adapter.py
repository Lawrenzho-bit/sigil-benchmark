"""
OpenAI/GPT tool adapter.

Tests OpenAI models (GPT-5, GPT-4, o1-series) as benchmarked codegen tools.
Mirrors the ClaudeAdapter pattern.
"""

from __future__ import annotations

import os
import time
from datetime import datetime, timezone
from typing import Any

from openai import AsyncOpenAI
from tenacity import retry, stop_after_attempt, wait_exponential

from harness.tools.base import ToolAdapter, ToolOutput
from harness.tools.claude import FILE_BLOCK_PATTERN, SYSTEM_PROMPT_DEFAULT, _short_hash


class OpenAIAdapter(ToolAdapter):
    """Tool adapter for OpenAI's GPT family."""

    spectrum_position = 2  # Augmentative (when used as IDE assistant)

    def __init__(
        self,
        model: str = "gpt-5",
        max_tokens: int = 16000,
        temperature: float = 0.7,
        system_prompt: str = SYSTEM_PROMPT_DEFAULT,
        api_key: str | None = None,
        reasoning_effort: str | None = None,  # For o-series models
    ):
        self.tool_id = f"openai-{model}"
        self.model = model
        self.max_tokens = max_tokens
        self.temperature = temperature
        self.system_prompt = system_prompt
        self.reasoning_effort = reasoning_effort
        self.client = AsyncOpenAI(api_key=api_key or os.environ.get("OPENAI_API_KEY"))

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=2, min=4, max=60),
    )
    async def generate(self, prompt: str, mode: str = "prs_autonomous") -> ToolOutput:
        """Generate code for the prompt."""
        started = time.monotonic()
        started_dt = datetime.now(timezone.utc)

        # Build request kwargs (reasoning_effort only applies to o-series)
        kwargs: dict[str, Any] = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": self.system_prompt},
                {"role": "user", "content": prompt},
            ],
            "max_tokens": self.max_tokens,
        }
        # Reasoning models don't accept temperature
        if not self.model.startswith("o"):
            kwargs["temperature"] = self.temperature
        if self.reasoning_effort and self.model.startswith("o"):
            kwargs["reasoning_effort"] = self.reasoning_effort

        response = await self.client.chat.completions.create(**kwargs)

        elapsed = time.monotonic() - started

        # Extract text content
        text_content = response.choices[0].message.content or ""

        # Detect refusal
        completion_status, refusal_reason = self._detect_refusal(
            text_content, response.choices[0].finish_reason
        )

        # Parse file blocks from the response
        output_files = self._parse_file_blocks(text_content)

        # Partial if no parseable files
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
            tokens_input=response.usage.prompt_tokens if response.usage else None,
            tokens_output=response.usage.completion_tokens if response.usage else None,
            wall_clock_seconds=elapsed,
            generated_at=started_dt,
            raw_response={
                "id": response.id,
                "model": response.model,
                "finish_reason": response.choices[0].finish_reason,
                "usage": {
                    "prompt_tokens": response.usage.prompt_tokens if response.usage else None,
                    "completion_tokens": response.usage.completion_tokens if response.usage else None,
                },
            },
        )

    def configuration_disclosure(self) -> dict[str, Any]:
        return {
            "tool_id": self.tool_id,
            "tool_name": "OpenAI GPT",
            "model": self.model,
            "max_tokens": self.max_tokens,
            "temperature": self.temperature if not self.model.startswith("o") else None,
            "reasoning_effort": self.reasoning_effort,
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
    def _detect_refusal(text: str, finish_reason: str | None) -> tuple[str, str | None]:
        """Heuristic refusal detection."""
        if finish_reason == "content_filter":
            return "refused", "openai_content_filter"
        if finish_reason == "length":
            return "partial", "max_tokens_reached"

        text_lower = text.lower()
        refusal_phrases = [
            "i can't help with",
            "i cannot assist with",
            "i won't provide",
            "i'm not able to provide",
            "against openai's usage policies",
        ]
        for phrase in refusal_phrases:
            if phrase in text_lower:
                return "refused", phrase
        return "complete", None
