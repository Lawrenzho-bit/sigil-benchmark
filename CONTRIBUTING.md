# Contributing to the Sigil Benchmark

Thank you for your interest in contributing. The Sigil Benchmark is an open methodology and reference implementation for measuring AI-generated code production readiness. Contributions of all kinds are welcome.

## Quick Start

1. Fork the repository
2. Create a feature branch: `git checkout -b my-contribution`
3. Make your changes
4. Run the demo pipeline to verify nothing's broken: `python scripts/demo_pipeline.py`
5. Open a Pull Request with a clear description

## Most-Wanted Contributions

### Sub-Component Implementations

The v0 scaffold implements 32 of 50 sub-components via static analysis. The remaining 18 require live deployment + probes. High-value implementations:

- **OWASP ASVS L1 test suite** ([sec_03](tasks/shared/scoring_rubric_v04.yaml)): Standardized auth correctness probes
- **OWASP ZAP / sqlmap integration** ([sec_05, sec_06](tasks/shared/scoring_rubric_v04.yaml)): SQL injection and XSS resistance
- **k6 load test integration** ([scale_01, scale_02](tasks/shared/scoring_rubric_v04.yaml)): 1k and 10k concurrent load tests
- **Functional compliance verification** ([comp_01](tasks/shared/scoring_rubric_v04.yaml)): Browser-based verification that cookie consent actually blocks tracking

### Task Specifications

Tasks 5-10 need full specifications (prompt variants + acceptance criteria):

- Task 05: Analytics dashboard
- Task 06: Project management app
- Task 07: Subscription portal
- Task 08: Document management
- Task 09: Booking system
- Task 10: API service + webhooks

See [tasks/task_01_b2b_portal/](tasks/task_01_b2b_portal/) for the canonical template.

### Tool Adapters

Adapters for additional AI codegen tools:

- Devin (when public API stabilizes)
- Mythos
- Bolt / Lovable / v0 (via manual collection — adapter exists; needs collection workflows)
- GitHub Copilot CLI (when available)
- Cursor CLI / agent mode

See [harness/tools/](harness/tools/) for adapter patterns. Each adapter implements the [`ToolAdapter`](harness/tools/base.py) interface.

### Integration Mocks

Standardized mocks per [METHODOLOGY §16](METHODOLOGY.md):

- Email service (SendGrid/Postmark/Resend/SES compatible)
- Payment processor (Stripe/Lemon Squeezy compatible)
- SSO provider (Okta/Azure AD/Auth0 compatible)
- Storage service (S3/R2/GCS compatible)
- Webhook receiver (generic signed webhook)
- Database (Postgres/MySQL compatible)

### Validity Studies

- **Concurrent validity**: Recruit senior engineers to manually score outputs; compare to PRS
- **Discriminant validity**: Identify known-similar and known-different tool pairs; verify PRS discriminates
- **Test-retest reliability**: Run PRS on same outputs multiple times; measure ICC

### Documentation

- Tutorial-style content
- Architectural decision records
- Translations of methodology docs

## Methodology Changes

Changes to the PRS methodology itself (not just implementations) follow a separate process:

1. Open an Issue tagged `methodology` with the proposed change
2. Tag relevant maintainers for review
3. After discussion, open a PR with the change clearly marked
4. Methodology PRs require approval from 2+ maintainers
5. Major version bumps (v0.x → v1.0+) require pre-registered RFC process

Once Sigil Foundation is formed, methodology changes will go through the Technical Steering Committee (TSC) per [METHODOLOGY §14](METHODOLOGY.md).

## Code Style

- Python 3.11+
- Type hints required for new public APIs
- Async/await for I/O-bound code
- `ruff` for linting (config in `pyproject.toml`)
- `mypy` for type checking (strict mode)
- Tests are encouraged but not required for v0 contributions

## Conflict of Interest

If you work for an AI codegen tool vendor and your contribution affects how that tool is benchmarked, please disclose this in the PR description. Conflicts of interest don't disqualify contributions but they will be reviewed with extra scrutiny.

## Code of Conduct

Be respectful. Engage in good faith. Assume positive intent. We're building a public standard; that requires collaboration across institutional and ideological lines.

If you experience or witness behavior contrary to this spirit, please open a confidential issue or contact the maintainers directly.

## License

By contributing, you agree that your contributions will be licensed under [Apache License 2.0](LICENSE).

## Recognition

All contributors are listed in the repository. Substantial methodology contributors may be invited to join the TSC once Sigil Foundation is formed.
