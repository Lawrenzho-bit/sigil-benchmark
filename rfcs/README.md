# Sigil Benchmark RFCs

This directory holds the formal change-proposals (Requests for Comments) for the Sigil Benchmark methodology.

## What Belongs Here

Any substantive change to:

- The PRS methodology (dimensions, sub-components, weights, scoring rubric)
- The benchmark cycle protocol (pre-registration, runs per condition, prompt variants)
- Statistical methodology (CIs, multiple-comparison correction, aggregation)
- Governance structure (TSC formation, conflict-of-interest rules)
- Versioning policy (what triggers a major vs minor vs patch bump)

What does **not** need an RFC:

- Bug fixes in the reference implementation
- Documentation typos / clarifications
- New tool adapters (just open a PR)
- New task specifications (PR with prompt + acceptance criteria)
- Per-run benchmark results

## Lifecycle

```
        ┌────────┐
        │ Draft  │ ← PR opened to rfcs/ directory
        └───┬────┘
            │
            ▼
        ┌────────────────────┐
        │ Comment period     │ ← 2-4 weeks, public on GitHub
        │ (open for review)  │
        └───┬────────────────┘
            │
            ▼
        ┌────────────────────┐
        │ Decision           │ ← maintainers vote; TSC if formed
        └───┬────────────────┘
            │
       ┌────┼────┐
       ▼    ▼    ▼
  Accepted Rejected  Needs Revision
```

**Accepted** RFCs are merged with a `Status: Accepted` header and become part of the methodology's permanent record. The PR description documents the decision rationale.

**Rejected** RFCs are merged with `Status: Rejected` and a written rationale. They remain part of the record so future contributors don't re-propose the same idea without context.

**Needs Revision** RFCs are closed; the author can reopen with the requested changes.

**Superseded** RFCs are updated with a header pointing to the newer RFC that supersedes them.

**Speculative** RFCs document changes that anticipate a paradigm shift in the AI codegen landscape. They are intentionally not on the standard accept/reject path because the conditions for their adoption do not yet exist (e.g., the tools that would benefit from being measured by them are still in research). Speculative RFCs sit in the `rfcs/` directory as **option-value publishing**: if the paradigm materializes, the measurement framework is already drafted; if it doesn't, no methodology change is forced.

Speculative RFCs are reviewed at least annually by the TSC (or maintainers, until TSC formation) to determine whether they should be:
- Promoted to standard Draft status and entered into the normal comment period
- Marked as Superseded by a newer Speculative or Draft RFC
- Marked as Rejected (the anticipated paradigm did not materialize)
- Kept Speculative for another year

## How to Propose an RFC

1. Copy `0000-template.md` to `NNNN-short-name.md` where `NNNN` is the next available zero-padded number (e.g., `0002-add-payment-dimension.md`)
2. Fill in all required sections
3. Open a Pull Request titled `RFC NNNN: Short Description`
4. Tag the PR with `rfc` label
5. Announce in the project's discussion thread (if any) so the comment period begins
6. Engage with feedback during the comment period
7. Maintainers (or TSC, once formed) make a decision at the end of the comment period

## Comment Period

- **Standard:** 2 weeks (14 days)
- **Major methodology changes (version bumps to v0.5+, v1.0+):** 4 weeks (28 days)
- **Emergency / security fixes:** 72 hours, with rationale

The comment period begins when the PR is opened and announced. Extensions require explicit maintainer / TSC approval.

## Decision Authority

**Currently** (pre-TSC): Project maintainers approve / reject RFCs via simple majority. In the event of a tie, the lead maintainer breaks the tie.

**Future** (post-TSC formation): The Technical Steering Committee approves / rejects RFCs via 2/3 supermajority. TSC members with declared conflicts of interest recuse themselves from votes affecting their employers' tools.

## Numbering

RFCs are numbered sequentially, zero-padded to 4 digits:

- `0000-template.md` — the template (not an RFC)
- `0001-add-quality-dimension.md` — first real RFC
- `0002-...` — second
- etc.

Numbers are assigned at the time the RFC is opened, not at proposal. Use the next available number; if two PRs collide, the second one rebases to the next number.

## Index of RFCs

| Number | Title | Status | Comment Period | Decision |
|---|---|---|---|---|
| [0001](0001-add-quality-dimension.md) | Add Maintainability/Quality as 6th Core Dimension (v0.5) | Draft | TBD | TBD |
| [0003](0003-specification-composition-integrity.md) | Specification & Composition Integrity as 7th Core Dimension (v0.6) | **Speculative** | n/a (annual review) | n/a |

## Inspirations

The RFC process draws on:

- [IETF RFCs](https://www.ietf.org/standards/rfcs/) — the original
- [Rust RFCs](https://github.com/rust-lang/rfcs) — modern open-source RFC model
- [Kubernetes KEPs](https://github.com/kubernetes/enhancements) — structured enhancement proposals
- [Python PEPs](https://peps.python.org/) — proposal numbering and lifecycle
- [TC39 Process](https://tc39.es/process-document/) — staged proposals
