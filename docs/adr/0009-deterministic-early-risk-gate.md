# ADR 0009: Use a deterministic cited early-risk gate

- Status: Accepted
- Date: 2026-07-29

## Context

Users need intrinsic tender-risk analysis before company evidence or drafting. The
repository has no production-ready LLM gateway.

## Decision

Implement a deterministic `EARLY` gate over the exact active completed extraction.
Persist immutable runs and findings, reuse validated extraction citations, and
require append-only human reviews and human-only pursuit decisions. Define
`FINAL_READINESS` only to distinguish the future gate.

## Consequences

The baseline is explainable, versioned, reproducible, and cannot invent citations.
It only identifies explicit rule conditions. Future model assistance must use a
provider-neutral gateway and cannot bypass citations or human control.

## Alternatives considered

- A fake Gemini adapter was rejected.
- A mutable latest report was rejected because it loses audit history.
- Automated pursuit recommendations were rejected as a high-stakes decision.
