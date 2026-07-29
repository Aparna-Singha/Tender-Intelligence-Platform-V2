export const EVIDENCE_COMPARISON_POLICY_VERSION = "deterministic-evidence-v1";
export const EVIDENCE_NORMALISATION_POLICY_VERSION = "manual-cited-facts-v1";

export const eligibilityStates = [
  "VERIFIED",
  "LIKELY_MET",
  "MISSING",
  "CONFLICT",
  "NOT_APPLICABLE",
  "HUMAN_REVIEW_REQUIRED",
] as const;

export type EligibilityState = (typeof eligibilityStates)[number];
export type MachineProposedState = Exclude<
  EligibilityState,
  "VERIFIED" | "NOT_APPLICABLE"
>;

export interface ComparisonRequirement {
  readonly category: string;
  readonly confidence: "HIGH" | "MEDIUM" | "LOW" | "HUMAN_REVIEW_REQUIRED";
  readonly findingState: string;
  readonly obligation: "MANDATORY" | "OPTIONAL" | "CONDITIONAL" | "UNSPECIFIED";
  readonly sourceWording: string;
  readonly tenderCitationIds: readonly string[];
  readonly threshold?: {
    readonly currency?: string;
    readonly operator: string;
    readonly unit?: string;
    readonly value: number;
  };
}

export interface ComparisonEvidence {
  readonly citationId?: string;
  readonly confidence: number;
  readonly documentCurrent: boolean;
  readonly documentReady: boolean;
  readonly documentVerified: boolean;
  readonly expiresAt?: Date;
  readonly factType: string;
  readonly sourceKind:
    "PROFILE" | "TURNOVER" | "DOCUMENT_METADATA" | "MANUAL_DOCUMENT_FACT";
  readonly value?: boolean | Date | number | string | readonly string[];
  readonly valueUnit?: string;
  readonly verificationStatus: string;
}

export interface AssessmentProposal {
  readonly confidence: number;
  readonly directEvidenceIndexes: readonly number[];
  readonly policyRule: string;
  readonly rationale: string;
  readonly state: MachineProposedState;
  readonly uncertainty: string;
}

export function proposeEligibilityAssessment(
  requirement: ComparisonRequirement,
  evidence: readonly ComparisonEvidence[],
  now = new Date(),
): AssessmentProposal {
  if (requirement.tenderCitationIds.length === 0)
    return review(
      "TENDER_CITATION_REQUIRED",
      "The requirement has no validated tender citation.",
    );
  if (
    requirement.findingState !== "FOUND" ||
    requirement.confidence === "LOW" ||
    requirement.confidence === "HUMAN_REVIEW_REQUIRED" ||
    requirement.obligation === "CONDITIONAL"
  )
    return review(
      "AMBIGUOUS_OR_CONDITIONAL_REQUIREMENT",
      "The tender requirement needs human interpretation before comparison.",
    );

  const usable = evidence.filter(
    (item) =>
      item.documentReady &&
      item.documentCurrent &&
      (item.expiresAt === undefined || item.expiresAt >= now),
  );
  const contradictions = usable
    .map((item, index) => ({ index, item }))
    .filter(({ item }) => item.verificationStatus === "CONFLICTING");
  if (contradictions.length > 0)
    return {
      confidence: 0.9,
      directEvidenceIndexes: contradictions.map(({ index }) => index),
      policyRule: "EVIDENCE_CONFLICT",
      rationale:
        "Authorised sources conflict; all conflicting provenance is retained.",
      state: "CONFLICT",
      uncertainty: "An authorised reviewer must resolve the conflict.",
    };

  if (requirement.threshold !== undefined) {
    const numeric = usable.filter(
      (item): item is ComparisonEvidence & { value: number } =>
        typeof item.value === "number",
    );
    if (numeric.length === 0)
      return review(
        "NUMERIC_EVIDENCE_SCOPE_INCOMPLETE",
        "No compatible structured numeric evidence is available.",
      );
    const compatible = numeric.filter(
      (item) =>
        requirement.threshold?.unit === undefined ||
        item.valueUnit === requirement.threshold.unit,
    );
    if (compatible.length === 0)
      return review(
        "INCOMPATIBLE_UNITS",
        "The available numeric evidence uses an incompatible or ambiguous unit.",
      );
    const met = compatible.some((item) =>
      compareNumber(
        item.value,
        requirement.threshold?.operator ?? "",
        requirement.threshold?.value ?? Number.NaN,
      ),
    );
    return {
      confidence: 0.85,
      directEvidenceIndexes: compatible
        .map((item) => evidence.indexOf(item))
        .filter((index) => index >= 0),
      policyRule: "NUMERIC_THRESHOLD",
      rationale: met
        ? "Compatible structured evidence meets the cited threshold."
        : "Compatible structured evidence does not meet the cited threshold.",
      state: met ? "LIKELY_MET" : "CONFLICT",
      uncertainty: met
        ? "A reviewer must confirm scope and cited evidence before verification."
        : "A reviewer must confirm the apparent incompatibility.",
    };
  }

  const direct = usable.filter(
    (item) =>
      item.sourceKind === "MANUAL_DOCUMENT_FACT" &&
      item.citationId !== undefined &&
      item.documentVerified,
  );
  if (direct.length > 0)
    return {
      confidence: Math.min(...direct.map((item) => item.confidence)),
      directEvidenceIndexes: direct
        .map((item) => evidence.indexOf(item))
        .filter((index) => index >= 0),
      policyRule: "CITED_MANUAL_FACT",
      rationale: "Current cited evidence appears to support this requirement.",
      state: "LIKELY_MET",
      uncertainty: "Only an authorised human may finalise VERIFIED.",
    };

  if (usable.some((item) => item.sourceKind === "DOCUMENT_METADATA"))
    return {
      confidence: 0.45,
      directEvidenceIndexes: [],
      policyRule: "DOCUMENT_EXISTS_ONLY",
      rationale:
        "A relevant approved document exists, but its detailed scope is not established.",
      state: "LIKELY_MET",
      uncertainty:
        "Document existence alone is not proof of detailed compliance.",
    };

  return review(
    "UNSUPPORTED_REQUIREMENT",
    "The defined evidence scope is incomplete or has no safely comparable fact.",
  );
}

export function canHumanFinaliseVerified(input: {
  readonly directCompanyCitationValid: boolean;
  readonly evidenceApprovedAndCurrent: boolean;
  readonly hasDirectSupport: boolean;
  readonly hasUnresolvedConflict: boolean;
  readonly rationale: string;
  readonly tenderCitationValid: boolean;
}): boolean {
  return (
    input.hasDirectSupport &&
    input.tenderCitationValid &&
    input.directCompanyCitationValid &&
    input.evidenceApprovedAndCurrent &&
    !input.hasUnresolvedConflict &&
    input.rationale.trim().length >= 10
  );
}

function compareNumber(
  actual: number,
  operator: string,
  threshold: number,
): boolean {
  if (operator === ">=" || operator === "AT_LEAST") return actual >= threshold;
  if (operator === ">" || operator === "MORE_THAN") return actual > threshold;
  if (operator === "<=" || operator === "AT_MOST") return actual <= threshold;
  if (operator === "<" || operator === "LESS_THAN") return actual < threshold;
  return actual === threshold;
}

function review(policyRule: string, rationale: string): AssessmentProposal {
  return {
    confidence: 0,
    directEvidenceIndexes: [],
    policyRule,
    rationale,
    state: "HUMAN_REVIEW_REQUIRED",
    uncertainty: rationale,
  };
}
