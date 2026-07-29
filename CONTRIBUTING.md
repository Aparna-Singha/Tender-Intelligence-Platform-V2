# Contributing

Thank you for contributing to Tender Intelligence Platform.

## Before starting

1. Read [AGENTS.md](AGENTS.md) and the relevant material under [`docs/`](docs/).
2. Confirm the issue or phase scope and inspect the current repository.
3. Update local `main` from the remote.
4. Create a focused branch such as `docs/<topic>`, `feat/<topic>`, or `fix/<topic>`.
5. Do not include secrets, personal data, customer documents, or proprietary tender
   material.

## Change expectations

- Keep changes within the approved phase.
- Follow strict TypeScript and module boundaries once application code exists.
- Add or update ADRs for decisions that are costly to reverse or affect multiple
  modules.
- Add tests for important business, authorization, privacy, and security behavior.
- Keep APIs documented in OpenAPI and document new environment variables.
- Use synthetic, public, licensed, or explicitly approved fixtures only.
- Do not represent mocks, fixtures, or incomplete integrations as live capabilities.

## Quality gates

Run repository-provided commands for:

- formatting;
- Markdown and code linting;
- strict type-checking;
- automated tests;
- production builds;
- internal documentation link validation.

Use the root pnpm scripts documented in [README.md](README.md). Do not weaken a
quality gate to make a change pass.

## Pull requests

Pull requests should explain the problem, scope, architecture impact, security and
privacy impact, test evidence, migration or rollback needs, documentation changes,
and known limitations. Keep pull requests reviewable and do not merge automatically.

At least one authorized reviewer should approve normal changes. Changes to
authentication, authorization, organisation isolation, cryptography, file handling,
AI safety policy, audit records, or data retention require security-aware review.

## Commit guidance

Use concise, imperative commit subjects. Separate unrelated work. Never bypass
quality gates by weakening rules or deleting meaningful tests without explaining why.

## Reporting security issues

Do not open a public issue for a suspected vulnerability. Follow
[SECURITY.md](SECURITY.md).
