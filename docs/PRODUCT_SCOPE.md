# Product Scope

## Purpose

Tender Intelligence Platform helps Indian MSMEs and tender professionals turn
manually supplied tender material and reusable company evidence into a traceable,
human-reviewed bid-readiness package.

It reduces reading and coordination effort; it does not replace professional,
commercial, technical, or legal judgment.

> **Non-affiliation disclaimer:** This independent product is not affiliated with,
> endorsed by, or operated by GeM, CPPP, or any government authority. It does not
> guarantee eligibility, compliance, submission, award, or bid success.

## Product users

| User | Primary responsibility |
| --- | --- |
| MSME owner/admin | Owns the organisation workspace, membership, and company profile |
| Tender executive | Ingests tenders, maps evidence, and prepares drafts |
| Tender consultant | Supports authorized client organisations and tender work |
| Reviewer/approver | Reviews findings, exceptions, drafts, and readiness |
| Platform administrator | Operates the platform without assuming customer authority |

Permissions will be explicit, organisation-scoped, and least-privilege. Consultant
access must be granted per organisation; platform administration must be audited and
must not imply routine access to customer documents.

## Initial product journey

1. Create an account and organisation.
2. Complete progressive onboarding without blocking all value on day one.
3. Upload reusable company documents.
4. Manually upload a tender and its annexures or corrigenda.
5. Parse and structure the tender.
6. Show an immediate cited risk analysis before drafting.
7. Compare requirements with approved company evidence.
8. Generate a missing-document checklist.
9. Provide a tender-scoped RAG chatbot.
10. Generate a fact-constrained first draft.
11. Require human review and approval.
12. Run a second risk analysis within the final readiness audit.
13. Export a review package.

The two risk analyses are distinct gates. The first informs the go/no-go and
preparation process. The second evaluates the current evidence, review state, open
exceptions, corrigenda, and draft immediately before export.

## Initial tender inputs

- manual PDF upload;
- ZIP or annexure upload;
- corrigendum upload;
- official source URL with manually entered metadata;
- curated demonstration fixtures;
- administrator import.

An official source URL is provenance metadata, not proof that the platform fetched,
verified, or continuously monitors the source. Demonstration fixtures must be
clearly labelled and contain no private customer material.

## Initial outcomes

- structured requirements and dates traceable to source passages;
- a cited risk register;
- requirement-to-evidence comparisons using controlled eligibility states;
- missing-document and unresolved-review checklists;
- tender-scoped, citation-backed answers;
- drafts limited to supported facts and marked for review;
- a final readiness report and review package with audit context.

## Explicit exclusions

The initial scope excludes:

- automatic GeM scraping;
- automatic bid submission;
- nationwide live-tender claims;
- guaranteed eligibility;
- guaranteed bid success;
- fully autonomous bidding;
- native mobile applications;
- premature microservice proliferation.

Direct portal automation, payment, digital signing, legal advice, and autonomous
go/no-go decisions are also not implied by this scope.

## Success principles

The first milestone prioritizes traceability, privacy, honest uncertainty, and human
control over breadth. Measurable requirements are defined in
[Acceptance Criteria](ACCEPTANCE_CRITERIA.md).
