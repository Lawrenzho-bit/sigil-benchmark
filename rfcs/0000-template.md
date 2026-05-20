# RFC NNNN: Title

| | |
|---|---|
| **RFC Number** | NNNN |
| **Title** | Short descriptive title |
| **Author(s)** | Name(s), affiliation if any |
| **Status** | Draft / Comment Period / Accepted / Rejected / Superseded |
| **Opened** | YYYY-MM-DD |
| **Comment Period** | YYYY-MM-DD to YYYY-MM-DD |
| **Decision Date** | YYYY-MM-DD (set on close) |
| **Decision** | TBD (Accepted / Rejected / Needs Revision) |
| **Supersedes** | (RFC number, if applicable) |
| **Superseded By** | (RFC number, if applicable) |
| **Methodology Version Impact** | Patch / Minor (v0.x.0) / Major (v1.0.0) |

---

## 1. Summary

One to three paragraphs describing what is being proposed and why. A reader should grasp the proposal from this section alone.

## 2. Motivation

Why does this change matter? What problem does it solve? What evidence or prior art supports the need?

Cite:
- Existing methodology sections being changed
- Prior art (academic papers, industry reports)
- Empirical evidence (benchmark results, real-world failures)
- Community feedback (GitHub issues, discussions)

## 3. Detailed Design

The actual proposed change, written precisely enough that a reasonable implementer could execute it. Include:

- Specific text changes to METHODOLOGY.md (or other documents)
- New sub-components / dimensions / rubric items with exact scoring criteria
- Implementation notes for `harness/` if applicable
- Migration plan for existing scores (if change breaks comparability)
- Examples / worked cases

## 4. Drawbacks

Honest acknowledgment of downsides. Examples:

- Breaks score continuity with prior versions
- Adds methodological complexity
- Increases compute / time / human-review burden per cycle
- Requires new dependencies
- Creates new edge cases or failure modes

Do not understate drawbacks. Reviewers will find them anyway.

## 5. Alternatives Considered

Other approaches that were considered and why they were rejected.

For each alternative:
- **Option X**: brief description
- **Why rejected**: 1-2 sentences

## 6. Unresolved Questions

Questions that the RFC does not answer but that should be resolved before the change ships. Examples:

- Exact threshold values
- How to handle edge cases
- Cross-version migration policy

## 7. Comments Received

A summary of substantive comments received during the comment period and how they were addressed. Maintained by the RFC author or designee.

| Date | Reviewer | Comment | Author Response |
|---|---|---|---|
| | | | |

## 8. Decision Rationale

Filled in by the deciding body (maintainers or TSC) at the end of the comment period. Documents:

- Final decision (Accepted / Rejected / Needs Revision)
- Vote count (if applicable)
- Key arguments for the decision
- Conditions on acceptance (if any)
- Implementation timeline (if accepted)

## 9. References

Academic papers, prior RFCs, related issues, etc.
