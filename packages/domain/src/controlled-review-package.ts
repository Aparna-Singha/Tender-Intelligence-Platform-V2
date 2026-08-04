import type { OrganisationRole, Permission } from "./authorisation.js";
import { hasPermission } from "./authorisation.js";

export const CONTROLLED_REVIEW_PACKAGE_POLICY_VERSION =
  "controlled-review-package-deterministic-v1";
export const CONTROLLED_REVIEW_PACKAGE_CONTENT_POLICY_VERSION =
  "controlled-review-package-content-v1";

export const controlledPackageGenerationStatuses = [
  "QUEUED",
  "PROCESSING",
  "GENERATED",
  "FAILED",
  "CANCELLED",
  "INVALIDATED",
] as const;
export type ControlledPackageGenerationStatus =
  (typeof controlledPackageGenerationStatuses)[number];

export const controlledPackageReviewStatuses = [
  "NOT_REVIEWED",
  "IN_REVIEW",
  "APPROVED",
  "REJECTED",
  "REVOKED",
  "SUPERSEDED",
] as const;
export type ControlledPackageReviewStatus =
  (typeof controlledPackageReviewStatuses)[number];

export const controlledPackageFreshnessStates = [
  "CURRENT",
  "STALE",
  "INVALIDATED",
] as const;
export type ControlledPackageFreshnessState =
  (typeof controlledPackageFreshnessStates)[number];

export const CONTROLLED_PACKAGE_MAX_ZIP_BYTES = 100 * 1024 * 1024;
export const CONTROLLED_PACKAGE_MAX_MEMBER_BYTES = 50 * 1024 * 1024;
export const CONTROLLED_PACKAGE_MAX_PDF_PAGES = 2_000;
export const CONTROLLED_PACKAGE_MAX_DOCUMENTS = 200;
export const CONTROLLED_PACKAGE_MAX_PROVENANCE_REFERENCES = 5_000;
export const CONTROLLED_PACKAGE_MAX_SUMMARY_ROWS = 2_000;
export const CONTROLLED_PACKAGE_MAX_DRAFT_SECTIONS = 40;
export const CONTROLLED_PACKAGE_MAX_FILENAME_BYTES = 120;
export const CONTROLLED_PACKAGE_MEMBER_COUNT = 4;

const generationTransitions: Readonly<
  Record<
    ControlledPackageGenerationStatus,
    readonly ControlledPackageGenerationStatus[]
  >
> = {
  QUEUED: ["PROCESSING", "CANCELLED", "INVALIDATED"],
  PROCESSING: ["GENERATED", "FAILED", "CANCELLED", "INVALIDATED"],
  GENERATED: [],
  FAILED: [],
  CANCELLED: [],
  INVALIDATED: [],
};

const reviewTransitions: Readonly<
  Record<
    ControlledPackageReviewStatus,
    readonly ControlledPackageReviewStatus[]
  >
> = {
  NOT_REVIEWED: ["IN_REVIEW"],
  IN_REVIEW: ["IN_REVIEW", "APPROVED", "REJECTED"],
  APPROVED: ["REVOKED", "SUPERSEDED"],
  REJECTED: [],
  REVOKED: [],
  SUPERSEDED: [],
};

export function canTransitionControlledPackageGeneration(
  from: ControlledPackageGenerationStatus,
  to: ControlledPackageGenerationStatus,
): boolean {
  return generationTransitions[from].includes(to);
}

export function canTransitionControlledPackageReview(
  from: ControlledPackageReviewStatus,
  to: ControlledPackageReviewStatus,
): boolean {
  return reviewTransitions[from].includes(to);
}

export function canCancelControlledPackage(
  status: ControlledPackageGenerationStatus,
): boolean {
  return status === "QUEUED" || status === "PROCESSING";
}

export function canRetryControlledPackage(
  status: ControlledPackageGenerationStatus,
): boolean {
  return ["FAILED", "CANCELLED", "INVALIDATED"].includes(status);
}

export function canRegenerateControlledPackage(
  generationStatus: ControlledPackageGenerationStatus,
  reviewStatus: ControlledPackageReviewStatus,
): boolean {
  return generationStatus === "GENERATED" || reviewStatus === "REJECTED";
}

export function canReviewControlledPackage(
  generationStatus: ControlledPackageGenerationStatus,
  freshness: ControlledPackageFreshnessState,
  reviewStatus: ControlledPackageReviewStatus,
): boolean {
  return (
    generationStatus === "GENERATED" &&
    freshness === "CURRENT" &&
    (reviewStatus === "NOT_REVIEWED" || reviewStatus === "IN_REVIEW")
  );
}

export function isControlledPackageCurrentPointerEligible(input: {
  readonly generationStatus: ControlledPackageGenerationStatus;
  readonly reviewStatus: ControlledPackageReviewStatus;
  readonly freshness: ControlledPackageFreshnessState;
}): boolean {
  return (
    input.generationStatus === "GENERATED" &&
    input.reviewStatus === "APPROVED" &&
    input.freshness === "CURRENT"
  );
}

export function isControlledPackageDownloadEligible(input: {
  readonly generationStatus: ControlledPackageGenerationStatus;
  readonly reviewStatus: ControlledPackageReviewStatus;
  readonly freshness: ControlledPackageFreshnessState;
  readonly artifactAvailable: boolean;
  readonly checksumVerified: boolean;
  readonly malwareCleared: boolean;
}): boolean {
  return (
    isControlledPackageCurrentPointerEligible(input) &&
    input.artifactAvailable &&
    input.checksumVerified &&
    input.malwareCleared
  );
}

export function isControlledPackageHistoricallyReadable(): true {
  return true;
}

export type ControlledPackagePrerequisiteTreatment =
  | "HARD_GENERATION_BLOCKER"
  | "PACKAGE_WARNING"
  | "REVIEW_BLOCKER"
  | "DOWNLOAD_BLOCKER";

export interface ControlledPackagePrerequisiteFact {
  readonly code: string;
  readonly satisfied: boolean;
  readonly treatment: ControlledPackagePrerequisiteTreatment;
}

export interface ControlledPackageAuthorityInput {
  readonly readinessRunCurrent: boolean;
  readonly readinessRunComplete: boolean;
  readonly readinessRunInvalidated: boolean;
  readonly finalRiskRunCurrent: boolean;
  readonly finalRiskRunComplete: boolean;
  readonly proceedDecisionCurrent: boolean;
  readonly proceedDecisionUnsuperseded: boolean;
  readonly inputFingerprintCurrent: boolean;
  readonly approvedDraftPinned: boolean;
  readonly exportTemplateApproved: boolean;
  readonly sourceHashesAvailable: boolean;
  readonly activeRunExists: boolean;
  readonly facts: readonly ControlledPackagePrerequisiteFact[];
}

export interface ControlledPackagePrerequisiteResult {
  readonly hardGenerationBlockers: readonly string[];
  readonly packageWarnings: readonly string[];
  readonly reviewBlockers: readonly string[];
  readonly downloadBlockers: readonly string[];
}

export function evaluateControlledPackagePrerequisites(
  input: ControlledPackageAuthorityInput,
): ControlledPackagePrerequisiteResult {
  const hardGenerationBlockers: string[] = [];
  const required: readonly [boolean, string][] = [
    [input.readinessRunCurrent, "READINESS_RUN_NOT_CURRENT"],
    [input.readinessRunComplete, "READINESS_RUN_NOT_COMPLETE"],
    [!input.readinessRunInvalidated, "READINESS_RUN_INVALIDATED"],
    [input.finalRiskRunCurrent, "FINAL_RISK_RUN_NOT_CURRENT"],
    [input.finalRiskRunComplete, "FINAL_RISK_RUN_NOT_COMPLETE"],
    [input.proceedDecisionCurrent, "PROCEED_DECISION_NOT_CURRENT"],
    [input.proceedDecisionUnsuperseded, "PROCEED_DECISION_SUPERSEDED"],
    [input.inputFingerprintCurrent, "INPUT_FINGERPRINT_STALE"],
    [input.approvedDraftPinned, "APPROVED_DRAFT_NOT_PINNED"],
    [input.exportTemplateApproved, "EXPORT_TEMPLATE_NOT_APPROVED"],
    [input.sourceHashesAvailable, "SOURCE_HASH_UNAVAILABLE"],
    [!input.activeRunExists, "ACTIVE_PACKAGE_ALREADY_EXISTS"],
  ];
  for (const [passes, code] of required)
    if (!passes) hardGenerationBlockers.push(code);

  const packageWarnings: string[] = [];
  const reviewBlockers: string[] = [];
  const downloadBlockers: string[] = [];
  for (const fact of input.facts) {
    if (fact.satisfied) continue;
    if (fact.treatment === "HARD_GENERATION_BLOCKER")
      hardGenerationBlockers.push(fact.code);
    else if (fact.treatment === "PACKAGE_WARNING")
      packageWarnings.push(fact.code);
    else if (fact.treatment === "REVIEW_BLOCKER")
      reviewBlockers.push(fact.code);
    else downloadBlockers.push(fact.code);
  }
  return {
    hardGenerationBlockers,
    packageWarnings,
    reviewBlockers,
    downloadBlockers,
  };
}

export type ControlledPackageApprovalDenial =
  | "ACTIVE_MEMBERSHIP_REQUIRED"
  | "APPROVAL_PERMISSION_REQUIRED"
  | "REQUESTER_CANNOT_APPROVE"
  | "DRAFT_CREATOR_CANNOT_APPROVE"
  | "ROLE_AT_ACTION_REQUIRED"
  | "PACKAGE_NOT_REVIEWABLE"
  | "REVIEW_VERSION_CONFLICT"
  | "FINGERPRINT_STALE";

export interface ControlledPackageApprovalInput {
  readonly actorUserId: string;
  readonly actorRoleAtAction: OrganisationRole | null;
  readonly activeMembership: boolean;
  readonly requesterUserId: string;
  readonly draftCreatorUserId: string;
  readonly packageReviewable: boolean;
  readonly reviewVersionCurrent: boolean;
  readonly fingerprintCurrent: boolean;
}

export function controlledPackageApprovalDenials(
  input: ControlledPackageApprovalInput,
): readonly ControlledPackageApprovalDenial[] {
  const denials: ControlledPackageApprovalDenial[] = [];
  if (!input.activeMembership) denials.push("ACTIVE_MEMBERSHIP_REQUIRED");
  if (input.actorRoleAtAction === null) denials.push("ROLE_AT_ACTION_REQUIRED");
  else if (
    !hasPermission(input.actorRoleAtAction, "TENDER_CONTROLLED_PACKAGE_APPROVE")
  )
    denials.push("APPROVAL_PERMISSION_REQUIRED");
  if (input.actorUserId === input.requesterUserId)
    denials.push("REQUESTER_CANNOT_APPROVE");
  if (input.actorUserId === input.draftCreatorUserId)
    denials.push("DRAFT_CREATOR_CANNOT_APPROVE");
  if (!input.packageReviewable) denials.push("PACKAGE_NOT_REVIEWABLE");
  if (!input.reviewVersionCurrent) denials.push("REVIEW_VERSION_CONFLICT");
  if (!input.fingerprintCurrent) denials.push("FINGERPRINT_STALE");
  return denials;
}

export const controlledPackageAuthorityComponents = [
  "TENDER_VERSION",
  "SOURCE_SET",
  "EXTRACTION",
  "EARLY_RISK",
  "PURSUIT_DECISION",
  "ELIGIBILITY_AND_EVIDENCE",
  "CHECKLIST",
  "EVIDENCE_REFERENCES",
  "APPROVED_DRAFT",
  "DRAFT_APPROVAL",
  "FINAL_READINESS_RUN",
  "FINAL_RISK_RUN",
  "FINAL_READINESS_DECISION",
  "EXPORT_TEMPLATE_VERSION",
  "POLICY_VERSIONS",
] as const;
export type ControlledPackageAuthorityComponent =
  (typeof controlledPackageAuthorityComponents)[number];

export function controlledPackageFreshnessEffect(input: {
  readonly changedComponents: readonly ControlledPackageAuthorityComponent[];
  readonly generationStatus: ControlledPackageGenerationStatus;
}): {
  readonly blockStart: boolean;
  readonly invalidateRun: boolean;
  readonly markStale: boolean;
  readonly approvalEffective: boolean;
  readonly downloadGrantAllowed: boolean;
} {
  const changed = input.changedComponents.length > 0;
  return {
    blockStart: changed,
    invalidateRun:
      changed &&
      (input.generationStatus === "QUEUED" ||
        input.generationStatus === "PROCESSING"),
    markStale: changed && input.generationStatus === "GENERATED",
    approvalEffective: !changed,
    downloadGrantAllowed: !changed,
  };
}

export type ControlledPackageIdempotencyResult =
  "CREATE" | "REPLAY_EQUIVALENT" | "CONFLICT_CHANGED_INPUT";

export function controlledPackageIdempotencyResult(input: {
  readonly existingInputFingerprint: string | null;
  readonly requestedInputFingerprint: string;
}): ControlledPackageIdempotencyResult {
  if (input.existingInputFingerprint === null) return "CREATE";
  return input.existingInputFingerprint === input.requestedInputFingerprint
    ? "REPLAY_EQUIVALENT"
    : "CONFLICT_CHANGED_INPUT";
}

export interface ControlledPackageLimitInput {
  readonly zipBytes: number;
  readonly memberBytes: readonly number[];
  readonly pdfPages: number;
  readonly documentCount: number;
  readonly provenanceReferenceCount: number;
  readonly summaryRowCount: number;
  readonly draftSectionCount: number;
  readonly filenames: readonly string[];
  readonly containsNestedArchive: boolean;
}

export type ControlledPackageLimitViolation =
  | "ZIP_SIZE_LIMIT_EXCEEDED"
  | "MEMBER_COUNT_INVALID"
  | "MEMBER_SIZE_LIMIT_EXCEEDED"
  | "PDF_PAGE_LIMIT_EXCEEDED"
  | "DOCUMENT_LIMIT_EXCEEDED"
  | "PROVENANCE_LIMIT_EXCEEDED"
  | "SUMMARY_ROW_LIMIT_EXCEEDED"
  | "DRAFT_SECTION_LIMIT_EXCEEDED"
  | "FILENAME_UNSAFE"
  | "FILENAME_SIZE_LIMIT_EXCEEDED"
  | "NESTED_ARCHIVE_PROHIBITED";

export function controlledPackageLimitViolations(
  input: ControlledPackageLimitInput,
): readonly ControlledPackageLimitViolation[] {
  const violations: ControlledPackageLimitViolation[] = [];
  if (input.zipBytes < 0 || input.zipBytes > CONTROLLED_PACKAGE_MAX_ZIP_BYTES)
    violations.push("ZIP_SIZE_LIMIT_EXCEEDED");
  if (input.memberBytes.length !== CONTROLLED_PACKAGE_MEMBER_COUNT)
    violations.push("MEMBER_COUNT_INVALID");
  if (
    input.memberBytes.some(
      (bytes) => bytes < 0 || bytes > CONTROLLED_PACKAGE_MAX_MEMBER_BYTES,
    )
  )
    violations.push("MEMBER_SIZE_LIMIT_EXCEEDED");
  if (input.pdfPages < 0 || input.pdfPages > CONTROLLED_PACKAGE_MAX_PDF_PAGES)
    violations.push("PDF_PAGE_LIMIT_EXCEEDED");
  if (
    input.documentCount < 0 ||
    input.documentCount > CONTROLLED_PACKAGE_MAX_DOCUMENTS
  )
    violations.push("DOCUMENT_LIMIT_EXCEEDED");
  if (
    input.provenanceReferenceCount < 0 ||
    input.provenanceReferenceCount >
      CONTROLLED_PACKAGE_MAX_PROVENANCE_REFERENCES
  )
    violations.push("PROVENANCE_LIMIT_EXCEEDED");
  if (
    input.summaryRowCount < 0 ||
    input.summaryRowCount > CONTROLLED_PACKAGE_MAX_SUMMARY_ROWS
  )
    violations.push("SUMMARY_ROW_LIMIT_EXCEEDED");
  if (
    input.draftSectionCount < 0 ||
    input.draftSectionCount > CONTROLLED_PACKAGE_MAX_DRAFT_SECTIONS
  )
    violations.push("DRAFT_SECTION_LIMIT_EXCEEDED");
  for (const filename of input.filenames) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(filename))
      violations.push("FILENAME_UNSAFE");
    if (
      new TextEncoder().encode(filename).length >
      CONTROLLED_PACKAGE_MAX_FILENAME_BYTES
    )
      violations.push("FILENAME_SIZE_LIMIT_EXCEEDED");
  }
  if (input.containsNestedArchive) violations.push("NESTED_ARCHIVE_PROHIBITED");
  return [...new Set(violations)];
}

export function canonicalControlledPackageInput(
  value: Readonly<Record<string, unknown>>,
): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  return value;
}

export function isControlledPackagePermission(permission: Permission): boolean {
  return permission.startsWith("TENDER_CONTROLLED_PACKAGE_");
}
