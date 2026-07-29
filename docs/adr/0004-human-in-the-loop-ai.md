# ADR 0004: Require Human Control of High-Stakes AI

- Status: Accepted
- Date: 2026-07-29

## Context

Tender eligibility, compliance, commercial commitments, and bid content can have
legal and financial consequences. LLMs can misunderstand clauses, follow malicious
document instructions, produce unsupported claims, or hide uncertainty behind fluent
language.

## Decision

AI assists with extraction, risk identification, evidence comparison, retrieval, and
drafting, subject to these rules:

- never invent company facts;
- never silently decide ambiguous legal or compliance questions;
- cite every important tender finding by document, page, and clause;
- refuse unsupported questions;
- keep final high-stakes decisions under authorized human control.

AI can propose eligibility states but policy-defined human action is required for
final verification, not-applicable decisions, conflict resolution, approval, and
blocking-risk disposition. Drafts require human review. The system performs risk
analysis immediately after tender processing and again during final readiness audit.
No model action can automatically submit a bid or approve its own output.

## Consequences

- Workflows must represent uncertainty, review state, rationale, evidence versions,
  and accountable actors.
- Human review adds time but reduces silent automation risk.
- Interfaces cannot use language or defaults that imply AI certainty or government
  endorsement.
- Model and prompt changes require safety, citation, refusal, and isolation
  regression evaluation.

## Alternatives considered

- **Fully autonomous bidding:** rejected as unsafe and explicitly outside scope.
- **AI output with an informal disclaimer only:** rejected because disclaimers do not
  enforce workflow control.
- **No AI assistance:** rejected because evidence-grounded assistance can provide
  value when bounded and reviewed.
