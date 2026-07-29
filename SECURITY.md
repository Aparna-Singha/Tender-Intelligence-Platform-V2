# Security Policy

## Reporting a vulnerability

Do not disclose suspected vulnerabilities in public issues, discussions, pull
requests, demonstrations, or tender fixtures.

Use GitHub's private vulnerability reporting feature for this repository when it is
enabled. If it is unavailable, contact the repository owner through a private,
verified channel and request a secure reporting path. Do not send secrets, customer
documents, exploit payloads, or personal data until that path is confirmed.

Include a concise description, affected component, impact, reproduction conditions,
and suggested remediation if known. Use synthetic data.

## Response expectations

Maintainers should acknowledge a report within five business days, establish
severity and next steps, limit disclosure to people who need access, and coordinate
remediation and disclosure with the reporter. These are response targets, not a
bug-bounty promise.

## Supported versions

There is no production release yet. Only the latest default branch is planned to
receive security updates during initial development. A version support table will be
added before the first release.

## Security baseline

Contributors must:

- keep organisation data isolated and enforce authorization server-side;
- use least-privilege service identities and short-lived credentials where possible;
- encrypt data in transit and use managed encryption at rest;
- store uploads in private object storage and use short-lived signed access;
- validate and malware-scan uploads before processing;
- protect authentication with secure sessions, rate limits, and audit events;
- redact secrets, tokens, personal data, and document content from logs;
- treat tender content and retrieved context as untrusted prompt input;
- require citations and human control for high-stakes AI output;
- avoid committing secrets, customer data, or private tender files;
- test important business and security boundaries.

The detailed threat model and controls are in
[`docs/SECURITY_MODEL.md`](docs/SECURITY_MODEL.md). AI retrieval controls are in
[`docs/RAG_POLICY.md`](docs/RAG_POLICY.md).
