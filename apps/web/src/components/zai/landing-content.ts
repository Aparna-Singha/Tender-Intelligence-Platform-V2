export const faqs = [
  {
    q: "Does the platform submit bids to GeM or CPPP on my behalf?",
    a: "No. The platform helps you understand, assess and prepare your tender response. Submission to government portals such as GeM or CPPP remains your responsibility. We do not perform automated portal scraping or autonomous bid submission.",
  },
  {
    q: "Can the AI declare my company eligible for a tender?",
    a: "No. The AI proposes assessments by comparing tender requirements against your approved company evidence. Authoritative conclusions — Verified, Conflict, Missing — are only set by a human reviewer. The platform never guarantees eligibility, compliance or bid success.",
  },
  {
    q: "What happens when a self-declared profile value is entered?",
    a: "A self-declared value is treated as a claim, not as verified evidence. The platform visually distinguishes self-declared values from reviewed evidence throughout the workspace.",
  },
  {
    q: "How does the platform handle corrigenda?",
    a: "A corrigendum stays associated with the original tender, preserves the source version, and flags conflicting requirements. Authoritative information is updated only after review. Stale analysis and approvals linked to changed requirements are automatically invalidated.",
  },
  {
    q: "Are my uploaded documents secure?",
    a: "Documents are stored in private, access-controlled object storage. Uploads are validated, malware-scanned and processed within bounded workers. Document binaries are never exposed via public URLs. All access is organisation-scoped.",
  },
  {
    q: "What does the AI chat cite?",
    a: "Every factual claim in an AI response links to a specific citation: document name, version, page, clause and excerpt. If the assistant cannot find adequate evidence, it says so explicitly. A retrieval-only fallback is clearly labelled when AI generation is unavailable.",
  },
];
