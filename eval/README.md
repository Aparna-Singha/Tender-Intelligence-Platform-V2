# AI Quality Evaluation

Phase 16 owns a small synthetic golden suite for OCR, extraction, citation,
RAG, and controlled drafting regression checks. The fixtures are not customer
data, scraped tenders, or accuracy claims for all real-world scans.

Run deterministic evaluation:

```bash
pnpm eval:offline
```

Generated reports are written to `eval/results/` and should be treated as build
artifacts unless intentionally promoted.
