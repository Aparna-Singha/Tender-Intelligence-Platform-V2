# Phase 16 AI Quality, OCR, and Evaluation

Phase 16 adds local OCR and repository-owned AI quality regression evaluation.
The golden suite is synthetic and measures regression behavior only; it is not a
universal accuracy claim for Indian tender scans or provider quality.

## OCR Architecture

PDF parsing still prefers embedded text. A page is sent to OCR only when pdf.js
extracts fewer than 20 usable characters. Searchable pages keep native text;
mixed PDFs preserve native pages and OCR only low-text pages.

OCR uses `tesseract.js` 6.0.1, Apache-2.0, `@tesseract.js-data/eng` 1.0.0,
MIT, and `@napi-rs/canvas` 1.0.5, MIT, for local bounded PDF rasterization.
The adapter points at packaged local WASM and English traineddata paths and uses
no OCR cache/network fallback. No tender page is sent to a cloud OCR service.
OCR runs page-by-page inside the worker job timeout and each OCR page has a 30
second page timeout, a render scale of 2, and a 6,000,000 pixel page limit.

## Provenance And Confidence

No migration is required. Existing extracted-unit fields record:

- `ocr_status`: `NOT_REQUIRED`, `OCR_PERFORMED`, `OCR_FAILED`,
  `OCR_UNAVAILABLE`, or `HUMAN_REVIEW_REQUIRED`.
- `ocr_confidence`: normalized 0-1 OCR confidence when available.
- `parser_confidence`: mapped to `HIGH`, `MEDIUM`, `LOW`, or
  `HUMAN_REVIEW_REQUIRED`.

`extraction_run_documents.parser_configuration` records safe OCR engine,
version, policy, render scale, page timeout, and page pixel bounds. Extraction
quality summary records OCR pages attempted, succeeded, and unavailable.

Low-confidence OCR remains low/review. OCR failure does not become an empty
successful page; it creates a review-safe issue and bounded status.

## Evaluation

The synthetic golden manifest lives in `eval/fixtures/golden/manifest.json`.
It covers extraction fields, requirements, citation validation, OCR fixture
policy metrics, RAG policy-fixture outcomes, prompt-injection-like evidence, and
controlled draft grounding/placeholder behavior.

Run:

```bash
pnpm eval:offline
```

The deterministic report contains policy version, fixture checksum, case count,
field/requirement recall, citation validation rate, OCR fixture character and
word error rates, RAG fixture-policy outcomes, draft grounding checks, and
failure cases. Extraction, citation, chunking, prompt-injection detection, and
draft support checks call repository implementation code. OCR CER/WER currently
compare synthetic manifest strings, and RAG outcomes use a small deterministic
fixture policy rather than provider-backed retrieval or answer generation.
Generated reports under `eval/results/` are transient unless intentionally
promoted.

`pnpm eval:offline` is part of hosted CI. `pnpm eval:provider` is intentionally
not run in CI.

Provider-backed evaluation is opt-in:

```bash
pnpm eval:provider
```

When `GEMINI_API_KEY` is absent, this reports `NOT VERIFIED - provider
credential unavailable`. When configured, it runs a small bounded smoke covering
an embedding call, one supported answer, and one insufficient-evidence answer.
It does not print or commit the key and does not persist raw prompts or provider
responses.

## Provider Hardening

The Gemini adapter now maps missing keys, aborted requests, rate limits, provider
5xx responses, malformed JSON, missing candidate content, invalid schema, and
embedding dimension mismatch to stable bounded categories. Public failure codes
and worker records do not include prompts, source text, raw provider response, or
API keys.

## Observability

Worker metrics include `tip_worker_ai_operation_duration_seconds` with bounded
labels only: `provider`, `operation`, and `outcome`. Operations are `embedding`,
`rag_answer`, and `draft_generation`. Token and cost reporting remain unavailable
unless the provider supplies safe usage metadata and a documented pricing source
is added later.

## Limits

This phase does not implement Phase 17 production governance, retention,
provider-contract governance, secret management, disaster recovery, or a
penetration test. It also does not redesign the UI.
