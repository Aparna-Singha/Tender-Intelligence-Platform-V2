export const FINAL_READINESS_POLICY_VERSION =
  "final-readiness-deterministic-v1";
export const FINAL_READINESS_EXPIRY_POLICY_VERSION =
  "evidence-expiry-30-calendar-days-v1";
export const FINAL_READINESS_REQUIRED_DRAFT_POLICY_VERSION =
  "required-consolidated-first-draft-v1";
export const FINAL_READINESS_EXPIRY_WARNING_DAYS = 30;
export const FINAL_READINESS_REQUIRED_DRAFT_TYPE = "CONSOLIDATED_FIRST_DRAFT";

export const finalReadinessTreatments = [
  "BLOCKER",
  "HUMAN_DISPOSITION_REQUIRED",
  "WARNING",
  "INFORMATIONAL",
] as const;
export type FinalReadinessTreatment = (typeof finalReadinessTreatments)[number];

export const finalReadinessDispositions = [
  "PROCEED_TO_CONTROLLED_EXPORT_REVIEW",
  "HOLD_FOR_REMEDIATION",
  "STOP_PURSUIT",
] as const;
export type FinalReadinessDisposition =
  (typeof finalReadinessDispositions)[number];

export type FinalReadinessPrerequisite =
  | "TENDER"
  | "TENDER_VERSION"
  | "SOURCE_SET"
  | "EXTRACTION"
  | "EARLY_RISK"
  | "CONTINUE_DECISION"
  | "ELIGIBILITY_ASSESSMENT"
  | "EVIDENCE_SNAPSHOT"
  | "CHECKLIST_GENERATION"
  | "CONSOLIDATED_DRAFT";

export type FinalReadinessPrerequisiteReason =
  | "PREREQUISITE_MISSING"
  | "PREREQUISITE_NOT_CURRENT"
  | "PREREQUISITE_INVALIDATED"
  | "ORGANISATION_SCOPE_MISMATCH"
  | "TENDER_SCOPE_MISMATCH"
  | "TENDER_VERSION_SCOPE_MISMATCH"
  | "SOURCE_SET_NOT_SNAPSHOTTABLE"
  | "EARLY_RISK_NOT_COMPLETE"
  | "CONTINUE_DECISION_NOT_CURRENT"
  | "ELIGIBILITY_ASSESSMENT_NOT_COMPLETE"
  | "EVIDENCE_SNAPSHOT_NOT_EXACT"
  | "CHECKLIST_GENERATION_NOT_COMPLETE"
  | "CONSOLIDATED_DRAFT_COUNT_INVALID"
  | "CONSOLIDATED_DRAFT_NOT_QUALIFIED";

export interface FinalReadinessPrerequisiteDenial {
  readonly code: FinalReadinessPrerequisiteReason;
  readonly prerequisite: FinalReadinessPrerequisite;
}

export interface ScopedPrerequisite {
  readonly exists: boolean;
  readonly current: boolean;
  readonly invalidated: boolean;
  readonly organisationId?: string;
  readonly tenderId?: string;
  readonly tenderVersionId?: string;
}

export interface FinalReadinessPrerequisiteInput {
  readonly organisationId: string;
  readonly tenderId: string;
  readonly tenderVersionId: string;
  readonly tender: ScopedPrerequisite;
  readonly tenderVersion: ScopedPrerequisite;
  readonly sourceSet: ScopedPrerequisite & { readonly snapshottable: boolean };
  readonly extraction: ScopedPrerequisite & { readonly complete: boolean };
  readonly earlyRisk: ScopedPrerequisite & {
    readonly complete: boolean;
    readonly gate: "EARLY" | "FINAL_READINESS";
  };
  readonly continueDecision: ScopedPrerequisite & {
    readonly decision: "CONTINUE" | "HOLD" | "STOP" | null;
    readonly earlyRiskRunMatches: boolean;
    readonly superseded: boolean;
  };
  readonly eligibilityAssessment: ScopedPrerequisite & {
    readonly complete: boolean;
  };
  readonly evidenceSnapshot: ScopedPrerequisite & {
    readonly exactForEligibilityRun: boolean;
  };
  readonly checklistGeneration: ScopedPrerequisite & {
    readonly complete: boolean;
    readonly eligibilityRunMatches: boolean;
    readonly evidenceSnapshotMatches: boolean;
  };
  readonly consolidatedDraft: ScopedPrerequisite & {
    readonly count: number;
    readonly qualified: boolean;
  };
}

export function evaluateFinalReadinessPrerequisites(
  input: FinalReadinessPrerequisiteInput,
): readonly FinalReadinessPrerequisiteDenial[] {
  const denials: FinalReadinessPrerequisiteDenial[] = [];
  checkScoped(denials, "TENDER", input.tender, input);
  checkScoped(denials, "TENDER_VERSION", input.tenderVersion, input);
  checkScoped(denials, "SOURCE_SET", input.sourceSet, input);
  checkScoped(denials, "EXTRACTION", input.extraction, input);
  checkScoped(denials, "EARLY_RISK", input.earlyRisk, input);
  checkScoped(denials, "CONTINUE_DECISION", input.continueDecision, input);
  checkScoped(
    denials,
    "ELIGIBILITY_ASSESSMENT",
    input.eligibilityAssessment,
    input,
  );
  checkScoped(denials, "EVIDENCE_SNAPSHOT", input.evidenceSnapshot, input);
  checkScoped(
    denials,
    "CHECKLIST_GENERATION",
    input.checklistGeneration,
    input,
  );
  checkScoped(denials, "CONSOLIDATED_DRAFT", input.consolidatedDraft, input);

  if (input.sourceSet.exists && !input.sourceSet.snapshottable)
    addDenial(denials, "SOURCE_SET", "SOURCE_SET_NOT_SNAPSHOTTABLE");
  if (
    input.earlyRisk.exists &&
    (!input.earlyRisk.complete || input.earlyRisk.gate !== "EARLY")
  )
    addDenial(denials, "EARLY_RISK", "EARLY_RISK_NOT_COMPLETE");
  if (
    input.continueDecision.exists &&
    (input.continueDecision.decision !== "CONTINUE" ||
      input.continueDecision.superseded ||
      !input.continueDecision.earlyRiskRunMatches)
  )
    addDenial(denials, "CONTINUE_DECISION", "CONTINUE_DECISION_NOT_CURRENT");
  if (
    input.eligibilityAssessment.exists &&
    !input.eligibilityAssessment.complete
  )
    addDenial(
      denials,
      "ELIGIBILITY_ASSESSMENT",
      "ELIGIBILITY_ASSESSMENT_NOT_COMPLETE",
    );
  if (
    input.evidenceSnapshot.exists &&
    !input.evidenceSnapshot.exactForEligibilityRun
  )
    addDenial(denials, "EVIDENCE_SNAPSHOT", "EVIDENCE_SNAPSHOT_NOT_EXACT");
  if (
    input.checklistGeneration.exists &&
    (!input.checklistGeneration.complete ||
      !input.checklistGeneration.eligibilityRunMatches ||
      !input.checklistGeneration.evidenceSnapshotMatches)
  )
    addDenial(
      denials,
      "CHECKLIST_GENERATION",
      "CHECKLIST_GENERATION_NOT_COMPLETE",
    );
  if (input.consolidatedDraft.exists && input.consolidatedDraft.count !== 1)
    addDenial(
      denials,
      "CONSOLIDATED_DRAFT",
      "CONSOLIDATED_DRAFT_COUNT_INVALID",
    );
  if (input.consolidatedDraft.exists && !input.consolidatedDraft.qualified)
    addDenial(
      denials,
      "CONSOLIDATED_DRAFT",
      "CONSOLIDATED_DRAFT_NOT_QUALIFIED",
    );
  return denials;
}

export type ConsolidatedDraftQualificationReason =
  | "REQUIRED_DRAFT_TYPE_MISMATCH"
  | "CURRENT_VERSION_REQUIRED"
  | "APPROVED_VERSION_REQUIRED"
  | "NON_INVALIDATED_VERSION_REQUIRED"
  | "NON_SUPERSEDED_VERSION_REQUIRED"
  | "CURRENT_SOURCE_FINGERPRINT_REQUIRED"
  | "INDEPENDENT_APPROVER_REQUIRED"
  | "APPROVER_ROLE_EVIDENCE_REQUIRED"
  | "REQUIRED_REVIEWER_ROLE_NOT_SATISFIED"
  | "UNRESOLVED_APPROVAL_BLOCKING_PLACEHOLDER"
  | "UNSUPPORTED_MATERIAL_CLAIM"
  | "CONFLICTING_MATERIAL_CLAIM"
  | "EXPIRED_MATERIAL_CLAIM"
  | "MATERIAL_CLAIM_REQUIRES_HUMAN_REVIEW"
  | "UNVALIDATED_HUMAN_EDITED_SECTION"
  | "UNREVIEWED_MATERIAL_COMMITMENT";

export interface ConsolidatedDraftQualificationInput {
  readonly draftType: string;
  readonly isCurrentVersion: boolean;
  readonly approved: boolean;
  readonly invalidated: boolean;
  readonly superseded: boolean;
  readonly sourceFingerprintCurrent: boolean;
  readonly creatorUserId: string;
  readonly approverUserId: string | null;
  readonly requiredReviewerRole: "OWNER" | "ADMIN" | "REVIEWER";
  readonly approverRoleAtApproval:
    "OWNER" | "ADMIN" | "TENDER_EXECUTIVE" | "CONSULTANT" | "REVIEWER" | null;
  readonly unresolvedApprovalBlockingPlaceholders: number;
  readonly unsupportedMaterialClaims: number;
  readonly conflictingMaterialClaims: number;
  readonly expiredMaterialClaims: number;
  readonly materialClaimsRequiringHumanReview: number;
  readonly unvalidatedHumanEditedSections: number;
  readonly unreviewedMaterialCommitments: number;
}

export function consolidatedDraftQualificationDenials(
  input: ConsolidatedDraftQualificationInput,
): readonly ConsolidatedDraftQualificationReason[] {
  const denials: ConsolidatedDraftQualificationReason[] = [];
  if (input.draftType !== FINAL_READINESS_REQUIRED_DRAFT_TYPE)
    denials.push("REQUIRED_DRAFT_TYPE_MISMATCH");
  if (!input.isCurrentVersion) denials.push("CURRENT_VERSION_REQUIRED");
  if (!input.approved) denials.push("APPROVED_VERSION_REQUIRED");
  if (input.invalidated) denials.push("NON_INVALIDATED_VERSION_REQUIRED");
  if (input.superseded) denials.push("NON_SUPERSEDED_VERSION_REQUIRED");
  if (!input.sourceFingerprintCurrent)
    denials.push("CURRENT_SOURCE_FINGERPRINT_REQUIRED");
  if (
    input.approverUserId === null ||
    input.approverUserId === input.creatorUserId
  )
    denials.push("INDEPENDENT_APPROVER_REQUIRED");
  if (input.approverRoleAtApproval === null)
    denials.push("APPROVER_ROLE_EVIDENCE_REQUIRED");
  else if (input.approverRoleAtApproval !== input.requiredReviewerRole)
    denials.push("REQUIRED_REVIEWER_ROLE_NOT_SATISFIED");
  if (input.unresolvedApprovalBlockingPlaceholders > 0)
    denials.push("UNRESOLVED_APPROVAL_BLOCKING_PLACEHOLDER");
  if (input.unsupportedMaterialClaims > 0)
    denials.push("UNSUPPORTED_MATERIAL_CLAIM");
  if (input.conflictingMaterialClaims > 0)
    denials.push("CONFLICTING_MATERIAL_CLAIM");
  if (input.expiredMaterialClaims > 0) denials.push("EXPIRED_MATERIAL_CLAIM");
  if (input.materialClaimsRequiringHumanReview > 0)
    denials.push("MATERIAL_CLAIM_REQUIRES_HUMAN_REVIEW");
  if (input.unvalidatedHumanEditedSections > 0)
    denials.push("UNVALIDATED_HUMAN_EDITED_SECTION");
  if (input.unreviewedMaterialCommitments > 0)
    denials.push("UNREVIEWED_MATERIAL_COMMITMENT");
  return denials;
}

export interface EvidenceExpiryClassification {
  readonly policyRuleId:
    | "EVIDENCE_EXPIRED"
    | "EVIDENCE_EXPIRING_WITHIN_30_DAYS"
    | "EVIDENCE_EXPIRY_INFORMATIONAL";
  readonly treatment: FinalReadinessTreatment;
}

export function classifyEvidenceExpiry(input: {
  readonly expiryDate: Date | null;
  readonly evaluatedAt: Date;
  readonly relevant: boolean;
}): EvidenceExpiryClassification | undefined {
  if (input.expiryDate === null) return undefined;
  const expiryDay = utcCalendarDay(input.expiryDate);
  const evaluationDay = utcCalendarDay(input.evaluatedAt);
  const days = Math.round((expiryDay - evaluationDay) / 86_400_000);
  if (days < 0)
    return { policyRuleId: "EVIDENCE_EXPIRED", treatment: "BLOCKER" };
  if (days <= FINAL_READINESS_EXPIRY_WARNING_DAYS)
    return {
      policyRuleId: "EVIDENCE_EXPIRING_WITHIN_30_DAYS",
      treatment: "WARNING",
    };
  return input.relevant
    ? {
        policyRuleId: "EVIDENCE_EXPIRY_INFORMATIONAL",
        treatment: "INFORMATIONAL",
      }
    : undefined;
}

export const finalReadinessFindingConditions = [
  "STALE_OR_INVALID_PREREQUISITE",
  "INVALID_MATERIAL_CITATION",
  "MANDATORY_ELIGIBILITY_MISSING",
  "MANDATORY_ELIGIBILITY_CONFLICT",
  "EXPIRED_MANDATORY_EVIDENCE",
  "UNRESOLVED_BLOCKING_CHECKLIST_ITEM",
  "CHECKLIST_ITEM_READY_FOR_REASSESSMENT",
  "MISSING_COMPLIANT_CONSOLIDATED_DRAFT",
  "UNSUPPORTED_MATERIAL_DRAFT_CLAIM",
  "CONFLICTING_MATERIAL_DRAFT_CLAIM",
  "EXPIRED_MATERIAL_DRAFT_CLAIM",
  "UNRESOLVED_MATERIAL_PLACEHOLDER",
  "STALE_DRAFT_SNAPSHOT",
  "MISSING_INDEPENDENT_APPROVAL",
  "MANDATORY_ELIGIBILITY_LIKELY_MET",
  "MATERIAL_EXTRACTION_AMBIGUITY",
  "ACCEPTED_MATERIAL_RISK",
  "OPEN_DISPOSITIONABLE_MATERIAL_RISK",
  "UNRESOLVED_MATERIAL_LIMITATION",
  "EVIDENCE_EXPIRING_WITHIN_30_DAYS",
  "UNRESOLVED_NON_BLOCKING_CHECKLIST_ITEM",
  "SUPPORTED_APPROACHING_DEADLINE",
  "ACCEPTED_NON_MATERIAL_RISK",
  "NON_AFFILIATION_NOTICE",
  "NO_COMPLETE_RISK_GUARANTEE",
  "HISTORICAL_RESOLVED_CONTEXT",
  "PRODUCT_LIMITATION",
] as const;
export type FinalReadinessFindingCondition =
  (typeof finalReadinessFindingConditions)[number];

export interface FinalReadinessTreatmentResult {
  readonly policyRuleId: FinalReadinessFindingCondition;
  readonly treatment: FinalReadinessTreatment;
}

const blockerConditions = new Set<FinalReadinessFindingCondition>([
  "STALE_OR_INVALID_PREREQUISITE",
  "INVALID_MATERIAL_CITATION",
  "MANDATORY_ELIGIBILITY_MISSING",
  "MANDATORY_ELIGIBILITY_CONFLICT",
  "EXPIRED_MANDATORY_EVIDENCE",
  "UNRESOLVED_BLOCKING_CHECKLIST_ITEM",
  "CHECKLIST_ITEM_READY_FOR_REASSESSMENT",
  "MISSING_COMPLIANT_CONSOLIDATED_DRAFT",
  "UNSUPPORTED_MATERIAL_DRAFT_CLAIM",
  "CONFLICTING_MATERIAL_DRAFT_CLAIM",
  "EXPIRED_MATERIAL_DRAFT_CLAIM",
  "UNRESOLVED_MATERIAL_PLACEHOLDER",
  "STALE_DRAFT_SNAPSHOT",
  "MISSING_INDEPENDENT_APPROVAL",
]);
const dispositionConditions = new Set<FinalReadinessFindingCondition>([
  "MANDATORY_ELIGIBILITY_LIKELY_MET",
  "MATERIAL_EXTRACTION_AMBIGUITY",
  "ACCEPTED_MATERIAL_RISK",
  "OPEN_DISPOSITIONABLE_MATERIAL_RISK",
  "UNRESOLVED_MATERIAL_LIMITATION",
]);
const warningConditions = new Set<FinalReadinessFindingCondition>([
  "EVIDENCE_EXPIRING_WITHIN_30_DAYS",
  "UNRESOLVED_NON_BLOCKING_CHECKLIST_ITEM",
  "SUPPORTED_APPROACHING_DEADLINE",
  "ACCEPTED_NON_MATERIAL_RISK",
]);

export function classifyFinalReadinessFinding(
  condition: FinalReadinessFindingCondition,
): FinalReadinessTreatmentResult {
  return {
    policyRuleId: condition,
    treatment: blockerConditions.has(condition)
      ? "BLOCKER"
      : dispositionConditions.has(condition)
        ? "HUMAN_DISPOSITION_REQUIRED"
        : warningConditions.has(condition)
          ? "WARNING"
          : "INFORMATIONAL",
  };
}

export type FinalReadinessDispositionDenial =
  | "READINESS_RUN_NOT_CURRENT"
  | "READINESS_RUN_NOT_COMPLETE"
  | "FINAL_RISK_RUN_NOT_CURRENT"
  | "FINAL_RISK_RUN_NOT_COMPLETE"
  | "READINESS_RUN_INVALIDATED"
  | "INPUT_FINGERPRINT_STALE"
  | "FINAL_READINESS_DECISION_PERMISSION_REQUIRED"
  | "REQUESTER_CANNOT_DECIDE"
  | "CONSOLIDATED_DRAFT_CREATOR_CANNOT_DECIDE"
  | "DECISION_RATIONALE_REQUIRED"
  | "UNRESOLVED_BLOCKERS"
  | "UNRESOLVED_HUMAN_DISPOSITIONS"
  | "REQUIRED_ACKNOWLEDGEMENTS_MISSING"
  | "MATERIAL_FINDING_PROVENANCE_INVALID";

export interface FinalReadinessDispositionInput {
  readonly disposition: FinalReadinessDisposition;
  readonly readinessRunCurrent: boolean;
  readonly readinessRunComplete: boolean;
  readonly finalRiskRunCurrent: boolean;
  readonly finalRiskRunComplete: boolean;
  readonly invalidated: boolean;
  readonly fingerprintMatches: boolean;
  readonly actorHasDecisionPermission: boolean;
  readonly actorUserId: string;
  readonly requesterUserId: string;
  readonly consolidatedDraftCreatorUserId: string;
  readonly rationale: string;
  readonly unresolvedBlockers: number;
  readonly unresolvedHumanDispositions: number;
  readonly requiredAcknowledgementsRecorded: boolean;
  readonly materialFindingProvenanceValid: boolean;
}

export function finalReadinessDispositionDenials(
  input: FinalReadinessDispositionInput,
): readonly FinalReadinessDispositionDenial[] {
  const denials: FinalReadinessDispositionDenial[] = [];
  if (!input.readinessRunCurrent) denials.push("READINESS_RUN_NOT_CURRENT");
  if (!input.readinessRunComplete) denials.push("READINESS_RUN_NOT_COMPLETE");
  if (!input.finalRiskRunCurrent) denials.push("FINAL_RISK_RUN_NOT_CURRENT");
  if (!input.finalRiskRunComplete) denials.push("FINAL_RISK_RUN_NOT_COMPLETE");
  if (input.invalidated) denials.push("READINESS_RUN_INVALIDATED");
  if (!input.fingerprintMatches) denials.push("INPUT_FINGERPRINT_STALE");
  if (!input.actorHasDecisionPermission)
    denials.push("FINAL_READINESS_DECISION_PERMISSION_REQUIRED");
  if (input.actorUserId === input.requesterUserId)
    denials.push("REQUESTER_CANNOT_DECIDE");
  if (input.actorUserId === input.consolidatedDraftCreatorUserId)
    denials.push("CONSOLIDATED_DRAFT_CREATOR_CANNOT_DECIDE");
  if (input.rationale.trim().length < 20)
    denials.push("DECISION_RATIONALE_REQUIRED");
  if (input.disposition === "PROCEED_TO_CONTROLLED_EXPORT_REVIEW") {
    if (input.unresolvedBlockers > 0) denials.push("UNRESOLVED_BLOCKERS");
    if (input.unresolvedHumanDispositions > 0)
      denials.push("UNRESOLVED_HUMAN_DISPOSITIONS");
    if (!input.requiredAcknowledgementsRecorded)
      denials.push("REQUIRED_ACKNOWLEDGEMENTS_MISSING");
    if (!input.materialFindingProvenanceValid)
      denials.push("MATERIAL_FINDING_PROVENANCE_INVALID");
  }
  return denials;
}

export interface FinalReadinessFingerprintInput {
  readonly organisationId: string;
  readonly tenderId: string;
  readonly tenderVersionId: string;
  readonly tenderVersionFingerprint: string;
  readonly documents: readonly {
    readonly id: string;
    readonly checksum: string;
    readonly role: string;
  }[];
  readonly extractionRunId: string;
  readonly extractionFingerprint: string;
  readonly earlyRiskRunId: string;
  readonly earlyRiskFingerprint: string;
  readonly pursuitDecisionId: string;
  readonly eligibilityRunId: string;
  readonly evidenceSnapshotId: string;
  readonly evidenceSnapshotFingerprint: string;
  readonly checklistRunId: string;
  readonly checklistFingerprint: string;
  readonly consolidatedDraftId: string;
  readonly consolidatedDraftVersionId: string;
  readonly consolidatedDraftFingerprint: string;
  readonly policyVersions: readonly string[];
}

export function normaliseFinalReadinessFingerprintInput(
  input: FinalReadinessFingerprintInput,
): FinalReadinessFingerprintInput {
  return {
    ...input,
    documents: [...input.documents].sort((left, right) =>
      `${left.role}:${left.id}:${left.checksum}`.localeCompare(
        `${right.role}:${right.id}:${right.checksum}`,
      ),
    ),
    policyVersions: [...input.policyVersions].sort(),
  };
}

function checkScoped(
  denials: FinalReadinessPrerequisiteDenial[],
  prerequisite: FinalReadinessPrerequisite,
  record: ScopedPrerequisite,
  expected: Pick<
    FinalReadinessPrerequisiteInput,
    "organisationId" | "tenderId" | "tenderVersionId"
  >,
): void {
  if (!record.exists) {
    addDenial(denials, prerequisite, "PREREQUISITE_MISSING");
    return;
  }
  if (!record.current)
    addDenial(denials, prerequisite, "PREREQUISITE_NOT_CURRENT");
  if (record.invalidated)
    addDenial(denials, prerequisite, "PREREQUISITE_INVALIDATED");
  if (record.organisationId !== expected.organisationId)
    addDenial(denials, prerequisite, "ORGANISATION_SCOPE_MISMATCH");
  if (record.tenderId !== undefined && record.tenderId !== expected.tenderId)
    addDenial(denials, prerequisite, "TENDER_SCOPE_MISMATCH");
  if (
    record.tenderVersionId !== undefined &&
    record.tenderVersionId !== expected.tenderVersionId
  )
    addDenial(denials, prerequisite, "TENDER_VERSION_SCOPE_MISMATCH");
}

function addDenial(
  denials: FinalReadinessPrerequisiteDenial[],
  prerequisite: FinalReadinessPrerequisite,
  code: FinalReadinessPrerequisiteReason,
): void {
  if (
    !denials.some(
      (item) => item.prerequisite === prerequisite && item.code === code,
    )
  )
    denials.push({ code, prerequisite });
}

function utcCalendarDay(value: Date): number {
  return Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
  );
}
