# Provider Validation

Status: provider execution blocked by external Gemini project access.

This release-validation document covers the existing Gemini-backed AI paths using
synthetic data only. It is not a statistical model-quality claim and does not
certify production readiness.

## Provider

- Provider: Gemini
- Configured chat model: `gemini-2.5-flash`
- Configured embedding model: `gemini-embedding-001`
- Credential source: local environment only
- Real credential available: no, the configured credential/project is rejected by
  Gemini as unavailable for provider calls

No API key, prompt body, document text beyond synthetic summaries, signed URL,
database URL, session data, or tenant secret is recorded in this document.

## Synthetic Scope

The provider runner in `tools/eval-provider.mjs` is the release-validation entry
point. It uses the existing `GeminiGateway` instead of adding a second provider
framework.

When a valid provider credential is available, the runner exercises:

- RAG-1 supported answer;
- RAG-2 insufficient evidence;
- RAG-3 conflicting evidence;
- RAG-4 prompt injection inside evidence;
- RAG-5 tenant/source boundary, with cross-tenant source omitted before provider
  input;
- DRAFT-1 supported draft;
- DRAFT-2 unsupported company fact;
- DRAFT-3 unsupported commitment.

## Result

`pnpm eval:provider` was executed locally. The runner performed a provider
preflight through the existing Gemini gateway and stopped before the case matrix
because Gemini denied the configured project/credential. The generated safe report
contains:

- status: `NOT_VERIFIED`
- reason: `AI_PROVIDER_UNAVAILABLE`
- cases executed: 0

The required real-provider cases remain unverified until a valid Gemini project
credential is provided.

## Failure-Behavior Coverage

Provider-failure behavior is covered with mocks where intentionally triggering a
live provider failure would be unsafe or unreliable. The focused worker adapter
test covers:

- missing provider key;
- malformed structured output;
- embedding dimension mismatch;
- rate-limit classification;
- provider 5xx classification;
- denied provider project classification;
- abort handling;
- structured draft response validation.

The release-validation work fixed denied provider project responses so 401/403
responses are classified as `AI_PROVIDER_UNAVAILABLE` rather than generic invalid
provider output.

## Known Limitations

- Real RAG and draft generation behavior is not verified in this run because the
  configured Gemini credential/project is unavailable.
- Citation quality, refusal behavior, conflict surfacing, prompt-injection
  resistance, and draft placeholder behavior require the same runner to pass with
  a valid Gemini credential.
- Live provider validation is intentionally excluded from hosted CI.
- External provider governance remains blocked on approved provider access,
  retention/training-use review, regional-processing review, and operational cost
  controls.
