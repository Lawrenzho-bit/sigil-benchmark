# Non-Interactive Execution Suffix (v0.4.1)

This standardized suffix is appended to task prompts when running tools in non-interactive mode (`claude -p`, `codex -p`, etc.). It exists because agentic CLIs in non-interactive mode often respond conversationally and ask for confirmation before writing files. The benchmark harness cannot answer those questions — the session ends after the first turn — so without this suffix, agentic tools may consistently silent-decline despite being capable of building the task.

**Methodology status:** Introduced 2026-05-21 as a v0.4.1 patch in response to the test-retest variance finding documented in LEADERBOARD.md. Prior to this suffix, claude-code's measured completion rate on a previously-successful task (T01 terse) was 25% over N=4 runs because runs 2-4 produced confirmation-seeking conversational responses rather than file writes.

**When to use:** Any benchmark run targeting an agentic tool in non-interactive (`-p` / batch) mode. Disclose use of the suffix in the run's `tool_config` per METHODOLOGY §11.

**When NOT to use:** Interactive sessions where a human is present to answer follow-up questions; runs specifically testing how the tool handles ambiguity-resolution requests.

**Reproducibility:** This file is versioned with the methodology. Updates to the wording require an RFC.

---

## The Suffix (verbatim, appended to the prompt after a blank line and `---`)

IMPORTANT: Begin writing files immediately. Do not ask for confirmation. Use sensible defaults for any ambiguities. Build the complete codebase in the current working directory now.
