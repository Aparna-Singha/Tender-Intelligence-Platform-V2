# ADR 0017: Deterministic passive PDF renderer

## Status

Accepted for Phase 12 implementation; ADR 0016 remains Proposed until final validation.

## Decision

The worker owns review-PDF rendering and uses exactly pinned `pdf-lib` 1.17.1 (MIT). It is a pure JavaScript library with no native executable, browser runtime, network renderer, or runtime font download. Its installed dependency tree is limited to JavaScript support packages. Repository audit output contains pre-existing Fastify-chain findings but no finding introduced by `pdf-lib`.

Rendering accepts only a server-created bounded canonical model under `controlled-review-package-renderer-compatibility-v1`. It uses fixed layout, metadata, timestamps, ordering, and standard embedded font bytes. Browser/native renderers, shell tools, HTML/CSS/SVG input, system fonts, and remote resources are prohibited.

Phase 12 v1 supports only characters that the selected embedded standard font can encode exactly. Unsupported characters fail closed with a bounded renderer code; they are never transliterated, replaced, or removed. Adding broader script coverage requires stable repository-owned permissively licensed font bytes, an explicit compatibility-version change, security and licence review, and cross-platform fixture tests.

The PDF is described only as deterministic passive output. No PDF/A, digital-signature, certification, or submission-readiness claim is made. Upgrades require an exact dependency pin, regenerated deterministic fixtures, structural passive-content inspection, dependency/audit review, and a new renderer compatibility identifier whenever bytes or supported text coverage can change.
