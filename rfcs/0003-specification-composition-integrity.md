# RFC 0003: Specification & Composition Integrity as 7th Core Dimension (v0.6 Speculative)

| | |
|---|---|
| **RFC Number** | 0003 |
| **Title** | Specification & Composition Integrity as 7th Core Dimension |
| **Author(s)** | Sigil Benchmark Project Maintainers |
| **Status** | **Speculative** |
| **Opened** | 2026-05-20 |
| **Comment Period** | n/a (annual review per rfcs/README.md) |
| **Decision Date** | n/a — pending paradigm emergence |
| **Decision** | n/a |
| **Supersedes** | — |
| **Superseded By** | — |
| **Methodology Version Impact** | Minor (v0.5 → v0.6) if/when promoted to Draft |
| **Earliest Promotion to Draft** | 2027-Q3 (subject to annual review) |

---

## Status Notice

This RFC is intentionally **Speculative**. It documents a measurement framework for a paradigm shift in AI codegen that is **emerging in research labs but not yet dominant in production tools**. The RFC is not currently on the standard accept/reject path.

The RFC will be reviewed annually (next review: 2027-05) to determine whether:

1. The paradigm has materialized sufficiently that the dimension should be promoted to Draft and enter the normal comment period
2. The paradigm has not materialized and the RFC should remain Speculative for another year
3. The paradigm has been superseded by a different paradigm and this RFC should be Rejected or Superseded

**Why publish a Speculative RFC now?** Option-value publishing. If architecture-driven / verification-driven AI codegen becomes the dominant paradigm in 2-5 years, PRS already has the measurement framework drafted. The cost of publishing now is near-zero; the cost of being unprepared if the shift happens is significant.

---

## 1. Summary

This RFC anticipates a paradigm shift in AI code generation from **token-by-token generation** (current LLM paradigm) to **architecture-driven / verification-driven generation** (emerging paradigm). It proposes a 7th core dimension — **Specification & Composition Integrity** — that measures whether AI-generated code is built for verification, composition, and architectural soundness rather than just for passing tests.

Ten new sub-components cover: machine-readable specifications, type-driven design, composition manifests, invariant documentation, property-based test definitions, refactoring safety, boundary clarity, composition validation, specification completeness, and overall verifiability.

Proposed weight: **15%** at v0.6, redistributed from existing dimensions.

The dimension would only become useful if tools begin emitting specifications, refinement types, or verification artifacts alongside code. Current LLMs (Claude, GPT, etc.) score near-zero on most sub-components, which is **expected** and **not a problem with the dimension** — it correctly reports that current tools don't operate in this paradigm.

## 2. Motivation

### 2.1 The Paradigm Shift Already Underway in Research

Several research lines are converging on the same idea: instead of generating code and testing it post-hoc, generate code *with verifiable properties built in*.

| Research line | Status (as of 2026) |
|---|---|
| [Dafny](https://dafny.org/) — verification-aware imperative programming | Mature, used in Amazon AWS, Microsoft |
| [F\*](https://www.fstar-lang.org/) — verification + extraction to OCaml/F#/C | Mature, used in HACL\* (verified crypto) |
| [Lean 4](https://leanprover.github.io/) — theorem prover with code extraction | Mature, growing rapidly |
| [Idris 2](https://www.idris-lang.org/) — dependent types for correctness | Stable |
| [TLA+](https://lamport.azurewebsites.net/tla/tla.html) — protocol verification | Mature, used in Amazon S3, MongoDB |
| GPT-4 as Lean proof assistant | Early empirical work (Polu & Sutskever 2020, Jiang et al. 2023+) |
| LLMs generating Z3 / CVC5 formulas | Emerging |
| Sketch-based program synthesis | Active research |
| AI-assisted refinement types | Emerging |

These approaches share a common pattern:
1. Express *what the code should do* formally (spec, type, invariant)
2. Use AI to propose implementations
3. Verify the implementation matches the spec automatically
4. Iterate until verification passes

**The "interpreter" in this loop is the verifier** — Z3, Dafny, Lean's kernel, Idris's elaborator. The AI proposes; the interpreter judges. This is fundamentally different from current AI codegen, where the AI proposes and humans / tests judge.

### 2.2 Sigil's Strategic Position on This Paradigm

The Sigil composition architecture (the `sigil.yaml` + symbolic solver design described elsewhere in the project) is itself an architecture-driven approach. Components have declared interfaces; composition is constraint satisfaction; the runtime is an interpreter for these manifests.

If architecture-driven generation becomes dominant, PRS measuring this dimension positions PRS as the natural standard for the new paradigm. **The dimension is forward-looking but aligns with where serious work is going.**

### 2.3 Token-Generation Paradigm Limitations

Current LLM paradigm has structural limits:
- **Hallucination is endemic** (model invents plausible-but-wrong APIs)
- **Verification is post-hoc** (you find out after deployment)
- **Composition is dangerous** (combining two LLM outputs often produces emergent bugs)
- **Specifications are absent** (the only spec is the prompt, which is fuzzy)
- **Trust is non-transferable** (you can't formally prove correctness)

These are not problems that more training will solve. They are paradigm-level limitations. The next wave of tooling will address them by changing the paradigm, not by training larger LLMs.

### 2.4 What This Dimension Would Measure That v0.4/v0.5 Doesn't

| Aspect | v0.4 / v0.5 | v0.6 Speculative |
|---|---|---|
| Functional correctness | ✓ (tests pass) | ✓ (tests + formal proof) |
| Security | ✓ (vuln scanners) | ✓ + verified bounds (e.g., proven no buffer overflows) |
| Type safety | qual_05 in v0.5 | spec_02 dependent types, refinement types |
| Composition | implicit | spec_03 + spec_08 — explicit composition manifests + multi-component verification |
| Spec presence | — | spec_01 — machine-readable specs alongside code |
| Verifiability | — | spec_10 — output amenable to formal verification |

## 3. Detailed Design

### 3.1 New Dimension Specification

**Dimension ID:** `specification_composition_integrity`
**Dimension Name:** Specification & Composition Integrity
**Default Weight:** 15% (proposed; subject to revision)
**Adjustable Range:** 5-25%
**Activation:** When promoted to Draft, activated by default for all tasks. Tools currently score 0-2/10 on most sub-components; this is acceptable and expected.

### 3.2 Ten Sub-Components

Each scored 0-10; summed to dimension score 0-100.

| ID | Sub-component | What it measures |
|---|---|---|
| **spec_01** | Machine-readable specifications | Presence of TLA+, Dafny, Lean, F*, Z3, or equivalent formal-spec artifacts alongside generated code |
| **spec_02** | Type-driven design | Use of refinement types, dependent types, branded types, or expressive type systems that prevent classes of bugs at compile time |
| **spec_03** | Composition manifest | Machine-readable interface declarations (`sigil.yaml`-style, or OpenAPI / TypeBox / Schema.org equivalents) that enable composition verification |
| **spec_04** | Invariant documentation | Explicit invariant statements at class/module/function boundaries, parseable by static analysis or theorem provers |
| **spec_05** | Property-based test definitions | Tests defined as properties (Hypothesis, QuickCheck, fast-check) rather than only as example inputs |
| **spec_06** | Refactoring safety | Code passes automated refactoring transformations (rename, extract method, inline) without breaking semantic equivalence checks |
| **spec_07** | Boundary clarity | Module/component boundaries are explicit, with no implicit coupling (measured via static dependency graphs) |
| **spec_08** | Composition validation | When combined with other certified components, the combined output passes invariant checks |
| **spec_09** | Specification completeness | The specification alone (without reading the implementation) is sufficient to test the code's intended behavior |
| **spec_10** | Verifiability score | Overall amenability to formal verification — could a third party prove correctness from the artifacts provided? |

### 3.3 Proposed Weight Adjustments

Initial proposal (subject to comment period at promotion):

| Dimension | v0.5 (if Quality accepted) | v0.6 Proposed |
|---|---|---|
| Security | 20% | 18% |
| Production Ops | 20% | 18% |
| Scalability | 15% | 13% |
| Compliance | 15% | 13% |
| Cost Efficiency | 10% | 8% |
| Maintainability/Quality | 20% | 15% |
| **Specification & Composition Integrity** | **—** | **15%** |

Net effect: each existing dimension loses 2-5 percentage points to fund the new dimension. Subject to TSC sensitivity analysis.

### 3.4 Activation Rules

- The dimension is computed for **all tools and all tasks** once promoted from Speculative to Draft
- Tools producing no specification artifacts score near-zero, which is the correct measurement
- Sub-components that require formal-verification infrastructure (spec_05, spec_06, spec_08, spec_10) may use LLM-as-judge fallbacks during transition
- A "Specification-Aware" badge could be displayed alongside the score (e.g., "claude-code: PRS 155 / Spec-Integrity 5" vs hypothetical "lean-codex: PRS 142 / Spec-Integrity 78")

### 3.5 Implementation Status

**Not yet implemented.** No `harness/scoring/specification_composition_integrity.py` exists. Implementation is deferred until the RFC is promoted to Draft.

When implemented:
- spec_01, spec_03, spec_04: file-presence + parser checks
- spec_02: language-specific type-system feature detection
- spec_05: test-framework feature detection
- spec_06: automated refactoring tools (e.g., Refactoring Browser, IntelliJ structural search)
- spec_07: dependency-graph analysis (e.g., madge, depcheck)
- spec_08: composition harness (uses Sigil composition layer if available)
- spec_09: LLM-as-judge — can it generate tests from spec alone?
- spec_10: LLM-as-judge — could a proof assistant complete a verification given these artifacts?

## 4. Drawbacks

### 4.1 The Paradigm May Not Materialize

The single biggest risk. AI codegen could plateau at the current paradigm; architecture-driven tooling could fail to gain adoption; LLMs could continue improving without ever incorporating formal verification.

**If this happens, the dimension is dead weight.** Tools score uniformly low; no discrimination; no value.

**Mitigation:** Speculative status. The RFC sits in `rfcs/` without forcing methodology change. Annual review checks whether promotion is warranted.

### 4.2 Most Current Tools Will Score Near-Zero

When implemented, current LLM-based tools will score 0-15/100 on this dimension. Naive readers may interpret this as a failure of the tools rather than a measurement of the paradigm gap.

**Mitigation:** Display the score with explicit context ("this dimension measures architecture-driven generation; most current tools operate in token-generation paradigm and score near-zero by design"). Visual treatment (e.g., grayed-out or "not applicable" labeling) for tools clearly outside the paradigm.

### 4.3 Heavy Reliance on LLM-as-Judge

Several sub-components (spec_09, spec_10) inherently require judgment about whether artifacts are sufficient for verification. This is hard to automate without LLM-as-judge, which has known biases.

**Mitigation:** Cross-model judging (as already required in METHODOLOGY §13), with explicit calibration against human-expert ratings during methodology development.

### 4.4 Implementation Complexity

The sub-components require diverse infrastructure: refactoring tools, type-system analyzers, dependency graphs, theorem-prover integration. Costly to build and maintain.

**Mitigation:** Phased implementation. Start with file-presence and parser checks (spec_01, spec_03, spec_04); add LLM-as-judge fallbacks for sub-components requiring deeper analysis; substitute mature tooling as it matures.

### 4.5 Conflict With Current "Anti-LLM" Cynicism

A vocal subset of the AI-skeptic community argues that AI codegen is fundamentally inadequate. They may interpret this dimension as PRS implicitly endorsing the next AI hype cycle.

**Mitigation:** The dimension is paradigm-neutral. It measures *whether code has verifiable properties* — not *whether AI tools are good*. Hand-written formally-verified code would score 100; AI-generated unverified code would score 0. The dimension is about the property, not about who produces it.

## 5. Alternatives Considered

### Option A: Speculative RFC (this proposal)

Document the dimension now; review annually; promote when paradigm materializes.
**Selected.** Low cost; preserves option value; doesn't force premature methodology change.

### Option B: Don't Anticipate; React When Paradigm Hits

Wait for architecture-driven tools to appear before drafting any RFC.
**Rejected.** PRS would lose the first-mover advantage in becoming the standard reference for the new paradigm. Reactive rather than positioned.

### Option C: Promote to Draft Immediately (Force v0.6 with This Dimension)

Skip Speculative status; treat as standard Draft RFC.
**Rejected.** Insufficient current discrimination across tools; would damage methodology credibility ("PRS scores irrelevant; everyone scores 5").

### Option D: Treat as Optional Domain Dimension

Like Payment Security or Real-Time domain dimensions (METHODOLOGY §15), activate only for certain tools.
**Rejected.** Architecture-driven generation is universal-relevance — every task benefits from verifiability. Optional treatment understates importance.

### Option E: Combine With Maintainability/Quality (Single 6th Dimension)

Merge with the v0.5 Quality proposal into a unified "Engineering Discipline" dimension.
**Rejected.** Conceptually distinct. Maintainability measures human readability and refactor-ability; this dimension measures machine-verifiable properties. Conflating them hides important signal.

## 6. Unresolved Questions

1. **Annual review process:** Who decides whether to promote from Speculative to Draft? Same body as standard RFC decisions (maintainers / TSC)? Different threshold (2/3 supermajority for promotion vs simple majority for acceptance)?

2. **Speculative-to-Speculative supersession:** If RFC 0003 sits Speculative for 3 years and a more refined RFC supersedes it, what happens to historical references?

3. **Multi-language scope:** Verification tooling is unevenly distributed across languages. Lean is great for math; Dafny for sequential imperative code; TLA+ for protocols. Should sub-components weight language-appropriately, or require minimum tooling regardless?

4. **Verification depth:** "Verifiable" can mean type-checks, model-checks, theorem-prove, or full machine-checked correctness. Where does the dimension draw the line?

5. **AI-tool-vs-output ambiguity:** Should the dimension score the *tool* (does this tool integrate with theorem provers?) or the *output* (does this artifact include formal specs)? Could matter for procurement evaluation.

6. **Confidentiality of specs:** Production specs may contain business logic IP. How does the benchmark handle specs that aren't public?

7. **Backward compatibility:** Should v0.4 / v0.5 scores be retrospectively scored on Spec-Integrity if the dimension lands? Or only forward-going cycles?

## 7. Comments Received

| Date | Reviewer | Affiliation | Comment | Author Response |
|---|---|---|---|---|
| | | | (Speculative status; no formal comment period yet) | |

## 8. Decision Rationale

n/a — Speculative RFCs do not have a decision until promoted to Draft. Annual review notes will be appended here.

## 9. References

### Formal Verification & Architecture-Driven Generation

- [Dafny](https://dafny.org/) — verification-aware imperative programming, Microsoft Research
- [F\*](https://www.fstar-lang.org/) — verification + code extraction, used in HACL\* verified crypto
- [Lean 4](https://leanprover.github.io/) — theorem prover with code extraction
- [Idris 2](https://www.idris-lang.org/) — dependent types
- [TLA+](https://lamport.azurewebsites.net/tla/tla.html) — used in production at Amazon S3, MongoDB, Microsoft Azure
- [CompCert](https://compcert.org/) — verified C compiler used in aerospace
- [CertCoq](https://certicoq.org/) — verified compiler for Coq

### AI + Formal Methods Research

- Polu & Sutskever (2020) "Generative Language Modeling for Automated Theorem Proving"
- Jiang et al. (2023+) — LLM-assisted theorem proving with Lean
- [Thor](https://arxiv.org/abs/2205.10893) — language model + hammer for theorem proving

### Property-Based Testing

- Hypothesis (Python) — property-based testing
- QuickCheck (Haskell, ported to many languages) — original property-based testing
- fast-check (TypeScript) — property-based testing

### Composition & Architecture

- Sigil composition architecture (project-internal): `sigil.yaml` manifests + symbolic solver for component composition
- ArchUnit (Java) — testable architecture rules
- Dependency Cruiser — JS/TS dependency analysis

### Related Sigil Documents

- METHODOLOGY §16.7 Future Paradigms (when added)
- RFC 0001 — Maintainability/Quality dimension (v0.5)
