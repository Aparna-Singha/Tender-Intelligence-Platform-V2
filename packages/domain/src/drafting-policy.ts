import { createHash } from "node:crypto";

export const DRAFTING_POLICY_VERSION = "fact-constrained-drafting-v1";
export const DRAFT_PROMPT_POLICY_VERSION = "cited-draft-json-v1";
export const DRAFT_TEMPLATE_POLICY_VERSION = "controlled-template-v1";
export const DRAFT_MAX_INSTRUCTION_CHARACTERS = 2_000;
export const DRAFT_MAX_SECTION_CHARACTERS = 12_000;
export const DRAFT_MAX_SECTIONS = 40;
export const DRAFT_MAX_CLAIMS_PER_SECTION = 80;
export const DRAFT_MAX_CONTEXTS_PER_SECTION = 8;

export const draftTypes = [
  "REQUIREMENT_RESPONSE",
  "TECHNICAL_RESPONSE",
  "ELIGIBILITY_RESPONSE",
  "COMPANY_PROFILE_RESPONSE",
  "EXPERIENCE_RESPONSE",
  "CERTIFICATION_RESPONSE",
  "OEM_AUTHORISATION_RESPONSE",
  "DELIVERY_AND_SUPPORT_RESPONSE",
  "DECLARATION_RESPONSE",
  "CLARIFICATION_AND_DEVIATION_RESPONSE",
  "CONSOLIDATED_FIRST_DRAFT",
] as const;
export type DraftType = (typeof draftTypes)[number];

export const draftClaimClasses = [
  "TENDER_SOURCE_STATEMENT",
  "APPROVED_COMPANY_FACT",
  "HUMAN_AUTHORED_COMMITMENT",
  "DERIVED_ASSESSMENT_REFERENCE",
  "RISK_OR_CHECKLIST_WARNING",
  "INFERENCE_REQUIRING_REVIEW",
  "PLACEHOLDER",
] as const;
export type DraftClaimClass = (typeof draftClaimClasses)[number];

export const draftPlaceholderTypes = [
  "MISSING_APPROVED_COMPANY_FACT",
  "MISSING_DOCUMENT_EVIDENCE",
  "UNRESOLVED_CONFLICT",
  "HUMAN_REVIEW_REQUIRED",
  "TECHNICAL_INPUT_REQUIRED",
  "COMMERCIAL_INPUT_REQUIRED",
  "SIGNATORY_INPUT_REQUIRED",
  "CLARIFICATION_REQUIRED",
  "SOURCE_EXTRACTION_UNAVAILABLE",
  "EXPIRED_EVIDENCE",
  "UNSUPPORTED_COMMITMENT",
  "OTHER",
] as const;
export type DraftPlaceholderType = (typeof draftPlaceholderTypes)[number];

export interface DraftGateInput {
  readonly extractionCurrent: boolean;
  readonly riskCurrent: boolean;
  readonly pursuitDecision: "CONTINUE" | "HOLD" | "STOP" | null;
  readonly assessmentCurrent: boolean;
  readonly evidenceSnapshotCurrent: boolean;
  readonly checklistCurrent: boolean;
  readonly ragIndexCurrent: boolean;
  readonly providerConfigured: boolean;
}

export type DraftGateFailure =
  | "EXTRACTION_NOT_CURRENT"
  | "RISK_NOT_CURRENT"
  | "CONTINUE_DECISION_REQUIRED"
  | "ASSESSMENT_NOT_CURRENT"
  | "EVIDENCE_SNAPSHOT_NOT_CURRENT"
  | "CHECKLIST_NOT_CURRENT"
  | "RAG_INDEX_NOT_CURRENT"
  | "PROVIDER_UNAVAILABLE";

export function evaluateDraftStartGate(
  input: DraftGateInput,
): readonly DraftGateFailure[] {
  const failures: DraftGateFailure[] = [];
  if (!input.extractionCurrent) failures.push("EXTRACTION_NOT_CURRENT");
  if (!input.riskCurrent) failures.push("RISK_NOT_CURRENT");
  if (input.pursuitDecision !== "CONTINUE")
    failures.push("CONTINUE_DECISION_REQUIRED");
  if (!input.assessmentCurrent) failures.push("ASSESSMENT_NOT_CURRENT");
  if (!input.evidenceSnapshotCurrent)
    failures.push("EVIDENCE_SNAPSHOT_NOT_CURRENT");
  if (!input.checklistCurrent) failures.push("CHECKLIST_NOT_CURRENT");
  if (!input.ragIndexCurrent) failures.push("RAG_INDEX_NOT_CURRENT");
  if (!input.providerConfigured) failures.push("PROVIDER_UNAVAILABLE");
  return failures;
}

export interface ControlledTemplateSection {
  readonly key: string;
  readonly heading: string;
  readonly order: number;
  readonly allowedClaimClasses: readonly DraftClaimClass[];
  readonly requiredSourceClasses: readonly string[];
  readonly formattingGuidance: string;
}

export function validateTemplateSections(
  sections: readonly ControlledTemplateSection[],
): boolean {
  if (sections.length === 0 || sections.length > DRAFT_MAX_SECTIONS)
    return false;
  const keys = new Set<string>();
  return sections.every((section, index) => {
    if (
      !/^[a-z0-9][a-z0-9_-]{1,79}$/.test(section.key) ||
      section.heading.trim().length === 0 ||
      section.heading.length > 240 ||
      section.order !== index ||
      section.allowedClaimClasses.length === 0 ||
      section.formattingGuidance.length > 1_000 ||
      /<script|javascript:|https?:\/\/|{{\s*include|<iframe/i.test(
        section.formattingGuidance,
      ) ||
      keys.has(section.key)
    )
      return false;
    keys.add(section.key);
    return section.allowedClaimClasses.every((value) =>
      draftClaimClasses.includes(value),
    );
  });
}

export interface ClaimPolicyInput {
  readonly claimClass: DraftClaimClass;
  readonly material: boolean;
  readonly citationCount: number;
  readonly approvedEvidence: boolean;
  readonly reviewedHumanInput: boolean;
}

export function claimSupportState(
  input: ClaimPolicyInput,
): "SUPPORTED" | "UNSUPPORTED" | "HUMAN_REVIEW_REQUIRED" {
  if (input.claimClass === "PLACEHOLDER") return "HUMAN_REVIEW_REQUIRED";
  if (input.claimClass === "INFERENCE_REQUIRING_REVIEW")
    return "HUMAN_REVIEW_REQUIRED";
  if (
    input.claimClass === "APPROVED_COMPANY_FACT" &&
    (!input.approvedEvidence || input.citationCount === 0)
  )
    return "UNSUPPORTED";
  if (
    input.claimClass === "HUMAN_AUTHORED_COMMITMENT" &&
    !input.reviewedHumanInput
  )
    return "HUMAN_REVIEW_REQUIRED";
  if (input.material && input.citationCount === 0) return "UNSUPPORTED";
  return "SUPPORTED";
}

export interface ApprovalPolicyInput {
  readonly actorUserId: string;
  readonly versionCreatorUserId: string;
  readonly hasApprovalPermission: boolean;
  readonly isCurrentVersion: boolean;
  readonly sourcesCurrent: boolean;
  readonly unsupportedMaterialClaims: number;
  readonly unresolvedConflicts: number;
  readonly blockingPlaceholders: number;
  readonly unvalidatedHumanEdits: number;
  readonly unreviewedCommitments: number;
  readonly rationale: string;
}

export function draftApprovalBlockers(
  input: ApprovalPolicyInput,
): readonly string[] {
  const blockers: string[] = [];
  if (!input.hasApprovalPermission)
    blockers.push("APPROVAL_PERMISSION_REQUIRED");
  if (input.actorUserId === input.versionCreatorUserId)
    blockers.push("SEPARATION_OF_DUTIES_REQUIRED");
  if (!input.isCurrentVersion) blockers.push("CURRENT_VERSION_REQUIRED");
  if (!input.sourcesCurrent) blockers.push("CURRENT_SOURCES_REQUIRED");
  if (input.unsupportedMaterialClaims > 0)
    blockers.push("UNSUPPORTED_MATERIAL_CLAIMS");
  if (input.unresolvedConflicts > 0) blockers.push("UNRESOLVED_CONFLICTS");
  if (input.blockingPlaceholders > 0) blockers.push("BLOCKING_PLACEHOLDERS");
  if (input.unvalidatedHumanEdits > 0) blockers.push("UNVALIDATED_HUMAN_EDITS");
  if (input.unreviewedCommitments > 0) blockers.push("UNREVIEWED_COMMITMENTS");
  if (input.rationale.trim().length < 10)
    blockers.push("APPROVAL_RATIONALE_REQUIRED");
  return blockers;
}

export function visiblePlaceholder(explanation: string): string {
  return `[[REVIEW REQUIRED: ${explanation.trim()}]]`;
}

export function draftSourceFingerprint(input: object): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export function isUnsafeDraftInstruction(text: string): boolean {
  return /\b(ignore|override|reveal|exfiltrate|submit|approve|export|browse|fetch)\b.{0,100}\b(policy|instruction|secret|credential|tenant|organisation|bid|url|tool)\b/i.test(
    text,
  );
}

export function canonicalCompanyEvidenceStatement(input: {
  readonly factType: string;
  readonly value: {
    readonly booleanValue: boolean | null;
    readonly currency: string | null;
    readonly dateValue: Date | string | null;
    readonly financialYear: string | null;
    readonly numberValue: { toString(): string } | null;
    readonly scope: string | null;
    readonly textListValue: readonly string[];
    readonly textValue: string | null;
    readonly unit: string | null;
  };
}): string {
  return `${input.factType}: ${canonicalCompanyEvidenceValue(input.value)}`;
}

export function canonicalCompanyEvidenceSourceText(input: {
  readonly boundedExcerpt: string;
  readonly factType: string;
  readonly value: Parameters<
    typeof canonicalCompanyEvidenceStatement
  >[0]["value"];
}): string {
  return `${canonicalCompanyEvidenceStatement(input)}. Evidence: ${input.boundedExcerpt}`;
}

function canonicalCompanyEvidenceValue(
  value: Parameters<typeof canonicalCompanyEvidenceStatement>[0]["value"],
): string {
  const primary =
    value.textValue ??
    value.numberValue?.toString() ??
    (value.dateValue instanceof Date
      ? value.dateValue.toISOString().slice(0, 10)
      : value.dateValue?.slice(0, 10)) ??
    value.booleanValue?.toString() ??
    value.textListValue.join(", ");
  return [primary, value.unit, value.currency, value.financialYear, value.scope]
    .filter((item): item is string => item !== null && item.trim() !== "")
    .join(" | ");
}
