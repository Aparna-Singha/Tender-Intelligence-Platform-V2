# Deterministic Evidence Comparison Policy

Policy version: `deterministic-evidence-v1`

## Prerequisite gate

A run starts only for the current tender version when its active Phase 5
extraction and active Phase 6 `EARLY` risk run are complete and valid, and the
latest unsuperseded human pursuit decision for that exact risk run is `CONTINUE`.
`HOLD`, `STOP`, missing, superseded, cross-version, or cross-run decisions block
the workflow.

## Controlled states

- `verified`: direct current cited evidence, explicitly finalised by a reviewer.
- `likely_met`: partial, indirect, self-declared, or awaiting confirmation.
- `missing`: a complete defined snapshot contains no usable evidence.
- `conflict`: cited or structured sources contradict; all sources remain visible.
- `not_applicable`: an authorised human records an applicability basis.
- `human_review_required`: evidence scope, interpretation, parsing, or confidence
  is insufficient.

Machine proposals remain immutable and separate from the append-only human
decision history. The deterministic engine never proposes `verified` or
`not_applicable`, never resolves conflicts, never applies MSME exemptions, and
never uses keyword overlap as proof.

## Baseline rules and limits

Numeric thresholds are compared only with compatible units and without
undocumented conversion. Turnover uses explicit financial-year rows and is never
double-counted. Document metadata can show `DOCUMENT_EXISTS_ONLY`; detailed
certification, licence, OEM scope, experience similarity, technical, conditional,
commercial, and legal questions require a cited structured fact or human review.
Expired evidence cannot provide current support.

Limits are 2,000 requirements per run, 20 fact links per assessment, 100 rows per
API page, 1,000 characters per company excerpt, 2,000 characters per assessment
rationale, two bounded worker attempts, worker concurrency two, and a five-minute
SSE connection window. Queue messages contain opaque IDs only.

## Invalidation

Profile, turnover, readiness, document, evidence-fact, extraction, risk-run,
pursuit-decision, tender-version, or policy changes invalidate affected current
runs and clear active pointers. Historical snapshots, proposals, links, and
reviews remain readable; final states are never copied to a replacement run.
