import { isDateOnlyExpired } from "@tender/domain";

export const currentEvidenceReasonCodes = [
  "ASSESSMENT_INVALIDATED",
  "CITATION_INVALID",
  "CITATION_MISMATCH",
  "DIRECT_SUPPORT_MISSING",
  "DOCUMENT_DELETED",
  "DOCUMENT_EXPIRED",
  "DOCUMENT_NOT_READY",
  "DOCUMENT_REPLACED",
  "FACT_EXPIRED",
  "FACT_NOT_ACCEPTED",
  "FACT_NOT_CURRENT",
  "RUN_INVALIDATED",
  "SOURCE_MISSING",
  "TENDER_CITATION_INVALID",
  "UNRESOLVED_CONFLICT",
] as const;
export type CurrentEvidenceReasonCode =
  (typeof currentEvidenceReasonCodes)[number];
export interface CurrentEvidenceVerdict {
  readonly status: "CURRENT" | "REASSESSMENT_REQUIRED";
  readonly checkedAt: string;
  readonly reasonCodes: readonly CurrentEvidenceReasonCode[];
}

export interface CurrentEvidenceLink {
  readonly linkType: string;
  readonly evidenceCitation: {
    readonly documentChecksum: string;
    readonly documentId: string;
    readonly documentVersionId: string;
    readonly evidenceFactVersionId: string;
    readonly invalidatedAt: Date | null;
    readonly organisationId: string;
    readonly validationStatus: string;
  } | null;
  readonly evidenceFactVersion: {
    readonly id: string;
    readonly documentVersionId: string;
    readonly reviewState: string;
    readonly validUntil: Date | null;
    readonly evidenceFact: {
      readonly organisationId: string;
      readonly currentVersionId: string | null;
      readonly documentId: string;
      readonly invalidatedAt: Date | null;
      readonly document: {
        readonly organisationId: string;
        readonly tenderScopeId: string | null;
        readonly currentVersionId: string | null;
        readonly currentVersion: { readonly sha256: string } | null;
        readonly deletedAt: Date | null;
        readonly expiryDate: Date | null;
        readonly status: string;
      };
    };
  } | null;
}

export function currentEvidenceFor(input: {
  readonly assessmentInvalidatedAt: Date | null;
  readonly checkedAt: Date;
  readonly currentState: string;
  readonly links: readonly CurrentEvidenceLink[];
  readonly organisationId: string;
  readonly reviewState: string;
  readonly runInvalidatedAt: Date | null;
  readonly runStatus: string;
  readonly tenderCitationStatus: string;
  readonly tenderId: string;
}): CurrentEvidenceVerdict | null {
  if (input.currentState !== "VERIFIED" || input.reviewState !== "FINALISED")
    return null;
  const reasons = new Set<CurrentEvidenceReasonCode>();
  if (input.runInvalidatedAt !== null || input.runStatus !== "COMPLETE")
    reasons.add("RUN_INVALIDATED");
  if (input.assessmentInvalidatedAt !== null)
    reasons.add("ASSESSMENT_INVALIDATED");
  if (input.tenderCitationStatus !== "VALID")
    reasons.add("TENDER_CITATION_INVALID");
  const direct = input.links.filter(
    (link) => link.linkType === "DIRECT_SUPPORT",
  );
  if (direct.length === 0) reasons.add("DIRECT_SUPPORT_MISSING");
  if (input.links.some((link) => link.linkType === "CONTRADICTS"))
    reasons.add("UNRESOLVED_CONFLICT");
  const directFailures = direct.map((link) =>
    directSupportFailures(link, input),
  );
  if (
    direct.length > 0 &&
    directFailures.every((failure) => failure.length > 0)
  )
    for (const failure of directFailures)
      for (const reason of failure) reasons.add(reason);
  return {
    checkedAt: input.checkedAt.toISOString(),
    reasonCodes: currentEvidenceReasonCodes.filter((reason) =>
      reasons.has(reason),
    ),
    status: reasons.size === 0 ? "CURRENT" : "REASSESSMENT_REQUIRED",
  };
}

function directSupportFailures(
  link: CurrentEvidenceLink,
  context: {
    readonly checkedAt: Date;
    readonly organisationId: string;
    readonly tenderId: string;
  },
): readonly CurrentEvidenceReasonCode[] {
  const reasons: CurrentEvidenceReasonCode[] = [];
  const fact = link.evidenceFactVersion;
  const citation = link.evidenceCitation;
  if (fact === null || citation === null) return ["SOURCE_MISSING"];
  const source = fact.evidenceFact;
  const document = source.document;
  if (
    source.organisationId !== context.organisationId ||
    citation.organisationId !== context.organisationId ||
    document.organisationId !== context.organisationId ||
    (document.tenderScopeId !== null &&
      document.tenderScopeId !== context.tenderId)
  )
    return ["SOURCE_MISSING"];
  if (fact.reviewState !== "ACCEPTED") reasons.push("FACT_NOT_ACCEPTED");
  if (source.invalidatedAt !== null || source.currentVersionId !== fact.id)
    reasons.push("FACT_NOT_CURRENT");
  if (
    fact.validUntil !== null &&
    isDateOnlyExpired(fact.validUntil, context.checkedAt)
  )
    reasons.push("FACT_EXPIRED");
  if (document.deletedAt !== null) reasons.push("DOCUMENT_DELETED");
  if (document.status !== "READY") reasons.push("DOCUMENT_NOT_READY");
  if (
    document.currentVersionId !== fact.documentVersionId ||
    document.currentVersion === null
  )
    reasons.push("DOCUMENT_REPLACED");
  if (
    document.expiryDate !== null &&
    isDateOnlyExpired(document.expiryDate, context.checkedAt)
  )
    reasons.push("DOCUMENT_EXPIRED");
  if (citation.validationStatus !== "VALID" || citation.invalidatedAt !== null)
    reasons.push("CITATION_INVALID");
  if (
    citation.evidenceFactVersionId !== fact.id ||
    citation.documentId !== source.documentId ||
    citation.documentVersionId !== fact.documentVersionId ||
    citation.documentChecksum !== document.currentVersion?.sha256
  )
    reasons.push("CITATION_MISMATCH");
  return reasons;
}
