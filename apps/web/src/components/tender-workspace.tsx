"use client";

import { Download, MoreHorizontal, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type JSX,
} from "react";
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  Modal,
  Select,
  Textarea,
  humanizeEnum,
} from "@tender/ui";
import { apiRequest, formatApiError, PublicApiError } from "../lib/api";
import { uploadFileToSignedStorageUrl } from "../lib/direct-upload";
import { ActionChecklist } from "./action-checklist";
import { ControlledReviewPackageWorkspace } from "./controlled-review-package-workspace";
import {
  conciseRequirementTitle,
  requirementCategoryLabel,
  requirementDisplaySummary,
  compactSourceExcerpt,
  customerAssessmentReason,
  requirementPresentation,
  type EligibilityViewRequirement,
} from "./eligibility-presentation";
import { DraftWorkspace } from "./draft-workspace";
import { EvidenceMatrix } from "./evidence-matrix";
import { FinalReadinessWorkspace } from "./final-readiness-workspace";
import { RagChatbot } from "./rag-chatbot";
import { ContextualAssistant } from "./contextual-assistant";
import { formatDeadline, formatDeadlineCountdown } from "./tender-presentation";

const SHOW_INTERNAL_ELIGIBILITY_TOOLS = false;

interface Workspace {
  readonly buyer: string;
  readonly corrigenda: readonly {
    readonly description: string;
    readonly id: string;
    readonly identifier: string;
    readonly publicationDate: string | null;
  }[];
  readonly deadlineResolution?: {
    readonly deadlineSource: "EXTRACTED_SOURCE" | "METADATA" | "UNAVAILABLE";
    readonly extractedSubmissionDeadline?: string | null;
    readonly extractedSubmissionDeadlineText?: string | null;
    readonly hasMismatch: boolean;
    readonly metadataSubmissionDeadline?: string | null;
    readonly submissionDeadline?: string | null;
  };
  readonly demonstration_label?: string;
  readonly id: string;
  readonly lifecycleStatus: string;
  readonly metadataSubmissionDeadline?: string;
  readonly processingJobs: readonly {
    readonly currentStage: string;
    readonly id: string;
    readonly progressPercentage: number;
    readonly publicMessage: string;
    readonly state: string;
    readonly tenderVersionId?: string;
  }[];
  readonly sources: readonly {
    readonly adapterType: string;
    readonly provenance: string;
    readonly sourceName: string;
    readonly sourceUrl: string | null;
  }[];
  readonly submissionDeadline?: string;
  readonly title: string;
  readonly versions: readonly {
    readonly documents: readonly {
      readonly createdAt: string;
      readonly displayFilename: string;
      readonly id: string;
      readonly role: string;
      readonly sha256: string;
      readonly sizeBytes: string;
      readonly status: string;
      readonly uploadSessionExpiresAt: string;
    }[];
    readonly id: string;
    readonly reason: string;
    readonly versionNumber: number;
  }[];
  readonly workflowState?: {
    readonly actionLabel: string;
    readonly code:
      | "ANALYSIS_READY"
      | "AWAITING_EARLY_DECISION"
      | "AWAITING_SOURCE"
      | "COMPARING_ELIGIBILITY"
      | "DRAFTING"
      | "EXTRACTING"
      | "FAILED_RECOVERABLE"
      | "PROCESSING_SOURCE"
      | "REVIEWING_RISKS"
      | "REVIEW_READY"
      | "UPLOADING";
    readonly detail: string;
    readonly isCompleted: boolean;
    readonly isDraft: boolean;
    readonly isInProgress: boolean;
    readonly needsAttention: boolean;
    readonly onHold: boolean;
    readonly statusLabel: string;
    readonly tone:
      "accent" | "danger" | "info" | "neutral" | "success" | "warning";
  };
  readonly workspace: {
    readonly processingProgress: number;
    readonly sourceSectionStatus: string;
  };
}

interface UploadSession {
  readonly document_id: string;
  readonly upload_url: string;
}

interface ExtractionRun {
  readonly current_stage: string;
  readonly id: string;
  readonly parser_policy_version: string;
  readonly progress_percentage: number;
  readonly public_message: string;
  readonly quality_summary: Readonly<Record<string, number>>;
  readonly source_fingerprint: string;
  readonly status: string;
}

interface Citation {
  readonly archiveMemberPath: string | null;
  readonly boundedExcerpt: string;
  readonly clauseLabel?: string | null;
  readonly documentName: string;
  readonly id: string;
  readonly pageNumber: number | null;
  readonly sheetName: string | null;
  readonly tenderDocumentId: string;
}

interface Requirement {
  readonly category: string;
  readonly citations: readonly Citation[];
  readonly confidence: string;
  readonly findingState: string;
  readonly id: string;
  readonly normalizedStatement: string;
  readonly obligation: string;
  readonly reviewState: string;
  readonly sourceWording: string;
  readonly title: string;
}

interface ExtractedField {
  readonly citations: readonly Citation[];
  readonly confidence: string;
  readonly fieldType: string;
  readonly findingState: string;
  readonly id: string;
  readonly normalizedDateValue?: string | null;
  readonly normalizedTextValue: string | null;
  readonly reviewState: string;
  readonly sourceWording: string;
}

interface ExtractionIssue {
  readonly id: string;
  readonly issueType: string;
  readonly requiresHumanReview: boolean;
  readonly safeMessage: string;
  readonly severity: string;
}

interface RiskRun {
  readonly extractionRunId: string;
  readonly failureCategory?: string | null;
  readonly id: string;
  readonly internalFailureReference?: string | null;
  readonly progressPercentage: number;
  readonly publicMessage: string;
  readonly riskPolicyVersion: string;
  readonly safeFailureMessage?: string | null;
  readonly status: string;
  readonly summary: Readonly<Record<string, number>>;
}

interface RiskFinding {
  readonly category: string;
  readonly confidence: string;
  readonly explanation: string;
  readonly findingStatus: string;
  readonly id: string;
  readonly materiality: string;
  readonly reviewState: string;
  readonly severity: string;
  readonly title: string;
  readonly citations: readonly {
    readonly extractionCitation: Citation;
  }[];
}

interface AssessmentRun {
  readonly comparisonPolicyVersion: string;
  readonly extractionRunId: string;
  readonly id: string;
  readonly invalidatedAt: string | null;
  readonly progressPercentage: number;
  readonly publicMessage: string;
  readonly riskAnalysisRunId: string;
  readonly snapshot?: { readonly capturedAt: string } | null;
  readonly status: string;
  readonly tenderVersionId: string;
}

interface MatrixItem {
  readonly currentState: string;
  readonly evidenceLinks: readonly {
    readonly evidenceCitation: {
      readonly boundedExcerpt: string;
      readonly documentId: string;
      readonly documentName: string;
      readonly pageNumber: number | null;
      readonly validationStatus: string;
    } | null;
    readonly linkType: string;
  }[];
  readonly id: string;
  readonly proposedConfidence: string;
  readonly proposedRationale: string;
  readonly proposedState: string;
  readonly requirementCategory: string;
  readonly requirementObligation: string;
  readonly reviewState: string;
  readonly structuredRequirement: {
    readonly id: string;
    readonly normalizedStatement: string;
    readonly title: string;
  };
  readonly tenderCitation: {
    readonly boundedExcerpt: string;
    readonly documentName: string;
    readonly pageNumber: number | null;
    readonly tenderDocumentId: string;
  };
  readonly uncertainty: string;
}

interface MatrixResult {
  readonly counts: readonly {
    readonly _count: number;
    readonly currentState: string;
  }[];
  readonly items: readonly MatrixItem[];
  readonly total: number;
}

interface ChecklistRun {
  readonly assessmentRunId: string;
  readonly checklistPolicyVersion: string;
  readonly completedAt: string | null;
  readonly evidenceSnapshotId: string;
  readonly id: string;
  readonly invalidatedAt: string | null;
  readonly progressPercentage: number;
  readonly publicMessage: string;
  readonly status: string;
}

interface ChecklistItem {
  readonly assessmentLinks?: readonly {
    readonly assessmentId: string;
  }[];
  readonly completionCriteria: string;
  readonly currentDueDate: string | null;
  readonly currentPriority: string;
  readonly currentTitle: string;
  readonly dateIsOfficial: boolean;
  readonly evidenceNeedCategory: string;
  readonly id: string;
  readonly itemType: string;
  readonly proposedExplanation: string;
  readonly requirementLinks?: readonly {
    readonly structuredRequirementId: string;
  }[];
  readonly status: string;
}

interface ChecklistResult {
  readonly items: readonly ChecklistItem[];
  readonly priority_counts: readonly {
    readonly _count: number;
    readonly currentPriority: string;
  }[];
  readonly status_counts: readonly {
    readonly _count: number;
    readonly status: string;
  }[];
  readonly total: number;
}

interface DraftRun {
  readonly citationCount: number;
  readonly currentStage: string;
  readonly draftId: string | null;
  readonly id: string;
  readonly placeholderCount: number;
  readonly progressPercentage: number;
  readonly safeFailureCode: string | null;
  readonly status: string;
  readonly validatedClaimCount: number;
}

interface DraftSummary {
  readonly currentVersionId: string | null;
  readonly id: string;
  readonly lifecycle: string;
  readonly title: string;
}

interface FinalReadinessRun {
  readonly completed_at: string | null;
  readonly created_at: string;
  readonly current_disposition: {
    readonly disposition: string;
    readonly rationale: string;
  } | null;
  readonly finding_counts: {
    readonly blockers: number;
    readonly human_disposition_required: number;
    readonly informational: number;
    readonly warnings: number;
  };
  readonly id: string;
  readonly invalidated: boolean;
  readonly is_current: boolean;
  readonly stale: boolean;
  readonly status: string;
  readonly updated_at: string;
}

interface PackageRun {
  readonly artifact_id: string | null;
  readonly created_at: string;
  readonly freshness: "CURRENT" | "STALE" | "INVALIDATED";
  readonly generation_status: string;
  readonly id: string;
  readonly is_current: boolean;
  readonly review_status: string;
}

interface PackageHistoryResponse {
  readonly items: readonly PackageRun[];
  readonly next_cursor: string | null;
}

interface SupportData {
  readonly currentDecision: EarlyDecision | null;
  readonly decisions: readonly EarlyDecision[];
  readonly extractionFields: readonly ExtractedField[];
  readonly extractionIssues: readonly ExtractionIssue[];
  readonly extractionRequirements: readonly Requirement[];
  readonly extractionRun: ExtractionRun | null;
  readonly finalReadinessRuns: readonly FinalReadinessRun[];
  readonly matrix: MatrixResult | null;
  readonly packageHistory: readonly PackageRun[];
  readonly riskFindings: readonly RiskFinding[];
  readonly riskRun: RiskRun | null;
  readonly assessmentRun: AssessmentRun | null;
  readonly checklistItems: readonly ChecklistItem[];
  readonly checklistRun: ChecklistRun | null;
  readonly draftRuns: readonly DraftRun[];
  readonly drafts: readonly DraftSummary[];
}

interface EarlyDecision {
  readonly acknowledgedLimitations: boolean;
  readonly createdAt: string;
  readonly decision: "CONTINUE" | "HOLD" | "STOP";
  readonly id: string;
  readonly rationale: string;
  readonly riskAnalysisRunId: string;
  readonly supersededAt: string | null;
  readonly tenderVersionId: string;
}

type EvidenceFocusRequest = {
  readonly assessmentId?: string;
  readonly mode: "assessment" | "capture";
  readonly token: number;
} | null;

type LegacyStage =
  | "overview"
  | "sources"
  | "extraction"
  | "risks"
  | "evidence"
  | "checklist"
  | "ask"
  | "draft"
  | "readiness"
  | "export"
  | "eligibility"
  | "files"
  | "activity"
  | "review";

type TenderSurface =
  | "overview"
  | "eligibility"
  | "draft"
  | "ask"
  | "files"
  | "activity"
  | "review";

interface SurfaceResolution {
  readonly legacyStage: LegacyStage | null;
  readonly surface: TenderSurface;
}

interface ActivityItem {
  readonly category: string;
  readonly description: string;
  readonly occurredAt: string | null;
  readonly stage: TenderSurface;
  readonly title: string;
}

const emptySupportData: SupportData = {
  assessmentRun: null,
  checklistItems: [],
  checklistRun: null,
  currentDecision: null,
  decisions: [],
  draftRuns: [],
  drafts: [],
  extractionFields: [],
  extractionIssues: [],
  extractionRequirements: [],
  extractionRun: null,
  finalReadinessRuns: [],
  matrix: null,
  packageHistory: [],
  riskFindings: [],
  riskRun: null,
};

const surfaceLabels: Readonly<Record<TenderSurface, string>> = {
  activity: "Activity",
  ask: "AI Chat",
  draft: "Draft",
  eligibility: "Eligibility",
  files: "Tender Files",
  overview: "Overview",
  review: "Review & Export",
};

const primarySurfaces: readonly TenderSurface[] = [
  "overview",
  "eligibility",
  "draft",
  "ask",
];

const secondarySurfaces: readonly TenderSurface[] = ["files", "activity"];

function resolveSurface(requestedStage: string | null): SurfaceResolution {
  const stage = requestedStage as LegacyStage | null;
  switch (stage) {
    case null:
    case "overview":
      return { legacyStage: stage, surface: "overview" };
    case "eligibility":
    case "evidence":
    case "checklist":
      return { legacyStage: stage, surface: "eligibility" };
    case "draft":
      return { legacyStage: stage, surface: "draft" };
    case "ask":
      return { legacyStage: stage, surface: "ask" };
    case "sources":
    case "files":
      return { legacyStage: stage, surface: "files" };
    case "activity":
      return { legacyStage: stage, surface: "activity" };
    case "readiness":
    case "export":
    case "review":
      return { legacyStage: stage, surface: "review" };
    case "extraction":
    case "risks":
    default:
      return { legacyStage: stage, surface: "overview" };
  }
}

function surfaceStage(surface: TenderSurface): string | null {
  switch (surface) {
    case "overview":
      return "overview";
    case "eligibility":
      return "eligibility";
    case "draft":
      return "draft";
    case "ask":
      return "ask";
    case "files":
      return "files";
    case "activity":
      return "activity";
    case "review":
      return "review";
  }
}

function statusTone(
  value: string | null | undefined,
): "accent" | "danger" | "info" | "neutral" | "success" | "warning" {
  const current = value?.toUpperCase() ?? "";
  if (
    current.includes("BLOCK") ||
    current.includes("REJECT") ||
    current.includes("FAIL") ||
    current.includes("STOP")
  )
    return "danger";
  if (
    current.includes("REVIEW") ||
    current.includes("MISSING") ||
    current.includes("WARN") ||
    current.includes("CONFLICT")
  )
    return "warning";
  if (current.includes("DRAFT") || current.includes("PACKAGE")) return "accent";
  if (
    current.includes("READY") ||
    current.includes("VERIFIED") ||
    current.includes("COMPLETE")
  )
    return "success";
  if (
    current.includes("PROCESS") ||
    current.includes("QUEUE") ||
    current.includes("INDEX") ||
    current.includes("RUN")
  )
    return "info";
  return "neutral";
}

function isExpiredUpload(document: {
  readonly status: string;
  readonly uploadSessionExpiresAt: string;
}): boolean {
  return (
    document.status === "UPLOADING" &&
    new Date(document.uploadSessionExpiresAt).getTime() < Date.now()
  );
}

function isRemovableFailedUpload(document: {
  readonly status: string;
  readonly uploadSessionExpiresAt: string;
}): boolean {
  return isExpiredUpload(document);
}

function isRemovableReadySource(
  document: {
    readonly status: string;
  },
  options: {
    readonly documentCount: number;
    readonly isCurrentVersion: boolean;
  },
): boolean {
  return (
    document.status === "READY" &&
    options.isCurrentVersion &&
    options.documentCount === 1
  );
}

function documentStatusLabel(document: {
  readonly status: string;
  readonly uploadSessionExpiresAt: string;
}): string {
  return isExpiredUpload(document)
    ? "Upload failed"
    : humanizeEnum(document.status);
}

function formatTimestamp(value: string | null): string {
  if (value === null) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString();
}

function formatActivityTime(value: string | null): string {
  if (value === null) return "Time unavailable";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Time unavailable";
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const startOfActivityDay = new Date(
    parsed.getFullYear(),
    parsed.getMonth(),
    parsed.getDate(),
  );
  const dayDifference = Math.round(
    (startOfToday.getTime() - startOfActivityDay.getTime()) / 86_400_000,
  );
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
  if (dayDifference === 0) return time;
  if (dayDifference === 1) return `Yesterday · ${time}`;
  const date = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
  }).format(parsed);
  return `${date} · ${time}`;
}

function formatShortDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatFileSize(bytes: string): string {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 10 || unitIndex === 0 ? Math.round(size) : size.toFixed(1)} ${units[unitIndex]}`;
}

function fileType(filename: string): string {
  const extension = filename.split(".").pop()?.trim().toUpperCase();
  return extension === undefined || extension === filename.toUpperCase()
    ? "File"
    : extension;
}

function bestAssessmentLabel(matrix: MatrixResult | null): {
  readonly detail: string;
  readonly label: string;
  readonly tone:
    "accent" | "danger" | "info" | "neutral" | "success" | "warning";
} {
  if (matrix === null || matrix.total === 0) {
    return {
      detail: "Eligibility assessment has not produced a current result yet.",
      label: "Assessment unavailable",
      tone: "neutral",
    };
  }

  const counts = new Map(
    matrix.counts.map((item) => [item.currentState, item._count]),
  );
  if ((counts.get("CONFLICT") ?? 0) > 0) {
    return {
      detail: `${counts.get("CONFLICT") ?? 0} requirement${counts.get("CONFLICT") === 1 ? "" : "s"} conflict with current evidence or need a blocking resolution.`,
      label: "Blocking issues",
      tone: "danger",
    };
  }
  if ((counts.get("HUMAN_REVIEW_REQUIRED") ?? 0) > 0) {
    const reviewCount = counts.get("HUMAN_REVIEW_REQUIRED") ?? 0;
    return {
      detail: `${reviewCount} requirement${reviewCount === 1 ? "" : "s"} still need human interpretation before they can be confirmed.`,
      label:
        reviewCount === 1
          ? "1 requirement needs review"
          : `${reviewCount} requirements need review`,
      tone: "warning",
    };
  }
  if ((counts.get("MISSING") ?? 0) > 0) {
    return {
      detail: `${counts.get("MISSING") ?? 0} requirement${counts.get("MISSING") === 1 ? "" : "s"} still need current evidence.`,
      label: "Need information",
      tone: "warning",
    };
  }
  if (
    (counts.get("VERIFIED") ?? 0) > 0 ||
    (counts.get("LIKELY_MET") ?? 0) > 0
  ) {
    return {
      detail: `${(counts.get("VERIFIED") ?? 0) + (counts.get("LIKELY_MET") ?? 0)} requirements currently look satisfied or likely met.`,
      label: "Satisfied where evidenced",
      tone: "success",
    };
  }
  return {
    detail: "Assessment items exist but still need further review.",
    label: "Needs review",
    tone: "info",
  };
}

function deriveAssessmentLabel(input: {
  readonly assessmentRun: AssessmentRun | null;
  readonly currentDecision: EarlyDecision | null;
  readonly hasExtractedContent: boolean;
  readonly extractionRun: ExtractionRun | null;
  readonly hasReadySource: boolean;
  readonly matrix: MatrixResult | null;
  readonly riskRun: RiskRun | null;
}): {
  readonly detail: string;
  readonly label: string;
  readonly tone:
    "accent" | "danger" | "info" | "neutral" | "success" | "warning";
} {
  if (input.matrix !== null) return bestAssessmentLabel(input.matrix);
  if (!input.hasReadySource) {
    return {
      detail: "Upload a primary tender source to begin.",
      label: "Awaiting source",
      tone: "neutral",
    };
  }
  if (input.extractionRun === null && !input.hasExtractedContent) {
    return {
      detail: "Source is ready. Processing will begin shortly.",
      label: "Extraction not started",
      tone: "warning",
    };
  }
  if (
    input.extractionRun !== null &&
    input.extractionRun.status !== "COMPLETE"
  ) {
    return {
      detail: "Analyzing tender...",
      label: "Analysing tender...",
      tone: "info",
    };
  }
  if (input.riskRun?.status === "FAILED") {
    return {
      detail: input.riskRun.safeFailureMessage ?? "Risk analysis failed.",
      label: "Risk analysis failed",
      tone: "danger",
    };
  }
  if (input.riskRun === null) {
    return {
      detail: "Extraction complete. Awaiting risk analysis.",
      label: "Risk analysis not started",
      tone: "warning",
    };
  }
  if (input.riskRun?.status !== "COMPLETE") {
    return {
      detail: "Analyzing tender...",
      label: "Analysing tender...",
      tone: "info",
    };
  }
  if (
    input.assessmentRun !== null &&
    input.assessmentRun.status !== "COMPLETE"
  ) {
    return {
      detail: "Comparing evidence...",
      label: "Comparing evidence...",
      tone: "info",
    };
  }
  if (
    input.currentDecision !== null &&
    input.currentDecision.decision !== "CONTINUE"
  ) {
    return {
      detail: `The current early bid decision is ${humanizeEnum(input.currentDecision.decision)}. Eligibility comparison will not proceed until that decision changes.`,
      label: humanizeEnum(input.currentDecision.decision),
      tone: input.currentDecision.decision === "HOLD" ? "warning" : "danger",
    };
  }
  if (
    input.currentDecision?.decision === "CONTINUE" &&
    input.assessmentRun === null
  ) {
    return {
      detail: "Ready for eligibility review.",
      label: "Eligibility review not started",
      tone: "warning",
    };
  }
  return {
    detail: "Please review risks and make a pursuit decision.",
    label: "Decision needed",
    tone: "warning",
  };
}

function hasCurrentExtractedContent(
  support: Pick<
    SupportData,
    | "assessmentRun"
    | "extractionFields"
    | "extractionIssues"
    | "extractionRequirements"
    | "extractionRun"
    | "matrix"
    | "riskRun"
  >,
): boolean {
  return (
    support.extractionRun?.status === "COMPLETE" ||
    support.extractionFields.length > 0 ||
    support.extractionIssues.length > 0 ||
    support.extractionRequirements.length > 0 ||
    support.riskRun !== null ||
    support.assessmentRun !== null ||
    support.matrix !== null
  );
}

function toAssessmentRequirement(item: MatrixItem): EligibilityViewRequirement {
  return {
    assessmentId: item.id,
    categoryLabel: requirementCategoryLabel(item.requirementCategory),
    evidenceLinks: item.evidenceLinks.map((link) => ({
      excerpt:
        link.evidenceCitation?.boundedExcerpt ??
        "The current evidence link has no bounded excerpt.",
      label: humanizeEnum(link.linkType),
      supportingText:
        link.evidenceCitation === null
          ? "Current evidence details unavailable"
          : `${link.evidenceCitation.documentName}${link.evidenceCitation.pageNumber === null ? "" : `, page ${link.evidenceCitation.pageNumber}`}`,
    })),
    id: item.id,
    reviewStateLabel: humanizeEnum(item.reviewState),
    sourceCitation: {
      ...item.tenderCitation,
      clauseLabel: null,
    },
    stateKey: item.currentState,
    statement: item.structuredRequirement.normalizedStatement,
    statusLabel: humanizeEnum(item.currentState),
    statusTone: statusTone(item.currentState),
    structuredRequirementId: item.structuredRequirement.id,
    title: conciseRequirementTitle({
      category: item.requirementCategory,
      normalizedStatement: item.structuredRequirement.normalizedStatement,
      sourceCitation: {
        boundedExcerpt: item.tenderCitation.boundedExcerpt,
      },
      sourceWording: item.tenderCitation.boundedExcerpt,
      title: item.structuredRequirement.title,
    }),
    whatToDo:
      item.currentState === "MISSING"
        ? "Add current company evidence, then review this requirement again."
        : item.currentState === "HUMAN_REVIEW_REQUIRED"
          ? "Review this requirement and record the current human decision."
          : item.currentState === "CONFLICT"
            ? "Review the conflicting evidence and record the correct state."
            : "Confirm the current assessment remains appropriate.",
    why:
      item.proposedRationale === ""
        ? "The current assessment explanation is unavailable."
        : item.proposedRationale,
  };
}

function toExtractedRequirement(
  item: Requirement,
  phase:
    | "ASSESSING"
    | "ASSESSMENT_NOT_STARTED"
    | "AWAITING_DECISION"
    | "RISK"
    | "RISK_FAILED"
    | "RISK_NOT_STARTED"
    | "EXTRACTING",
): EligibilityViewRequirement {
  const citation = item.citations[0] ?? null;
  const statusLabel =
    phase === "ASSESSING"
      ? "Checking eligibility..."
      : phase === "ASSESSMENT_NOT_STARTED"
        ? "Queued to check"
        : phase === "RISK_FAILED"
          ? "Risk review failed"
          : phase === "RISK_NOT_STARTED"
            ? "Risk review pending"
            : phase === "AWAITING_DECISION"
              ? "Ready to review"
              : phase === "RISK"
                ? "Risk review running..."
                : "Reading source...";
  const whatToDo =
    phase === "ASSESSING"
      ? "Eligibility review is in progress. The detail panel will update automatically."
      : phase === "ASSESSMENT_NOT_STARTED"
        ? "Eligibility review will start automatically after the latest Continue decision."
        : phase === "RISK_FAILED"
          ? "Retry the failed risk review before eligibility comparison can continue."
          : phase === "RISK_NOT_STARTED"
            ? "Extraction is complete, but risk review has not started yet."
            : phase === "AWAITING_DECISION"
              ? "Requirements check will start after you choose Continue. Review the extracted tender requirement while you decide whether to proceed."
              : phase === "RISK"
                ? "Risk review is still running before evidence comparison can start."
                : "Tender extraction is still running. Requirement details will continue to fill in automatically.";
  const why =
    item.sourceWording.trim() === ""
      ? "This requirement was found in the tender and is awaiting the next review step."
      : item.sourceWording;
  return {
    extractionConfidence: item.confidence,
    assessmentId: null,
    categoryLabel: requirementCategoryLabel(item.category),
    evidenceLinks: [],
    id: item.id,
    reviewStateLabel: humanizeEnum(item.reviewState),
    sourceCitation:
      citation === null
        ? null
        : {
            boundedExcerpt: citation.boundedExcerpt,
            clauseLabel: citation.clauseLabel ?? null,
            documentName: citation.documentName,
            pageNumber: citation.pageNumber,
            tenderDocumentId: citation.tenderDocumentId,
          },
    stateKey:
      phase === "ASSESSING"
        ? "ASSESSING"
        : phase === "ASSESSMENT_NOT_STARTED"
          ? "ASSESSMENT_NOT_STARTED"
          : phase === "RISK_FAILED"
            ? "RISK_FAILED"
            : phase === "RISK_NOT_STARTED"
              ? "RISK_NOT_STARTED"
              : phase === "AWAITING_DECISION"
                ? "AWAITING_DECISION"
                : phase === "RISK"
                  ? "RISK_ANALYSIS"
                  : "EXTRACTING",
    statement: item.normalizedStatement,
    statusLabel,
    statusTone:
      phase === "RISK_FAILED"
        ? "danger"
        : phase === "AWAITING_DECISION" ||
            phase === "ASSESSMENT_NOT_STARTED" ||
            phase === "RISK_NOT_STARTED"
          ? "warning"
          : phase === "ASSESSING" || phase === "RISK" || phase === "EXTRACTING"
            ? "info"
            : "neutral",
    structuredRequirementId: item.id,
    title: conciseRequirementTitle({
      category: item.category,
      normalizedStatement: item.normalizedStatement,
      sourceCitation: citation,
      sourceWording: item.sourceWording,
      title: item.title,
    }),
    whatToDo,
    why,
  };
}

function topRequirements(matrix: MatrixResult | null): readonly MatrixItem[] {
  if (matrix === null) return [];
  const order = new Map([
    ["CONFLICT", 0],
    ["HUMAN_REVIEW_REQUIRED", 1],
    ["MISSING", 2],
    ["LIKELY_MET", 3],
    ["VERIFIED", 4],
    ["NOT_APPLICABLE", 5],
  ]);
  return [...matrix.items].sort((left, right) => {
    const leftScore = order.get(left.currentState) ?? 99;
    const rightScore = order.get(right.currentState) ?? 99;
    if (leftScore !== rightScore) return leftScore - rightScore;
    return left.structuredRequirement.title.localeCompare(
      right.structuredRequirement.title,
    );
  });
}

function checklistItemMatchesRequirement(
  item: ChecklistItem,
  requirement: EligibilityViewRequirement,
): boolean {
  return (
    (requirement.assessmentId !== null &&
      (item.assessmentLinks ?? []).some(
        (link) => link.assessmentId === requirement.assessmentId,
      )) ||
    (requirement.structuredRequirementId !== null &&
      (item.requirementLinks ?? []).some(
        (link) =>
          link.structuredRequirementId === requirement.structuredRequirementId,
      ))
  );
}

function extractKeyFields(
  fields: readonly ExtractedField[],
): readonly ExtractedField[] {
  const keywords = [
    "DEADLINE",
    "VALUE",
    "EMD",
    "PERFORMANCE_SECURITY",
    "TURNOVER",
    "EXPERIENCE",
    "DELIVERY",
  ];
  return fields.filter((field) =>
    keywords.some((keyword) => field.fieldType.toUpperCase().includes(keyword)),
  );
}

function keyTenderDetailLabel(fieldType: string): string {
  const type = fieldType.toUpperCase();
  if (type.includes("PERFORMANCE_SECURITY")) return "Performance security";
  if (type.includes("TURNOVER")) return "Minimum turnover";
  if (type.includes("EXPERIENCE")) return "Required experience";
  if (type.includes("DELIVERY")) return "Delivery period";
  if (type.includes("EMD")) return "EMD";
  if (type.includes("VALUE")) return "Tender value";
  return humanizeEnum(fieldType);
}

function buildKeyTenderDetails(
  fields: readonly ExtractedField[],
  submissionDeadline: string | undefined,
  sourceName: string | undefined,
): readonly {
  readonly id: string;
  readonly label: string;
  readonly normalizedTextValue: string;
}[] {
  const details = fields
    .filter((field) => (field.normalizedTextValue ?? "").trim() !== "")
    .slice(0, 5)
    .map((field) => ({
      id: field.id,
      label: keyTenderDetailLabel(field.fieldType),
      normalizedTextValue: field.normalizedTextValue ?? "",
    }));
  if (submissionDeadline !== undefined)
    details.push({
      id: "submission-deadline",
      label: "Submission deadline",
      normalizedTextValue: formatDeadline(submissionDeadline),
    });
  if (details.length === 0)
    details.push({
      id: "tender-source",
      label: "Tender source",
      normalizedTextValue: sourceName ?? "Details unavailable",
    });
  return details;
}

function buildActivityItems(
  workspace: Workspace | null,
  support: SupportData,
): readonly ActivityItem[] {
  const items: ActivityItem[] = [];

  if (support.extractionRun !== null) {
    items.push({
      category: "Processing",
      description: support.extractionRun.public_message,
      occurredAt: null,
      stage: "overview",
      title: `Tender extraction ${humanizeEnum(support.extractionRun.status)}`,
    });
  }

  if (support.riskRun !== null) {
    items.push({
      category: "Risk",
      description: support.riskRun.publicMessage,
      occurredAt: null,
      stage: "overview",
      title: `Risk review ${humanizeEnum(support.riskRun.status)}`,
    });
  }

  if (support.assessmentRun !== null) {
    items.push({
      category: "Eligibility",
      description: support.assessmentRun.publicMessage,
      occurredAt: support.assessmentRun.snapshot?.capturedAt ?? null,
      stage: "eligibility",
      title: `Requirements check `,
    });
  }

  if (support.checklistRun !== null) {
    items.push({
      category: "Missing items",
      description: support.checklistRun.publicMessage,
      occurredAt: support.checklistRun.completedAt,
      stage: "eligibility",
      title: `Missing items ${humanizeEnum(support.checklistRun.status)}`,
    });
  }

  support.draftRuns.forEach((run) => {
    items.push({
      category: "Draft",
      description: `${run.validatedClaimCount} validated claims, ${run.placeholderCount} placeholders.`,
      occurredAt: null,
      stage: "draft",
      title: `Draft ${humanizeEnum(run.status)}`,
    });
  });

  support.finalReadinessRuns.forEach((run) => {
    items.push({
      category: "Final review",
      description:
        run.current_disposition === null
          ? "No final human disposition recorded yet."
          : `Current disposition: ${humanizeEnum(run.current_disposition.disposition)}.`,
      occurredAt: run.updated_at,
      stage: "review",
      title: `Final review ${humanizeEnum(run.status)}`,
    });
  });

  support.packageHistory.forEach((run) => {
    items.push({
      category: "Review package",
      description: `${humanizeEnum(run.review_status)} review state.`,
      occurredAt: run.created_at,
      stage: "review",
      title: `Review package ${humanizeEnum(run.generation_status)}`,
    });
  });

  workspace?.corrigenda.forEach((corrigendum) => {
    items.push({
      category: "Tender files",
      description: corrigendum.description,
      occurredAt: corrigendum.publicationDate,
      stage: "files",
      title: `Corrigendum ${corrigendum.identifier}`,
    });
  });

  return items.sort((left, right) => {
    if (left.occurredAt === null && right.occurredAt === null)
      return left.title.localeCompare(right.title);
    if (left.occurredAt === null) return 1;
    if (right.occurredAt === null) return -1;
    return right.occurredAt.localeCompare(left.occurredAt);
  });
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function safeApi<T>(
  path: string,
  allowNotFound = false,
): Promise<T | null> {
  try {
    return await apiRequest<T>(path);
  } catch (error) {
    if (
      allowNotFound &&
      error instanceof PublicApiError &&
      error.status === 404
    )
      return null;
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPackageRunArray(value: unknown): value is readonly PackageRun[] {
  return Array.isArray(value);
}

function isRiskRunValue(value: unknown): value is RiskRun {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.status === "string"
  );
}

function isAssessmentRunValue(value: unknown): value is AssessmentRun {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.status === "string" &&
    (value.snapshot === undefined ||
      value.snapshot === null ||
      (isRecord(value.snapshot) &&
        typeof value.snapshot.capturedAt === "string"))
  );
}

function isMatrixResultValue(value: unknown): value is MatrixResult {
  return (
    isRecord(value) &&
    Array.isArray(value.counts) &&
    Array.isArray(value.items) &&
    typeof value.total === "number"
  );
}

function isChecklistResultValue(value: unknown): value is ChecklistResult {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    Array.isArray(value.priority_counts) &&
    Array.isArray(value.status_counts) &&
    typeof value.total === "number"
  );
}

function normalizePackageHistory(
  response: PackageHistoryResponse | null,
): readonly PackageRun[] {
  if (response === null) return [];
  if (!isRecord(response) || !isPackageRunArray(response.items)) {
    throw new Error("Controlled review package history response was invalid.");
  }
  return response.items;
}

function SurfaceLink({
  activeSurface,
  label,
  onSelect,
  surface,
}: {
  readonly activeSurface: TenderSurface;
  readonly label: string;
  readonly onSelect: (surface: TenderSurface) => void;
  readonly surface: TenderSurface;
}): JSX.Element {
  return (
    <button
      aria-current={activeSurface === surface ? "page" : undefined}
      className={`tender-nav__link ${activeSurface === surface ? "tender-nav__link--active" : ""}`}
      onClick={() => onSelect(surface)}
      type="button"
    >
      {label}
    </button>
  );
}

export function TenderWorkspace({
  organisationId,
  tenderId,
}: {
  readonly organisationId: string;
  readonly tenderId: string;
}): JSX.Element {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [support, setSupport] = useState<SupportData>(emptySupportData);
  const [supportError, setSupportError] = useState("");
  const [message, setMessage] = useState("Loading workspace...");
  const [selectedRequirementId, setSelectedRequirementId] = useState("");
  const [eligibilityFilter, setEligibilityFilter] = useState("ALL");
  const [eligibilityFiltersOpen, setEligibilityFiltersOpen] = useState(false);
  const [showFileUpload, setShowFileUpload] = useState(false);
  const [uploadRole, setUploadRole] = useState("PRIMARY");
  const [filesFilter, setFilesFilter] = useState<"ALL" | "CORRIGENDA">("ALL");
  const [activityFilter, setActivityFilter] = useState("ALL");
  const [showAllActivity, setShowAllActivity] = useState(false);
  const [decisionSubmitting, setDecisionSubmitting] = useState(false);
  const [decisionFeedback, setDecisionFeedback] = useState("");
  const [decisionEditorOpen, setDecisionEditorOpen] = useState(false);
  const [evidenceReviewOpen, setEvidenceReviewOpen] = useState(false);
  const [evidenceFocusRequest, setEvidenceFocusRequest] =
    useState<EvidenceFocusRequest>(null);
  const [eligibilityAutomationRetry, setEligibilityAutomationRetry] =
    useState(0);
  const [riskRetrying, setRiskRetrying] = useState(false);
  const workspaceLoadToken = useRef(0);
  const workspacePollPromise = useRef<Promise<void> | null>(null);
  const supportLoadPromise = useRef<Promise<void> | null>(null);
  const supportLoadVersionId = useRef("");
  const supportRefreshQueued = useRef(false);
  const supportLoadToken = useRef(0);
  const currentVersionIdRef = useRef("");
  const activeScopeRef = useRef("");
  const evidenceDetailsRef = useRef<HTMLDetailsElement | null>(null);
  const automaticChecklistAttempts = useRef(new Set<string>());
  const [pendingFileRemoval, setPendingFileRemoval] = useState<null | {
    readonly confirmLabel: string;
    readonly description: string;
    readonly documentId: string;
    readonly successMessage: string;
    readonly title: string;
  }>(null);
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const requestedStage = searchParams.get("stage");
  const resolution = resolveSurface(requestedStage);
  const activeSurface = resolution.surface;

  function navigateSurface(surface: TenderSurface): void {
    const next = new URLSearchParams(searchParams.toString());
    const stage = surfaceStage(surface);
    if (stage === null) next.delete("stage");
    else next.set("stage", stage);
    router.push(`${pathname}${next.size === 0 ? "" : `?${next.toString()}`}`);
  }

  async function loadWorkspace(refreshSupport = true): Promise<void> {
    const token = workspaceLoadToken.current + 1;
    workspaceLoadToken.current = token;
    try {
      const loaded = await apiRequest<Workspace>(
        `/organisations/${organisationId}/tenders/${tenderId}`,
      );
      if (workspaceLoadToken.current !== token) return;
      const latestVersionId = loaded.versions[0]?.id ?? "";
      const versionChanged = currentVersionIdRef.current !== latestVersionId;
      if (versionChanged) {
        currentVersionIdRef.current = latestVersionId;
        supportLoadToken.current += 1;
        setSupport(emptySupportData);
        setSupportError("");
      }
      setWorkspace(loaded);
      setMessage("");
      if ((refreshSupport || versionChanged) && latestVersionId !== "") {
        void refreshSupportData(
          latestVersionId,
          (loaded.versions[0]?.documents.length ?? 0) > 0,
        );
      }
    } catch (error) {
      if (workspaceLoadToken.current !== token) return;
      setMessage(
        formatApiError(error, "Unable to load this tender workspace."),
      );
    }
  }

  function refreshWorkspaceIfIdle(refreshSupport: boolean): void {
    if (workspacePollPromise.current !== null) return;
    const pending = loadWorkspace(refreshSupport);
    workspacePollPromise.current = pending;
    void pending.finally(() => {
      if (workspacePollPromise.current === pending)
        workspacePollPromise.current = null;
    });
  }

  async function loadSupportData(
    versionId: string,
    fetchCurrentResults = true,
  ): Promise<void> {
    const token = supportLoadToken.current + 1;
    supportLoadToken.current = token;
    const base = `/organisations/${organisationId}/tenders/${tenderId}`;
    const [
      extractionRuns,
      riskRuns,
      assessmentRuns,
      checklistRuns,
      draftRuns,
      drafts,
      readinessHistory,
      packageHistory,
    ] = await Promise.all([
      safeApi<readonly ExtractionRun[]>(
        `${base}/versions/${versionId}/extractions`,
      ),
      safeApi<readonly RiskRun[]>(
        `${base}/versions/${versionId}/risk-analyses`,
      ),
      safeApi<readonly AssessmentRun[]>(
        `${base}/versions/${versionId}/eligibility-assessments`,
      ),
      safeApi<readonly ChecklistRun[]>(
        `${base}/versions/${versionId}/checklists`,
      ),
      safeApi<readonly DraftRun[]>(`${base}/draft-generation-runs`),
      safeApi<readonly DraftSummary[]>(`${base}/drafts`),
      safeApi<{
        items: readonly FinalReadinessRun[];
        next_cursor: string | null;
      }>(`${base}/versions/${versionId}/final-readiness?limit=25`),
      safeApi<PackageHistoryResponse>(
        `${base}/versions/${versionId}/controlled-review-packages`,
      ),
    ]);

    // The current-result endpoints intentionally return 404 before a source is
    // uploaded. Keep polling semantics for every sourced tender, including the
    // brief period where a current run exists before it appears in history.
    const [currentRiskRun, currentAssessmentRun] = await Promise.all([
      !fetchCurrentResults
        ? Promise.resolve(null)
        : safeApi<unknown>(
            `${base}/versions/${versionId}/risk-analyses/current`,
            true,
          ),
      !fetchCurrentResults
        ? Promise.resolve(null)
        : safeApi<unknown>(
            `${base}/versions/${versionId}/eligibility-assessments/current`,
            true,
          ),
    ]);

    const latestExtractionRun = extractionRuns?.[0] ?? null;
    const latestRiskRun = isRiskRunValue(currentRiskRun)
      ? currentRiskRun
      : (riskRuns?.[0] ?? null);
    const currentAssessment =
      (isAssessmentRunValue(currentAssessmentRun)
        ? currentAssessmentRun
        : null) ??
      assessmentRuns?.find((run) => run.invalidatedAt == null) ??
      null;
    const currentChecklist =
      currentAssessment === null
        ? null
        : (checklistRuns?.find(
            (run) =>
              run.invalidatedAt == null &&
              run.assessmentRunId === currentAssessment.id,
          ) ?? null);
    const decisions =
      latestRiskRun === null
        ? []
        : ((await safeApi<readonly EarlyDecision[]>(
            `${base}/risk-analyses/${latestRiskRun.id}/decisions`,
          )) ?? []);

    const [
      extractionRequirements,
      extractionFields,
      extractionIssues,
      riskFindings,
      matrix,
      checklist,
    ] = await Promise.all([
      latestExtractionRun === null
        ? Promise.resolve(null)
        : safeApi<readonly Requirement[]>(
            `${base}/extractions/${latestExtractionRun.id}/requirements`,
          ),
      latestExtractionRun === null
        ? Promise.resolve(null)
        : safeApi<readonly ExtractedField[]>(
            `${base}/extractions/${latestExtractionRun.id}/fields`,
          ),
      latestExtractionRun === null
        ? Promise.resolve(null)
        : safeApi<readonly ExtractionIssue[]>(
            `${base}/extractions/${latestExtractionRun.id}/issues`,
          ),
      latestRiskRun === null
        ? Promise.resolve(null)
        : safeApi<readonly RiskFinding[]>(
            `${base}/risk-analyses/${latestRiskRun.id}/findings`,
          ),
      currentAssessment === null
        ? Promise.resolve(null)
        : safeApi<unknown>(
            `${base}/eligibility-assessments/${currentAssessment.id}/matrix`,
          ),
      currentChecklist === null
        ? Promise.resolve(null)
        : safeApi<unknown>(`${base}/checklists/${currentChecklist.id}/items`),
    ]);

    if (
      supportLoadToken.current !== token ||
      activeScopeRef.current !== `${organisationId}:${tenderId}`
    )
      return;
    setSupportError("");
    setSupport({
      assessmentRun: currentAssessment,
      checklistItems: isChecklistResultValue(checklist) ? checklist.items : [],
      checklistRun: currentChecklist,
      currentDecision:
        decisions.find((decision) => decision.supersededAt === null) ??
        decisions[0] ??
        null,
      decisions,
      draftRuns: draftRuns ?? [],
      drafts: drafts ?? [],
      extractionFields: extractionFields ?? [],
      extractionIssues: extractionIssues ?? [],
      extractionRequirements: extractionRequirements ?? [],
      extractionRun: latestExtractionRun,
      finalReadinessRuns: readinessHistory?.items ?? [],
      matrix: isMatrixResultValue(matrix) ? matrix : null,
      packageHistory: normalizePackageHistory(packageHistory),
      riskFindings: riskFindings ?? [],
      riskRun: latestRiskRun,
    });
  }

  async function refreshSupportData(
    versionId: string,
    fetchCurrentResults = true,
  ): Promise<void> {
    if (supportLoadPromise.current !== null) {
      const pending = supportLoadPromise.current;
      const sameVersion = supportLoadVersionId.current === versionId;
      if (sameVersion) supportRefreshQueued.current = true;
      try {
        await pending;
      } catch {
        // The owning refresh reports the error and handles a queued retry.
      }
      if (
        !sameVersion &&
        currentVersionIdRef.current === versionId &&
        activeScopeRef.current === `${organisationId}:${tenderId}`
      )
        await refreshSupportData(versionId, fetchCurrentResults);
      return;
    }
    do {
      supportRefreshQueued.current = false;
      const pending = loadSupportData(versionId, fetchCurrentResults);
      supportLoadPromise.current = pending;
      supportLoadVersionId.current = versionId;
      try {
        await pending;
      } catch (error) {
        if (
          activeScopeRef.current === `${organisationId}:${tenderId}` &&
          currentVersionIdRef.current === versionId
        )
          setSupportError(
            formatApiError(error, "Unable to refresh tender analysis."),
          );
        if (!supportRefreshQueued.current) return;
      } finally {
        if (supportLoadPromise.current === pending) {
          supportLoadPromise.current = null;
          supportLoadVersionId.current = "";
        }
      }
    } while (
      supportRefreshQueued.current &&
      currentVersionIdRef.current === versionId &&
      activeScopeRef.current === `${organisationId}:${tenderId}`
    );
  }

  useEffect(() => {
    activeScopeRef.current = `${organisationId}:${tenderId}`;
    void loadWorkspace();
    return () => {
      activeScopeRef.current = "";
      workspaceLoadToken.current += 1;
      workspacePollPromise.current = null;
      supportLoadToken.current += 1;
      supportLoadPromise.current = null;
      supportLoadVersionId.current = "";
      supportRefreshQueued.current = false;
    };
  }, [organisationId, tenderId]);

  const currentVersionId = workspace?.versions[0]?.id ?? "";
  useEffect(() => {
    currentVersionIdRef.current = currentVersionId;
  }, [currentVersionId]);

  const supportAutoRefreshNeeded =
    currentVersionId !== "" &&
    (workspace?.workflowState?.isInProgress === true ||
      (support.extractionRun?.status === "COMPLETE" &&
        support.riskRun === null) ||
      (support.riskRun !== null &&
        !["COMPLETE", "FAILED"].includes(support.riskRun.status)) ||
      (support.currentDecision?.decision === "CONTINUE" &&
        support.assessmentRun === null) ||
      (support.assessmentRun !== null &&
        support.assessmentRun.status !== "COMPLETE") ||
      (support.assessmentRun?.status === "COMPLETE" &&
        support.checklistRun === null));

  useEffect(() => {
    if (!supportAutoRefreshNeeded) return;
    const timer = window.setInterval(
      () => refreshWorkspaceIfIdle(false),
      5_000,
    );
    return () => window.clearInterval(timer);
  }, [organisationId, tenderId, supportAutoRefreshNeeded]);

  useEffect(() => {
    const refresh = (): void => {
      if (document.visibilityState === "visible") refreshWorkspaceIfIdle(true);
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [organisationId, tenderId]);

  useEffect(() => {
    if (!supportAutoRefreshNeeded) return;
    let cancelled = false;
    const refresh = async (): Promise<void> => {
      if (cancelled) return;
      await refreshSupportData(currentVersionId);
    };
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    currentVersionId,
    organisationId,
    support.assessmentRun,
    support.checklistRun,
    support.currentDecision?.decision,
    support.extractionRun?.status,
    support.riskRun,
    supportAutoRefreshNeeded,
    tenderId,
  ]);

  useEffect(() => {
    const assessment = support.assessmentRun;
    if (
      currentVersionId === "" ||
      assessment?.status !== "COMPLETE" ||
      support.checklistRun !== null ||
      automaticChecklistAttempts.current.has(assessment.id)
    )
      return;
    automaticChecklistAttempts.current.add(assessment.id);
    let cancelled = false;
    let retryTimer: number | undefined;
    void Promise.resolve(
      apiRequest(
        `/organisations/${organisationId}/tenders/${tenderId}/versions/${currentVersionId}/checklists`,
        {
          body: JSON.stringify({
            idempotency_key:
              globalThis.crypto?.randomUUID?.() ??
              `${assessment.id}-automatic-checklist`,
          }),
          method: "POST",
        },
      ),
    ).catch(() => {
      automaticChecklistAttempts.current.delete(assessment.id);
      if (!cancelled)
        retryTimer = window.setTimeout(
          () => setEligibilityAutomationRetry((current) => current + 1),
          5_000,
        );
    });
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [
    currentVersionId,
    eligibilityAutomationRetry,
    organisationId,
    support.assessmentRun,
    support.checklistRun,
    tenderId,
  ]);

  async function upload(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (workspace === null) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const submittedFiles = values
      .getAll("file")
      .filter(
        (value): value is File => value instanceof File && value.size > 0,
      );
    const fileField = form.elements.namedItem("file");
    const selectedFiles =
      fileField instanceof HTMLInputElement
        ? Array.from(fileField.files ?? []).filter((file) => file.size > 0)
        : [];
    const files = submittedFiles.length > 0 ? submittedFiles : selectedFiles;
    const role = values.get("role");
    const version = workspace.versions[0];
    if (files.length === 0 || version === undefined || typeof role !== "string")
      return;
    if (role === "CORRIGENDUM" && files.length !== 1) {
      setMessage(
        "Upload one corrigendum at a time to preserve version history.",
      );
      return;
    }

    setMessage("Preparing secure direct upload...");
    try {
      for (const [index, file] of files.entries()) {
        setMessage(
          `Calculating checksum for source ${index + 1} of ${files.length}...`,
        );
        const checksum = await sha256(file);
        let targetVersionId = version.id;
        if (role === "CORRIGENDUM") {
          const identifier = values.get("corrigendum_identifier");
          const description = values.get("corrigendum_description");
          if (
            typeof identifier !== "string" ||
            identifier.length === 0 ||
            typeof description !== "string" ||
            description.length === 0
          )
            throw new Error("Corrigendum metadata is required");
          const result = await apiRequest<{ version_id: string }>(
            `/organisations/${organisationId}/tenders/${tenderId}/corrigenda`,
            {
              body: JSON.stringify({
                checksum_sha256: checksum,
                description,
                identifier,
              }),
              method: "POST",
            },
          );
          targetVersionId = result.version_id;
        }
        const session = await apiRequest<UploadSession>(
          `/organisations/${organisationId}/tenders/${tenderId}/versions/${targetVersionId}/upload-sessions`,
          {
            body: JSON.stringify({
              checksum_sha256: checksum,
              filename: file.name,
              mime_type: file.type,
              role,
              size_bytes: file.size,
            }),
            method: "POST",
          },
        );
        try {
          setMessage(
            `Uploading source ${index + 1} of ${files.length} to private storage...`,
          );
          await uploadFileToSignedStorageUrl(
            session.upload_url,
            file,
            checksum,
          );
        } catch {
          try {
            await apiRequest(
              `/organisations/${organisationId}/tenders/${tenderId}/documents/${session.document_id}`,
              { method: "DELETE" },
            );
          } catch {
            // Preserve the original direct-upload failure.
          }
          throw new Error(
            `The direct upload of "${file.name}" was rejected before it reached secure storage.`,
          );
        }
        try {
          setMessage(
            `Verifying source ${index + 1} of ${files.length} and starting security processing...`,
          );
          await apiRequest(
            `/organisations/${organisationId}/tenders/${tenderId}/documents/${session.document_id}/complete`,
            {
              body: JSON.stringify({ checksum_sha256: checksum }),
              method: "POST",
            },
          );
        } catch {
          throw new Error(
            `"${file.name}" reached storage but could not be verified and will show as Upload failed. Remove it and try again.`,
          );
        }
      }
      form.reset();
      setMessage("Upload accepted. Security processing is in progress.");
      setShowFileUpload(false);
      await loadWorkspace(true);
      setDecisionFeedback("");
    } catch (caught) {
      setMessage(
        caught instanceof Error
          ? caught.message
          : "Upload rejected. Check the file type, size, and contents.",
      );
    }
  }

  async function download(documentId: string): Promise<void> {
    const result = await apiRequest<{ download_url: string }>(
      `/organisations/${organisationId}/tenders/${tenderId}/documents/${documentId}/download`,
      { method: "POST" },
    );
    window.open(result.download_url, "_blank", "noopener,noreferrer");
  }

  async function removeTenderFile(): Promise<void> {
    if (pendingFileRemoval === null) return;
    try {
      await apiRequest(
        `/organisations/${organisationId}/tenders/${tenderId}/documents/${pendingFileRemoval.documentId}`,
        { method: "DELETE" },
      );
      setWorkspace((current) =>
        current === null
          ? current
          : {
              ...current,
              versions: current.versions.map((version) => ({
                ...version,
                documents: version.documents.filter(
                  (document) => document.id !== pendingFileRemoval.documentId,
                ),
              })),
            },
      );
      await loadWorkspace(true);
      setMessage(pendingFileRemoval.successMessage);
      setPendingFileRemoval(null);
      setDecisionFeedback("");
    } catch (caught) {
      setMessage(
        formatApiError(
          caught,
          "The tender file could not be removed. Refresh and try again.",
        ),
      );
    }
  }

  async function retryRiskAnalysis(): Promise<void> {
    if (support.riskRun === null || riskRetrying || currentVersionId === "")
      return;
    setRiskRetrying(true);
    try {
      await apiRequest(
        `/organisations/${organisationId}/tenders/${tenderId}/risk-analyses/${support.riskRun.id}/retry`,
        {
          body: JSON.stringify({ idempotency_key: crypto.randomUUID() }),
          method: "POST",
        },
      );
      setDecisionFeedback("Early risk analysis retry queued.");
      await refreshSupportData(currentVersionId);
    } catch (caught) {
      setDecisionFeedback(
        formatApiError(caught, "The early risk analysis could not be retried."),
      );
    } finally {
      setRiskRetrying(false);
    }
  }

  async function recordPursuitDecision(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (
      support.riskRun === null ||
      decisionSubmitting ||
      currentVersionId === ""
    )
      return;
    const form = event.currentTarget;
    const values = new FormData(form);
    setDecisionSubmitting(true);
    try {
      const recordedDecision = await apiRequest<EarlyDecision>(
        `/organisations/${organisationId}/tenders/${tenderId}/risk-analyses/${support.riskRun.id}/decisions`,
        {
          body: JSON.stringify({
            acknowledged_limitations: values.get("acknowledged") === "on",
            decision: values.get("decision"),
            rationale: values.get("rationale"),
          }),
          method: "POST",
        },
      );
      form.reset();
      setDecisionFeedback("Bid decision saved.");
      setDecisionEditorOpen(false);
      setSupport((current) => {
        const decisions = [
          recordedDecision,
          ...current.decisions.filter(
            (item) => item.id !== recordedDecision.id,
          ),
        ];
        return {
          ...current,
          currentDecision:
            decisions.find((item) => item.supersededAt === null) ??
            decisions[0] ??
            null,
          decisions,
        };
      });
      await loadWorkspace();
      const latestVersionId = currentVersionIdRef.current || currentVersionId;
      if (latestVersionId !== "") await refreshSupportData(latestVersionId);
    } catch (caught) {
      setDecisionFeedback(
        formatApiError(caught, "The decision could not be recorded."),
      );
    } finally {
      setDecisionSubmitting(false);
    }
  }

  function openEvidenceTools(
    mode: "assessment" | "capture",
    assessmentId?: string,
  ): void {
    if (
      SHOW_INTERNAL_ELIGIBILITY_TOOLS &&
      evidenceDetailsRef.current !== null
    ) {
      evidenceDetailsRef.current.open = true;
      evidenceDetailsRef.current.scrollIntoView?.({ block: "start" });
    }
    setEvidenceFocusRequest(
      assessmentId === undefined
        ? { mode, token: Date.now() }
        : { assessmentId, mode, token: Date.now() },
    );
    setEvidenceReviewOpen(true);
  }

  async function openTenderCitation(
    documentId: string,
    pageNumber: number | null,
  ): Promise<void> {
    const result = await apiRequest<{ download_url: string }>(
      `/organisations/${organisationId}/tenders/${tenderId}/documents/${documentId}/download`,
      { method: "POST" },
    );
    window.open(
      `${result.download_url}${pageNumber === null ? "" : `#page=${pageNumber}`}`,
      "_blank",
      "noopener,noreferrer",
    );
  }

  const currentVersion = workspace?.versions[0];
  const historicalFileVersions = workspace?.versions.slice(1) ?? [];
  const hasReadySource =
    currentVersion?.documents.some((document) => document.status === "READY") ??
    false;
  const extractedContentAvailable = hasCurrentExtractedContent(support);
  const assessmentSummary = deriveAssessmentLabel({
    assessmentRun: support.assessmentRun,
    currentDecision: support.currentDecision,
    hasExtractedContent: extractedContentAvailable,
    extractionRun: support.extractionRun,
    hasReadySource,
    matrix: support.matrix,
    riskRun: support.riskRun,
  });
  const requirements = useMemo(
    () => topRequirements(support.matrix),
    [support.matrix],
  );
  const eligibilityRequirements = useMemo<
    readonly EligibilityViewRequirement[]
  >(() => {
    if (support.matrix !== null)
      return topRequirements(support.matrix).map(toAssessmentRequirement);
    if (support.extractionRequirements.length === 0) return [];
    const phase =
      support.assessmentRun !== null &&
      support.assessmentRun.status !== "COMPLETE"
        ? "ASSESSING"
        : support.riskRun?.status === "FAILED"
          ? "RISK_FAILED"
          : support.riskRun === null && extractedContentAvailable
            ? "RISK_NOT_STARTED"
            : support.riskRun === null
              ? "EXTRACTING"
              : support.riskRun.status !== "COMPLETE"
                ? "RISK"
                : support.currentDecision?.decision !== "CONTINUE"
                  ? "AWAITING_DECISION"
                  : support.assessmentRun === null
                    ? "ASSESSMENT_NOT_STARTED"
                    : "ASSESSING";
    return support.extractionRequirements.map((item) =>
      toExtractedRequirement(item, phase),
    );
  }, [
    support.assessmentRun,
    support.currentDecision,
    support.extractionRequirements,
    support.matrix,
    support.riskRun,
  ]);

  useEffect(() => {
    if (eligibilityRequirements.length === 0) {
      setSelectedRequirementId("");
      return;
    }
    setSelectedRequirementId((current) =>
      current === "" ||
      !eligibilityRequirements.some((item) => item.id === current)
        ? (eligibilityRequirements[0]?.id ?? "")
        : current,
    );
  }, [eligibilityRequirements]);

  const selectedRequirement =
    eligibilityRequirements.find((item) => item.id === selectedRequirementId) ??
    eligibilityRequirements[0] ??
    null;

  const selectedRequirementPresentation =
    selectedRequirement === null
      ? null
      : requirementPresentation(selectedRequirement);
  const selectedApplicabilityQuestion =
    selectedRequirementPresentation?.applicabilityQuestion ?? null;
  const companyDocsHref = `/documents/${organisationId}?${new URLSearchParams({
    returnTo: `${pathname}?stage=eligibility`,
  }).toString()}`;
  const selectedRequirementAction =
    selectedRequirement === null || selectedRequirementPresentation === null
      ? null
      : selectedRequirementPresentation.actionLabel === "Add evidence"
        ? {
            label: "Add evidence",
            onClick: () => router.push(companyDocsHref),
          }
        : ["HUMAN_REVIEW_REQUIRED", "CONFLICT"].includes(
              selectedRequirement.stateKey,
            )
          ? {
              label: "Review evidence",
              onClick: () =>
                openEvidenceTools("assessment", selectedRequirement.id),
            }
          : selectedRequirementPresentation.actionLabel === "Review source"
            ? selectedRequirement.sourceCitation === null
              ? null
              : {
                  label: "Review source",
                  onClick: () =>
                    void openTenderCitation(
                      selectedRequirement.sourceCitation!.tenderDocumentId,
                      selectedRequirement.sourceCitation!.pageNumber,
                    ),
                }
            : selectedRequirementPresentation.actionLabel ===
                "Confirm applicability"
              ? {
                  label: "Confirm applicability",
                  onClick: () => navigateSurface("activity"),
                }
              : null;
  const eligibilityFilters: readonly {
    readonly label: string;
    readonly value: string;
  }[] = [
    { label: "All", value: "ALL" },
    { label: "Satisfied", value: "SATISFIED" },
    { label: "Need evidence", value: "NEED_EVIDENCE" },
    { label: "Need review", value: "NEED_REVIEW" },
    { label: "Blocking", value: "BLOCKING" },
  ];
  const visibleRequirements =
    eligibilityFilter === "ALL"
      ? eligibilityRequirements
      : eligibilityRequirements.filter(
          (item) =>
            requirementPresentation(item).filterKey === eligibilityFilter,
        );
  const unresolvedChecklist = support.checklistItems.filter((item) =>
    ["OPEN", "IN_PROGRESS", "BLOCKED", "READY_FOR_REASSESSMENT"].includes(
      item.status,
    ),
  );
  const requirementLinkedChecklistIds = new Set(
    unresolvedChecklist
      .filter((item) =>
        eligibilityRequirements.some((requirement) =>
          checklistItemMatchesRequirement(item, requirement),
        ),
      )
      .map((item) => item.id),
  );
  const otherChecklistItems = unresolvedChecklist.filter(
    (item) => !requirementLinkedChecklistIds.has(item.id),
  );
  const selectedRequirementChecklistItem =
    selectedRequirement === null
      ? null
      : (unresolvedChecklist.find((item) =>
          checklistItemMatchesRequirement(item, selectedRequirement),
        ) ?? null);
  const selectedRequirementNeedSummary =
    selectedRequirement?.stateKey === "HUMAN_REVIEW_REQUIRED"
      ? selectedRequirementChecklistItem?.evidenceNeedCategory ===
        "LEGAL_INTERPRETATION"
        ? "Human interpretation is required before the system can determine whether this requirement is satisfied."
        : "Human review is required before the system can determine whether this requirement is satisfied."
      : null;
  const reviewRequirementCount = requirements.filter((item) =>
    ["CONFLICT", "HUMAN_REVIEW_REQUIRED", "MISSING"].includes(
      item.currentState,
    ),
  ).length;
  const overviewAttention = [
    ...(reviewRequirementCount === 0
      ? []
      : [
          {
            action: "Review requirements",
            detail:
              reviewRequirementCount === 1
                ? "One current requirement needs evidence or a reviewer decision."
                : `${reviewRequirementCount} current requirements need evidence or reviewer decisions.`,
            key: "eligibility-review",
            stage: "eligibility" as TenderSurface,
            title:
              reviewRequirementCount === 1
                ? "1 requirement needs review"
                : `${reviewRequirementCount} requirements need review`,
            tone: "warning" as const,
          },
        ]),
    ...(otherChecklistItems.length === 0
      ? []
      : [
          {
            action: "Open requirements",
            detail:
              otherChecklistItems.length === 1
                ? "One current action is not tied to a single requirement."
                : `${otherChecklistItems.length} current actions are not tied to a single requirement.`,
            key: "other-actions",
            stage: "eligibility" as TenderSurface,
            title:
              otherChecklistItems.length === 1
                ? "1 other action needs attention"
                : `${otherChecklistItems.length} other actions need attention`,
            tone: "info" as const,
          },
        ]),
  ];
  const keyFields = extractKeyFields(support.extractionFields);
  const currentReadyDocument =
    currentVersion?.documents.find(
      (document) => document.status === "READY" && document.role === "PRIMARY",
    ) ??
    currentVersion?.documents.find((document) => document.status === "READY") ??
    null;
  const keyTenderDetails = buildKeyTenderDetails(
    keyFields,
    workspace?.submissionDeadline,
    currentReadyDocument?.displayFilename,
  );
  const topRisks = [...support.riskFindings]
    .sort((left, right) => {
      const order = new Map([
        ["CRITICAL", 0],
        ["HIGH", 1],
        ["MEDIUM", 2],
        ["LOW", 3],
        ["INFORMATIONAL", 4],
      ]);
      return (
        (order.get(left.severity) ?? 99) - (order.get(right.severity) ?? 99)
      );
    })
    .slice(0, 4);
  const nextAction = (() => {
    if ((currentVersion?.documents.length ?? 0) === 0)
      return {
        cta: "Upload tender files",
        description: "Add the primary tender file before review can continue.",
        surface: "files" as TenderSurface,
      };
    if (!extractedContentAvailable)
      return {
        cta: "View source processing",
        description:
          "The platform is still extracting the current tender source and will keep progressing automatically.",
        surface: "overview" as TenderSurface,
      };
    if (support.riskRun?.status === "FAILED")
      return {
        cta: "Retry risk analysis",
        description:
          support.riskRun.safeFailureMessage ??
          "Early risk analysis failed safely. Retry before requirements check continues.",
        surface: "overview" as TenderSurface,
      };
    if (support.riskRun?.status !== "COMPLETE")
      return {
        cta: "View extracted requirements",
        description:
          support.riskRun === null
            ? "Extraction is complete. Review the extracted requirements while early risk analysis waits to start."
            : "Extraction is complete and early risk analysis is still running for the current tender version.",
        surface: "eligibility" as TenderSurface,
      };
    if (support.currentDecision?.decision !== "CONTINUE")
      return {
        cta: "Record pursue decision",
        description:
          "Extraction and risk review are ready. Eligibility review starts after a human Continue decision.",
        surface: "overview" as TenderSurface,
      };
    if (support.assessmentRun === null)
      return {
        cta: "View extracted requirements",
        description:
          "Tender requirements are ready. Eligibility review has not started for the latest Continue decision.",
        surface: "eligibility" as TenderSurface,
      };
    if (
      requirements.some((item) =>
        ["CONFLICT", "HUMAN_REVIEW_REQUIRED", "MISSING"].includes(
          item.currentState,
        ),
      )
    )
      return {
        cta: "Review requirements",
        description:
          "Resolve the highest-priority evidence and assessment items first.",
        surface: "eligibility" as TenderSurface,
      };
    if (support.drafts.length === 0)
      return {
        cta: "Start the draft",
        description:
          "Move into drafting once current evidence and assessment state look stable.",
        surface: "draft" as TenderSurface,
      };
    return {
      cta: "Open review package",
      description:
        "Final human review and controlled package actions live in the last step.",
      surface: "review" as TenderSurface,
    };
  })();
  const eligibilityStatusMessage =
    support.matrix === null && eligibilityRequirements.length > 0
      ? support.assessmentRun !== null
        ? "Tender requirements are available and the evidence comparison is still running."
        : support.riskRun?.status === "FAILED"
          ? "Risk review needs attention before requirements check can start. You can still inspect the extracted tender requirements below."
          : support.riskRun?.status !== "COMPLETE"
            ? "The tender requirements below are still being prepared while extraction and risk review finish."
            : support.currentDecision?.decision === "CONTINUE"
              ? "Eligibility review will start automatically for the latest Continue decision. You can inspect the tender requirements while it begins."
              : "Eligibility review starts after you choose Continue. You can inspect tender requirements before deciding."
      : null;
  const activityItems = buildActivityItems(workspace, support);
  const activityCategories = [
    ...new Set(activityItems.map((item) => item.category)),
  ].sort();
  const filteredActivityItems = activityItems.filter(
    (item) => activityFilter === "ALL" || item.category === activityFilter,
  );
  const visibleActivityItems = showAllActivity
    ? filteredActivityItems
    : filteredActivityItems.slice(0, 7);
  const currentReadinessRun =
    support.finalReadinessRuns.find((item) => item.is_current) ??
    support.finalReadinessRuns[0] ??
    null;
  const hasCurrentChecklist = support.checklistRun !== null;
  const visibleVersionDocuments =
    currentVersion?.documents.filter((document) =>
      filesFilter === "ALL" ? true : document.role === "CORRIGENDUM",
    ) ?? [];
  const visibleVersionDocumentBytes = visibleVersionDocuments.reduce(
    (total, document) => total + (Number(document.sizeBytes) || 0),
    0,
  );
  const corrigendumDocumentCount =
    currentVersion?.documents.filter(
      (document) => document.role === "CORRIGENDUM",
    ).length ?? 0;
  const workflowSummary = workspace?.workflowState ?? {
    actionLabel: "Open",
    code: "ANALYSIS_READY" as const,
    detail: assessmentSummary.detail,
    isCompleted: false,
    isDraft: false,
    isInProgress: false,
    needsAttention: false,
    onHold: false,
    statusLabel: assessmentSummary.label,
    tone: assessmentSummary.tone,
  };
  const askHref = `/tenders/${organisationId}/${tenderId}?stage=ask&conversation=new`;

  if (workspace === null) {
    return (
      <div className="workspace-page">
        <header className="workspace-page__header">
          <div>
            <h1>Tender workspace</h1>
            <p>{message}</p>
          </div>
        </header>
      </div>
    );
  }

  return (
    <div className="workspace-page tender-detail-page">
      {["overview", "ask", "review"].includes(activeSurface) ? (
        <header className="tender-header">
          <div className="tender-header__row">
            <Link
              className="tender-header__back"
              href={`/tenders/${organisationId}`}
            >
              ← Back to Tenders
            </Link>
          </div>
          <div className="tender-header__identity">
            <div>
              <h1>{workspace.title}</h1>
              <p className="tender-header__buyer">{workspace.buyer}</p>
            </div>
            <div className="tender-header__badges">
              <span
                className={`status-badge status-badge--${workflowSummary.tone}`}
              >
                {workflowSummary.statusLabel}
              </span>
            </div>
            <span className="tender-header__deadline">
              {workspace.submissionDeadline === undefined
                ? "Deadline unavailable"
                : `Deadline: ${formatDeadline(workspace.submissionDeadline)} · ${formatDeadlineCountdown(workspace.submissionDeadline)}`}
            </span>
          </div>
          {workspace.demonstration_label !== undefined ? (
            <Alert tone="warning">
              <p>{workspace.demonstration_label}</p>
            </Alert>
          ) : null}
          {workspace.deadlineResolution?.hasMismatch ? (
            <div className="tender-deadline-notice" role="status">
              <strong>Deadline updated from tender source</strong>
              <span>
                The current tender file provides the deadline shown above.
              </span>
            </div>
          ) : null}
          {resolution.legacyStage !== null &&
          ![
            "overview",
            "eligibility",
            "draft",
            "ask",
            "files",
            "activity",
            "review",
          ].includes(resolution.legacyStage) ? (
            <div className="tender-compat-note">
              This saved link used the legacy{" "}
              <strong>{humanizeEnum(resolution.legacyStage)}</strong> stage. It
              now opens <strong>{surfaceLabels[activeSurface]}</strong> while
              keeping the underlying workflow compatible.
            </div>
          ) : null}
          <div className="tender-header__tabbar">
            <nav aria-label="Tender workspace primary" className="tender-nav">
              {primarySurfaces.map((surface) => (
                <SurfaceLink
                  activeSurface={
                    activeSurface === "review" ? "draft" : activeSurface
                  }
                  key={surface}
                  label={surfaceLabels[surface]}
                  onSelect={navigateSurface}
                  surface={surface}
                />
              ))}
            </nav>
            <nav
              aria-label="Tender workspace utilities"
              className="tender-subnav"
            >
              {secondarySurfaces.map((surface) => (
                <SurfaceLink
                  activeSurface={activeSurface}
                  key={surface}
                  label={surfaceLabels[surface]}
                  onSelect={navigateSurface}
                  surface={surface}
                />
              ))}
            </nav>
          </div>
        </header>
      ) : null}
      {supportError !== "" ? (
        <Alert tone="warning">
          <p role="status">{supportError}</p>
        </Alert>
      ) : null}

      {activeSurface === "overview" ? (
        <div className="tender-surface">
          <h2 className="visually-hidden">What matters now</h2>
          <div className="tender-overview-top">
            <Card className="overview-assessment-card">
              <div className="overview-card-heading">
                <h2>Assessment summary</h2>
              </div>
              <div className="overview-assessment-status">
                <span
                  className={`status-badge status-badge--${workflowSummary.tone}`}
                >
                  {workflowSummary.statusLabel}
                </span>
                <p>{workflowSummary.detail}</p>
              </div>
              {support.matrix === null ? (
                <div className="tender-assessment-pending">
                  <strong>
                    {support.assessmentRun === null
                      ? "Eligibility review not ready yet"
                      : "Assessment in progress"}
                  </strong>
                  <span>
                    Counts appear when current tender evidence is compared.
                  </span>
                </div>
              ) : (
                <div className="overview-metric-row">
                  {[
                    [
                      "Satisfied",
                      (support.matrix.counts.find(
                        (item) => item.currentState === "VERIFIED",
                      )?._count ?? 0) +
                        (support.matrix.counts.find(
                          (item) => item.currentState === "LIKELY_MET",
                        )?._count ?? 0),
                      "success",
                    ],
                    [
                      "Need evidence",
                      support.matrix.counts.find(
                        (item) => item.currentState === "MISSING",
                      )?._count ?? 0,
                      "warning",
                    ],
                    [
                      "Need review",
                      support.matrix.counts.find(
                        (item) => item.currentState === "HUMAN_REVIEW_REQUIRED",
                      )?._count ?? 0,
                      "warning",
                    ],
                    [
                      "Blocking",
                      support.matrix.counts.find(
                        (item) => item.currentState === "CONFLICT",
                      )?._count ?? 0,
                      "danger",
                    ],
                  ].map(([label, count, tone]) => (
                    <div
                      className={`overview-metric overview-metric--${tone}`}
                      key={label as string}
                    >
                      <strong>{count}</strong>
                      <span>{label}</span>
                    </div>
                  ))}
                </div>
              )}
              {support.riskRun?.status === "COMPLETE" ? (
                <div className="overview-decision" aria-label="Bid decision">
                  <div>
                    <p>
                      <span>Current decision:</span>{" "}
                      <strong>
                        {support.currentDecision === null
                          ? "No decision recorded"
                          : humanizeEnum(support.currentDecision.decision)}
                      </strong>
                    </p>
                    {support.currentDecision?.rationale.trim() ? (
                      <p>
                        <strong>Decision rationale:</strong>{" "}
                        {support.currentDecision.rationale}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    onClick={() => setDecisionEditorOpen(true)}
                    type="button"
                    variant="quiet"
                  >
                    {support.currentDecision === null
                      ? "Record decision"
                      : "Change decision"}
                  </Button>
                </div>
              ) : null}
            </Card>

            <Card className="overview-attention-card">
              <div className="overview-card-heading">
                <h2 className="visually-hidden">Top blockers and follow-ups</h2>
                <h2>
                  What needs your attention
                  {overviewAttention.length > 0
                    ? ` (${overviewAttention.length})`
                    : ""}
                </h2>
                <Button
                  onClick={() => navigateSurface("eligibility")}
                  variant="quiet"
                >
                  View all
                </Button>
              </div>
              {overviewAttention.length === 0 ? (
                <div className="workspace-empty-row">
                  <p>No urgent unresolved items are currently surfaced.</p>
                </div>
              ) : (
                <ul className="attention-list">
                  {overviewAttention.slice(0, 3).map((item) => (
                    <li className="attention-row" key={item.key}>
                      <span
                        aria-hidden="true"
                        className={`status-dot status-dot--${item.tone}`}
                      />
                      <div className="attention-row__main">
                        <strong>{item.title}</strong>
                        <p>{item.detail}</p>
                      </div>
                      <Button
                        onClick={() => navigateSurface(item.stage)}
                        variant="secondary"
                      >
                        {item.action}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {decisionEditorOpen ? (
            <Modal
              label="Bid decision"
              onClose={() => setDecisionEditorOpen(false)}
            >
              <form
                onSubmit={(event) => void recordPursuitDecision(event)}
                className="bid-decision__form"
              >
                <Field htmlFor="pursuit-decision" label="Decision" required>
                  <Select
                    defaultValue={support.currentDecision?.decision ?? ""}
                    id="pursuit-decision"
                    name="decision"
                    required
                  >
                    <option disabled value="">
                      Select a decision
                    </option>
                    <option value="CONTINUE">Continue</option>
                    <option value="HOLD">Hold</option>
                    <option value="STOP">Stop</option>
                  </Select>
                </Field>
                <Field htmlFor="pursuit-rationale" label="Rationale" required>
                  <Textarea
                    defaultValue={support.currentDecision?.rationale ?? ""}
                    id="pursuit-rationale"
                    minLength={20}
                    name="rationale"
                    required
                  />
                </Field>
                <label className="bid-decision__acknowledgement">
                  <input name="acknowledged" required type="checkbox" />
                  <span>
                    I understand the unresolved findings and source limits still
                    need human judgment.
                  </span>
                </label>
                <div className="inline-actions">
                  <Button disabled={decisionSubmitting} type="submit">
                    {decisionSubmitting
                      ? "Saving decision..."
                      : "Save decision"}
                  </Button>
                  <Button
                    disabled={decisionSubmitting}
                    onClick={() => setDecisionEditorOpen(false)}
                    type="button"
                    variant="secondary"
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </Modal>
          ) : null}
          {decisionFeedback !== "" ? (
            <Alert tone="info">
              <p>{decisionFeedback}</p>
            </Alert>
          ) : null}

          <section className="workspace-section">
            <div className="workspace-section__header">
              <div>
                <h2>Key tender details</h2>
              </div>
            </div>
            <div className="workspace-card detail-grid-card key-detail-strip">
              {keyTenderDetails.length === 0 ? (
                <div className="tender-stat-row">
                  <div className="tender-stat">
                    <strong>
                      {currentReadyDocument?.displayFilename ??
                        "No ready source"}
                    </strong>
                    <span>Current tender file</span>
                  </div>
                  <div className="tender-stat">
                    <strong>{support.extractionRequirements.length}</strong>
                    <span>Extracted requirements</span>
                  </div>
                  <div className="tender-stat">
                    <strong>
                      {support.extractionRun === null
                        ? extractedContentAvailable
                          ? "Complete"
                          : "Queued automatically"
                        : humanizeEnum(support.extractionRun.status)}
                    </strong>
                    <span>Extraction</span>
                  </div>
                  <div className="tender-stat">
                    <strong>
                      {support.riskRun === null
                        ? extractedContentAvailable
                          ? "Not started"
                          : "Waiting on extraction"
                        : humanizeEnum(support.riskRun.status)}
                    </strong>
                    <span>Risk review</span>
                  </div>
                </div>
              ) : (
                <>
                  <div className="tender-stat-row">
                    {keyTenderDetails.map((field) => (
                      <div className="tender-stat" key={field.id}>
                        <strong>{field.normalizedTextValue ?? "—"}</strong>
                        <span>{field.label}</span>
                      </div>
                    ))}
                  </div>
                  <div className="tender-stat-row">
                    <div className="tender-stat">
                      <strong>{support.extractionRequirements.length}</strong>
                      <span>Extracted requirements</span>
                    </div>
                    <div className="tender-stat">
                      <strong>
                        {support.extractionRun === null
                          ? extractedContentAvailable
                            ? "Complete"
                            : "Queued automatically"
                          : humanizeEnum(support.extractionRun.status)}
                      </strong>
                      <span>Extraction</span>
                    </div>
                    <div className="tender-stat">
                      <strong>
                        {support.riskRun === null
                          ? extractedContentAvailable
                            ? "Not started"
                            : "Waiting on extraction"
                          : humanizeEnum(support.riskRun.status)}
                      </strong>
                      <span>Risk review</span>
                    </div>
                  </div>
                </>
              )}
            </div>
          </section>

          <section className="workspace-section">
            <div className="workspace-section__header">
              <div>
                <h2>Important things to consider</h2>
                <p>
                  Current cited risk and contract findings stay distinct from
                  requirements decisions.
                </p>
              </div>
            </div>
            <div className="overview-bottom-grid">
              <Card className="overview-risks-card">
                {support.riskRun?.status === "FAILED" ? (
                  <div className="workspace-empty-row">
                    <p>
                      {support.riskRun.safeFailureMessage ??
                        "Risk review could not finish. Try again when ready."}
                    </p>
                    <Button
                      disabled={riskRetrying}
                      onClick={() => void retryRiskAnalysis()}
                      variant="secondary"
                    >
                      {riskRetrying ? "Retrying..." : "Retry risk review"}
                    </Button>
                  </div>
                ) : topRisks.length === 0 ? (
                  <div className="workspace-empty-row">
                    <p>No current cited risk findings are available.</p>
                  </div>
                ) : (
                  topRisks.slice(0, 3).map((finding) => (
                    <button
                      className="overview-risk-item"
                      key={finding.id}
                      onClick={() => navigateSurface("eligibility")}
                      type="button"
                    >
                      <span
                        aria-hidden="true"
                        className={`status-dot status-dot--${statusTone(finding.severity)}`}
                      />
                      <span>
                        <strong>{finding.title}</strong>
                        <small>{finding.explanation}</small>
                      </span>
                    </button>
                  ))
                )}
              </Card>
              <Card className="overview-next-action-card">
                <h3>Next best action</h3>
                <p>{nextAction.description}</p>
                {nextAction.cta === "Retry risk analysis" ? (
                  <Button
                    disabled={riskRetrying}
                    onClick={() => void retryRiskAnalysis()}
                  >
                    {riskRetrying ? "Retrying..." : nextAction.cta}
                  </Button>
                ) : (
                  <Button
                    onClick={() => {
                      if (nextAction.cta === "Record pursue decision") {
                        setDecisionEditorOpen(true);
                        return;
                      }
                      navigateSurface(nextAction.surface);
                    }}
                  >
                    {nextAction.cta}
                  </Button>
                )}
              </Card>
            </div>
          </section>
        </div>
      ) : null}

      {activeSurface === "eligibility" ? (
        <div className="tender-surface eligibility-page">
          <header className="eligibility-page__header">
            <button
              className="tender-header__back"
              onClick={() => navigateSurface("overview")}
              type="button"
            >
              ← Back to Overview
            </button>
            <div>
              <h1>Eligibility review</h1>
              <span
                className={`status-badge status-badge--${assessmentSummary.tone}`}
              >
                {assessmentSummary.label}
              </span>
            </div>
          </header>
          <section className="workspace-section eligibility-workspace">
            <div className="eligibility-toolbar">
              <div
                aria-label="Eligibility filters"
                className="workspace-chip-row workspace-chip-row--left"
                role="tablist"
              >
                {eligibilityFilters.map((filter) => (
                  <button
                    aria-pressed={eligibilityFilter === filter.value}
                    className={`workspace-chip ${eligibilityFilter === filter.value ? "workspace-chip--active" : ""}`}
                    key={filter.value}
                    onClick={() => setEligibilityFilter(filter.value)}
                    type="button"
                  >
                    {filter.label} (
                    {filter.value === "ALL"
                      ? eligibilityRequirements.length
                      : eligibilityRequirements.filter(
                          (item) =>
                            requirementPresentation(item).filterKey ===
                            filter.value,
                        ).length}
                    )
                  </button>
                ))}
              </div>
              <Button
                aria-controls="eligibility-filter-panel"
                aria-expanded={eligibilityFiltersOpen}
                onClick={() => setEligibilityFiltersOpen((current) => !current)}
                type="button"
                variant="secondary"
              >
                Filters
              </Button>
            </div>
            {eligibilityFiltersOpen ? (
              <div
                className="workspace-card eligibility-filter-panel"
                id="eligibility-filter-panel"
              >
                <Field label="Requirement status">
                  <Select
                    aria-label="Filter eligibility requirements"
                    onChange={(event) =>
                      setEligibilityFilter(event.target.value)
                    }
                    value={eligibilityFilter}
                  >
                    {eligibilityFilters.map((filter) => (
                      <option key={filter.value} value={filter.value}>
                        {filter.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            ) : null}
            {eligibilityStatusMessage === null ? null : (
              <div className="eligibility-status-notice">
                <Alert
                  tone={support.assessmentRun === null ? "warning" : "info"}
                >
                  <p>{eligibilityStatusMessage}</p>
                </Alert>
              </div>
            )}
            <div className="tender-eligibility-layout">
              <div className="workspace-card requirement-list">
                <div className="requirement-list__header">
                  <h2>Requirements</h2>
                  <span>Sort: Priority</span>
                </div>
                {visibleRequirements.length === 0 ? (
                  <div className="workspace-empty-row">
                    <p>
                      {eligibilityRequirements.length === 0
                        ? "Eligibility requirements are not available yet."
                        : "No requirements match this filter."}
                    </p>
                  </div>
                ) : (
                  visibleRequirements.map((item) => {
                    const presentation = requirementPresentation(item);
                    return (
                      <button
                        className={`requirement-list__item ${selectedRequirement?.id === item.id ? "requirement-list__item--active" : ""}`}
                        key={item.id}
                        onClick={() => setSelectedRequirementId(item.id)}
                        type="button"
                      >
                        <div>
                          <strong>{presentation.displayTitle}</strong>
                          <small>{presentation.kindLabel ?? "Required"}</small>
                        </div>
                        <span
                          className={`status-badge status-badge--${presentation.statusTone}`}
                        >
                          {presentation.statusLabel}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
              <div className="workspace-card requirement-detail">
                {selectedRequirement === null ? (
                  <div className="workspace-empty-row">
                    <p>
                      Select a requirement to inspect its current evidence and
                      assessment context.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="requirement-detail__header">
                      <div>
                        <h3>
                          {selectedRequirement.categoryLabel ===
                          "Other requirement"
                            ? selectedRequirement.statement
                            : (selectedRequirementPresentation?.displayTitle ??
                              selectedRequirement.title)}
                        </h3>
                        <p>{selectedRequirement.categoryLabel}</p>
                      </div>
                      <span
                        className={`status-badge status-badge--${selectedRequirementPresentation?.statusTone ?? selectedRequirement.statusTone}`}
                      >
                        {selectedRequirementPresentation?.statusLabel ??
                          selectedRequirement.statusLabel}
                      </span>
                    </div>
                    <section className="requirement-detail__requirement">
                      <h4>Requirement</h4>
                      <p>
                        {selectedRequirement.statement.trim() === ""
                          ? (selectedRequirementPresentation?.whatThisMeans ??
                            requirementDisplaySummary(selectedRequirement))
                          : selectedRequirement.statement}
                      </p>
                      {selectedRequirementNeedSummary === null ? null : (
                        <p>{selectedRequirementNeedSummary}</p>
                      )}
                      {selectedApplicabilityQuestion === null ? null : (
                        <div className="requirement-applicability">
                          <h4>Confirm applicability</h4>
                          <p>{selectedApplicabilityQuestion}</p>
                        </div>
                      )}
                    </section>
                    <section className="requirement-source-section">
                      <h4>Source in tender</h4>
                      {selectedRequirement.sourceCitation === null ? (
                        <p>
                          A current tender citation is not available for this
                          extracted requirement. Review the source before making
                          a decision.
                        </p>
                      ) : (
                        <>
                          <p className="requirement-source-meta">
                            {selectedRequirement.sourceCitation.pageNumber ===
                            null
                              ? "Page unavailable"
                              : `Page ${selectedRequirement.sourceCitation.pageNumber}`}
                            {selectedRequirement.sourceCitation.clauseLabel
                              ? ` · Clause ${selectedRequirement.sourceCitation.clauseLabel}`
                              : ""}
                          </p>
                          <blockquote className="visually-hidden">
                            {compactSourceExcerpt(
                              selectedRequirement.sourceCitation.boundedExcerpt,
                            )}
                          </blockquote>
                          <Button
                            onClick={() =>
                              selectedRequirement.sourceCitation === null
                                ? undefined
                                : void openTenderCitation(
                                    selectedRequirement.sourceCitation
                                      .tenderDocumentId,
                                    selectedRequirement.sourceCitation
                                      .pageNumber,
                                  )
                            }
                            variant="secondary"
                          >
                            View in document
                          </Button>
                        </>
                      )}
                    </section>
                    <section className="requirement-evidence-section">
                      <h4>Your evidence</h4>
                      {selectedRequirement.evidenceLinks.length === 0 ? (
                        <div className="requirement-evidence-empty">
                          <span aria-hidden="true">□</span>
                          <strong>
                            {selectedRequirementPresentation?.filterKey ===
                            "SATISFIED"
                              ? "No linked evidence returned"
                              : "No supporting document found"}
                          </strong>
                          <p>
                            {selectedRequirementPresentation?.filterKey ===
                            "SATISFIED"
                              ? "This assessment is marked satisfied, but no direct supporting document is linked. Review company documents before final approval."
                              : (selectedRequirementPresentation?.evidenceNeeded ??
                                selectedRequirementPresentation?.evidenceEmptyLabel ??
                                "Upload current supporting evidence for this requirement.")}
                          </p>
                          <Link
                            className={`button ${selectedRequirementPresentation?.filterKey === "SATISFIED" ? "button--secondary" : "button--primary"}`}
                            href={companyDocsHref}
                          >
                            {selectedRequirementPresentation?.filterKey ===
                            "SATISFIED"
                              ? "Review documents"
                              : "Upload document"}
                          </Link>
                        </div>
                      ) : (
                        <div className="requirement-evidence-list">
                          {selectedRequirement.evidenceLinks.map(
                            (link, index) => (
                              <div
                                className="evidence-link"
                                key={`${selectedRequirement.id}-${index}`}
                              >
                                <strong>{link.supportingText}</strong>
                                <p>{link.excerpt}</p>
                                <small>{link.label}</small>
                              </div>
                            ),
                          )}
                          <Link
                            className="button button--secondary"
                            href={companyDocsHref}
                          >
                            Manage company documents
                          </Link>
                        </div>
                      )}
                    </section>
                    <div className="assessment-block">
                      <span className="eyebrow">Assessment</span>
                      <h4>
                        {selectedRequirementPresentation?.statusLabel ??
                          selectedRequirement.statusLabel}
                      </h4>
                      <p>
                        Why: {customerAssessmentReason(selectedRequirement)}{" "}
                        What to do: {selectedRequirement.whatToDo}
                      </p>
                    </div>
                    {selectedRequirementAction !== null ? (
                      <div className="requirement-primary-action">
                        <Button
                          onClick={selectedRequirementAction.onClick}
                          type="button"
                          variant="secondary"
                        >
                          {selectedRequirementAction.label}
                        </Button>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          </section>

          {SHOW_INTERNAL_ELIGIBILITY_TOOLS ? (
            <>
              {hasCurrentChecklist ? (
                <section className="workspace-section">
                  <div className="workspace-section__header">
                    <div>
                      <h3>Missing items</h3>
                      <p>Current actions that still need attention.</p>
                    </div>
                  </div>
                  <div className="workspace-card tender-tools-panel">
                    <div className="tender-stat-row">
                      <div className="tender-stat">
                        <strong>{unresolvedChecklist.length}</strong>
                        <span>
                          action{unresolvedChecklist.length === 1 ? "" : "s"}{" "}
                          need attention
                        </span>
                      </div>
                      {otherChecklistItems.length > 0 ? (
                        <div className="tender-stat">
                          <strong>{otherChecklistItems.length}</strong>
                          <span>Other actions</span>
                        </div>
                      ) : null}
                    </div>
                    {otherChecklistItems.length > 0 &&
                    currentVersionId !== "" ? (
                      <ActionChecklist
                        currentAssessmentRunId={
                          support.assessmentRun?.id ?? null
                        }
                        organisationId={organisationId}
                        tenderId={tenderId}
                        versionId={currentVersionId}
                        visibleItemIds={otherChecklistItems.map(
                          (item) => item.id,
                        )}
                      />
                    ) : null}
                  </div>
                </section>
              ) : currentVersionId !== "" ? (
                <section className="workspace-section eligibility-action-tools">
                  <div className="workspace-section__header">
                    <div>
                      <h3>Missing items</h3>
                      <p>
                        Create the action list from the current eligibility
                        review.
                      </p>
                    </div>
                  </div>
                  <div className="workspace-card tender-tools-panel">
                    <ActionChecklist
                      currentAssessmentRunId={support.assessmentRun?.id ?? null}
                      organisationId={organisationId}
                      tenderId={tenderId}
                      versionId={currentVersionId}
                    />
                  </div>
                </section>
              ) : null}

              <section className="workspace-section eligibility-evidence-tools">
                <details className="disclosure" ref={evidenceDetailsRef}>
                  <summary>
                    Audit &amp; evidence
                    <small>
                      Historical reviews, evidence tools, and currentness
                      details
                    </small>
                  </summary>
                  <div className="disclosure__body tender-tools-panel">
                    {currentVersionId !== "" ? (
                      <>
                        <ActionChecklist
                          currentAssessmentRunId={
                            support.assessmentRun?.id ?? null
                          }
                          organisationId={organisationId}
                          presentation="history"
                          tenderId={tenderId}
                          versionId={currentVersionId}
                        />
                        <EvidenceMatrix
                          currentAssessmentRunId={
                            support.assessmentRun?.id ?? null
                          }
                          focusRequest={evidenceFocusRequest}
                          organisationId={organisationId}
                          tenderId={tenderId}
                          versionId={currentVersionId}
                        />
                      </>
                    ) : (
                      <div className="workspace-empty-row">
                        <p>
                          The current tender version is unavailable for evidence
                          review.
                        </p>
                      </div>
                    )}
                  </div>
                </details>
              </section>
            </>
          ) : null}

          {evidenceReviewOpen && currentVersionId !== "" ? (
            <Modal
              label="Review evidence"
              onClose={() => setEvidenceReviewOpen(false)}
            >
              <EvidenceMatrix
                currentAssessmentRunId={support.assessmentRun?.id ?? null}
                focusRequest={evidenceFocusRequest}
                organisationId={organisationId}
                presentation="focused"
                tenderId={tenderId}
                versionId={currentVersionId}
              />
            </Modal>
          ) : null}
        </div>
      ) : null}

      {activeSurface === "draft" ? (
        <div className="tender-surface">
          <DraftWorkspace
            onNavigateStage={(stage) => navigateSurface(stage)}
            onOpenReview={() => navigateSurface("review")}
            organisationId={organisationId}
            tenderId={tenderId}
            versionId={currentVersionId === "" ? null : currentVersionId}
          />
        </div>
      ) : null}

      {activeSurface === "ask" ? (
        <div className="tender-surface">
          <section className="workspace-section">
            <div className="workspace-section__header">
              <div>
                <h2>AI Chat</h2>
                <p>
                  Grounded tender Q&amp;A stays tender-scoped and preserves the
                  approved tender sources.
                </p>
              </div>
            </div>
            <div className="tender-embedded-section">
              {currentVersionId !== "" ? (
                <RagChatbot
                  key={tenderId}
                  onConversationChange={(id) => {
                    const next = new URLSearchParams(searchParams.toString());
                    next.set("conversation", id);
                    router.replace(`${pathname}?${next.toString()}`, {
                      scroll: false,
                    });
                  }}
                  {...(searchParams.get("conversation") === null
                    ? {}
                    : {
                        initialConversationId:
                          searchParams.get("conversation")!,
                      })}
                  organisationId={organisationId}
                  tenderId={tenderId}
                  tenderTitle={workspace?.title}
                  streamlined
                  versionId={currentVersionId}
                />
              ) : (
                <div className="workspace-empty-row">
                  <p>
                    The current tender version is unavailable for tender-scoped
                    chat.
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {activeSurface === "files" ? (
        <div className="tender-surface standalone-surface tender-files-page">
          <header className="standalone-surface__header">
            <div>
              <button
                className="tender-header__back"
                onClick={() => navigateSurface("overview")}
                type="button"
              >
                ← Back to Overview
              </button>
              <h1 aria-label="Tender Files">Tender files</h1>
              <p>
                {visibleVersionDocuments.length} file
                {visibleVersionDocuments.length === 1 ? "" : "s"}
                {visibleVersionDocuments.length === 0
                  ? ""
                  : ` · ${formatFileSize(String(visibleVersionDocumentBytes))}`}
              </p>
            </div>
            <Button onClick={() => setShowFileUpload(true)}>
              Upload files
            </Button>
          </header>
          <section className="workspace-section">
            <div
              className="workspace-chip-row workspace-chip-row--left"
              role="tablist"
              aria-label="File filters"
            >
              <button
                aria-pressed={filesFilter === "ALL"}
                className={`workspace-chip ${filesFilter === "ALL" ? "workspace-chip--active" : ""}`}
                onClick={() => setFilesFilter("ALL")}
                type="button"
              >
                All files
                {currentVersion === undefined
                  ? ""
                  : ` (${currentVersion.documents.length})`}
              </button>
              <button
                aria-pressed={filesFilter === "CORRIGENDA"}
                className={`workspace-chip ${filesFilter === "CORRIGENDA" ? "workspace-chip--active" : ""}`}
                onClick={() => setFilesFilter("CORRIGENDA")}
                type="button"
              >
                Corrigenda
                {` (${corrigendumDocumentCount})`}
              </button>
            </div>
            {!showFileUpload && message !== "" ? (
              <p aria-live="polite" className="tender-files-status">
                {message}
              </p>
            ) : null}
            <div className="workspace-card">
              <div className="workspace-table-scroll">
                <table className="workspace-table">
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">Type</th>
                      <th scope="col">Uploaded on</th>
                      <th scope="col">Uploaded by</th>
                      <th scope="col">Size</th>
                      <th scope="col">
                        <span className="visually-hidden">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleVersionDocuments.length === 0 ? (
                      <tr>
                        <td className="workspace-table__empty" colSpan={6}>
                          {filesFilter === "CORRIGENDA"
                            ? "No corrigenda have been uploaded to this version yet."
                            : "No tender files have been uploaded to this version yet."}
                        </td>
                      </tr>
                    ) : (
                      visibleVersionDocuments.map((document) => (
                        <tr key={document.id}>
                          <td>
                            <div className="tender-file-name">
                              <span
                                aria-hidden="true"
                                className={`tender-file-name__icon tender-file-name__icon--${document.role.toLowerCase()}`}
                              />
                              <div>
                                <strong>{document.displayFilename}</strong>
                                {document.status === "READY" ? null : (
                                  <small>
                                    {documentStatusLabel(document)}
                                    {isExpiredUpload(document)
                                      ? " · Upload session expired"
                                      : ""}
                                  </small>
                                )}
                              </div>
                            </div>
                          </td>
                          <td>{fileType(document.displayFilename)}</td>
                          <td>{formatShortDate(document.createdAt)}</td>
                          <td className="workspace-table__muted">—</td>
                          <td>{formatFileSize(document.sizeBytes)}</td>
                          <td className="workspace-table__action">
                            <details className="row-action-menu">
                              <summary
                                aria-label={`Actions for ${document.displayFilename}`}
                              >
                                <MoreHorizontal aria-hidden="true" size={18} />
                              </summary>
                              <div>
                                {document.status === "READY" ? (
                                  <Button
                                    aria-label={`Download ${document.displayFilename}`}
                                    onClick={() => void download(document.id)}
                                    type="button"
                                    variant="quiet"
                                  >
                                    <Download aria-hidden="true" size={15} />
                                    Download
                                  </Button>
                                ) : null}
                                {isRemovableFailedUpload(document) ||
                                isRemovableReadySource(document, {
                                  documentCount:
                                    currentVersion?.documents.length ?? 0,
                                  isCurrentVersion: true,
                                }) ? (
                                  <Button
                                    aria-label={`${document.status === "READY" ? "Remove tender file" : "Remove failed upload"} ${document.displayFilename}`}
                                    onClick={() =>
                                      setPendingFileRemoval({
                                        confirmLabel: "Remove file",
                                        description:
                                          document.status === "READY"
                                            ? "Removing a processed source may invalidate analysis, eligibility, draft, AI index, and review results derived from it."
                                            : "Remove this failed upload? You can upload the file again afterwards.",
                                        documentId: document.id,
                                        successMessage:
                                          document.status === "READY"
                                            ? "Tender file removed. You can upload the same file again."
                                            : "Failed upload removed. The same file can now be uploaded again.",
                                        title:
                                          document.status === "READY"
                                            ? "Remove this tender file?"
                                            : "Remove failed upload",
                                      })
                                    }
                                    type="button"
                                    variant="quiet"
                                  >
                                    <Trash2 aria-hidden="true" size={15} />
                                    Remove
                                  </Button>
                                ) : null}
                              </div>
                            </details>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            {historicalFileVersions.length > 0 ? (
              <details className="disclosure tender-file-history">
                <summary>
                  Previous source history
                  <small>
                    {historicalFileVersions.length} older version
                    {historicalFileVersions.length === 1 ? "" : "s"}
                  </small>
                </summary>
                <div className="disclosure__body">
                  <div className="workspace-card">
                    {historicalFileVersions.map((version) => (
                      <div className="workspace-empty-row" key={version.id}>
                        <strong>Version {version.versionNumber}</strong>
                        <p>{version.reason}</p>
                        <p>
                          {version.documents.length} file
                          {version.documents.length === 1 ? "" : "s"}
                          {" · "}
                          {version.documents
                            .map((document) => document.displayFilename)
                            .join(", ")}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </details>
            ) : null}
            <div className="tender-compat-note">
              <p>
                Files added here are tender-scoped. Company certificates and
                reusable business evidence live in{" "}
                <Link href={`/documents/${organisationId}`}>
                  Company documents
                </Link>
                .
              </p>
              <small>Accepted: PDF, ZIP, XLSX, DOCX, and CSV.</small>
            </div>
          </section>

          {showFileUpload ? (
            <Modal
              label="Upload tender files"
              onClose={() => setShowFileUpload(false)}
            >
              <h2>Upload tender files</h2>
              <p>
                Secure direct upload, malware/processing gates, and versioning
                remain unchanged.
              </p>
              <form onSubmit={(event) => void upload(event)}>
                <Field htmlFor="upload-role" label="Document role">
                  <Select
                    id="upload-role"
                    name="role"
                    onChange={(event) => setUploadRole(event.target.value)}
                    value={uploadRole}
                  >
                    <option value="PRIMARY">Primary tender</option>
                    <option value="ANNEXURE">Annexure</option>
                    <option value="BOQ">BOQ</option>
                    <option value="TECHNICAL_SPECIFICATION">
                      Technical specification
                    </option>
                    <option value="FORM">Form</option>
                    <option value="DECLARATION">Declaration</option>
                    <option value="CORRIGENDUM">Corrigendum</option>
                    <option value="AMENDMENT">Amendment</option>
                    <option value="CLARIFICATION">Buyer clarification</option>
                    <option value="SUPPORTING">Supporting document</option>
                  </Select>
                </Field>
                {uploadRole === "CORRIGENDUM" ? (
                  <>
                    <Field
                      htmlFor="upload-corrigendum-id"
                      label="Corrigendum identifier"
                      required
                    >
                      <Input
                        id="upload-corrigendum-id"
                        name="corrigendum_identifier"
                        required
                      />
                    </Field>
                    <Field
                      htmlFor="upload-corrigendum-desc"
                      label="Corrigendum description"
                      required
                    >
                      <Input
                        id="upload-corrigendum-desc"
                        name="corrigendum_description"
                        required
                      />
                    </Field>
                  </>
                ) : null}
                <Field htmlFor="upload-files" label="Files">
                  <input
                    accept=".pdf,.zip,.xlsx,.docx,.csv"
                    className="input"
                    id="upload-files"
                    multiple
                    name="file"
                    required
                    type="file"
                  />
                </Field>
                <div className="inline-actions">
                  <Button type="submit">Upload source securely</Button>
                  <Button
                    onClick={() => setShowFileUpload(false)}
                    type="button"
                    variant="secondary"
                  >
                    Cancel
                  </Button>
                </div>
                <p aria-live="polite">{message}</p>
              </form>
            </Modal>
          ) : null}

          {pendingFileRemoval !== null ? (
            <Modal
              label={pendingFileRemoval.title}
              onClose={() => setPendingFileRemoval(null)}
            >
              <h2>{pendingFileRemoval.title}</h2>
              <p>{pendingFileRemoval.description}</p>
              <div className="inline-actions">
                <Button
                  onClick={() => setPendingFileRemoval(null)}
                  type="button"
                  variant="secondary"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => void removeTenderFile()}
                  type="button"
                  variant="danger"
                >
                  {pendingFileRemoval.confirmLabel}
                </Button>
              </div>
            </Modal>
          ) : null}

          <details className="disclosure tender-files__advanced">
            <summary>Advanced file details</summary>
            <div className="disclosure__body">
              <div className="tender-two-column">
                <section className="workspace-section">
                  <div className="workspace-section__header">
                    <div>
                      <h2>Processing</h2>
                      <p>
                        Tender processing stays visible here without implying
                        work that has not happened.
                      </p>
                    </div>
                  </div>
                  <div className="workspace-card">
                    {workspace.processingJobs.length === 0 ? (
                      <div className="workspace-empty-row">
                        <p>No source-processing jobs have started yet.</p>
                      </div>
                    ) : (
                      <div className="workspace-rows">
                        {workspace.processingJobs.map((job) => (
                          <article className="workspace-row" key={job.id}>
                            <div className="workspace-row__title">
                              <strong>
                                {job.publicMessage === ""
                                  ? "Source-processing update"
                                  : job.publicMessage}
                              </strong>
                              <p>{humanizeEnum(job.state)}</p>
                            </div>
                            <span
                              className={`status-badge status-badge--${statusTone(job.state)}`}
                            >
                              {humanizeEnum(job.state)}
                            </span>
                            <p className="workspace-row__supporting">
                              {job.progressPercentage}%
                            </p>
                            <span className="workspace-row__deadline" />
                            <span />
                          </article>
                        ))}
                      </div>
                    )}
                  </div>
                </section>

                <section className="workspace-section">
                  <div className="workspace-section__header">
                    <div>
                      <h2>Corrigenda</h2>
                      <p>Corrigendum history remains versioned and distinct.</p>
                    </div>
                  </div>
                  <div className="workspace-card">
                    {workspace.corrigenda.length === 0 ? (
                      <div className="workspace-empty-row">
                        <p>No corrigenda have been recorded.</p>
                      </div>
                    ) : (
                      <div className="workspace-rows">
                        {workspace.corrigenda.map((corrigendum) => (
                          <article
                            className="workspace-row"
                            key={corrigendum.id}
                          >
                            <div className="workspace-row__title">
                              <strong>{corrigendum.identifier}</strong>
                              <p>{corrigendum.description}</p>
                            </div>
                            <span className="status-badge status-badge--info">
                              Corrigendum
                            </span>
                            <p className="workspace-row__supporting">
                              {corrigendum.publicationDate === null
                                ? "Publication date unavailable"
                                : formatTimestamp(corrigendum.publicationDate)}
                            </p>
                            <span className="workspace-row__deadline" />
                            <span />
                          </article>
                        ))}
                      </div>
                    )}
                  </div>
                </section>
              </div>
            </div>
          </details>
        </div>
      ) : null}

      {activeSurface === "activity" ? (
        <div className="tender-surface standalone-surface activity-page">
          <header className="standalone-surface__header">
            <div>
              <button
                className="tender-header__back"
                onClick={() => navigateSurface("overview")}
                type="button"
              >
                ← Back to Overview
              </button>
              <h1>Activity</h1>
            </div>
            <div className="standalone-surface__actions">
              <Button
                onClick={() => navigateSurface("review")}
                type="button"
                variant="secondary"
              >
                View audit summary
              </Button>
              <Select
                aria-label="Filter activities"
                onChange={(event) => {
                  setActivityFilter(event.target.value);
                  setShowAllActivity(false);
                }}
                value={activityFilter}
              >
                <option value="ALL">All activities</option>
                {activityCategories.map((category) => (
                  <option key={category} value={category}>
                    {humanizeEnum(category)}
                  </option>
                ))}
              </Select>
            </div>
          </header>
          <section className="workspace-section">
            <div className="workspace-card activity-timeline">
              {filteredActivityItems.length === 0 ? (
                <div className="workspace-empty-row">
                  <p>No tender activity matches this view.</p>
                </div>
              ) : (
                <>
                  <span className="activity-timeline__day">Today</span>
                  <ol className="activity-list">
                    {visibleActivityItems.map((item, index) => (
                      <li
                        className="activity-list__item"
                        key={`${item.category}-${item.title}-${index}`}
                      >
                        <div
                          className={`activity-list__dot status-dot--${statusTone(item.category)}`}
                          aria-hidden="true"
                        />
                        <time>{formatActivityTime(item.occurredAt)}</time>
                        <div className="activity-list__body">
                          <strong>{item.title}</strong>
                          <p>{item.description}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                  {filteredActivityItems.length > 7 ? (
                    <Button
                      onClick={() => setShowAllActivity((current) => !current)}
                      type="button"
                      variant="secondary"
                    >
                      {showAllActivity
                        ? "Show recent activity"
                        : "View full audit log"}
                    </Button>
                  ) : null}
                </>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {activeSurface === "review" ? (
        <div className="tender-surface">
          <section className="workspace-section">
            <div className="workspace-section__header">
              <div>
                <h2>Final Review</h2>
                <p>
                  Review status, human decisions, and controlled download for{" "}
                  {workspace.title}.
                </p>
              </div>
            </div>
          </section>
          <div className="review-columns review-columns--readiness">
            <div className="review-columns__side">
              <div className="tender-embedded-section tender-tools-panel">
                {currentVersionId !== "" ? (
                  <FinalReadinessWorkspace
                    onNavigateStage={(stage) => {
                      if (stage === "draft") navigateSurface("draft");
                      else if (stage === "evidence" || stage === "checklist")
                        navigateSurface("eligibility");
                      else navigateSurface("overview");
                    }}
                    organisationId={organisationId}
                    tenderId={tenderId}
                    versionId={currentVersionId}
                  />
                ) : (
                  <div className="workspace-empty-row">
                    <p>
                      The current tender version is unavailable for readiness
                      review.
                    </p>
                  </div>
                )}
              </div>
            </div>
            <div className="review-columns__side">
              <Card className="tender-summary-card">
                <span className="tender-summary-card__label">
                  Human disposition
                </span>
                <strong>
                  {currentReadinessRun?.current_disposition == null
                    ? "No disposition recorded"
                    : humanizeEnum(
                        currentReadinessRun.current_disposition.disposition,
                      )}
                </strong>
                <p>
                  Final high-stakes decisions remain explicit human actions and
                  are never preselected. Controlled download approval remains
                  separate from submission approval.
                </p>
              </Card>
              <div className="tender-embedded-section tender-tools-panel">
                {currentVersionId !== "" ? (
                  <ControlledReviewPackageWorkspace
                    onNavigateStage={(stage) => {
                      if (stage === "draft") navigateSurface("draft");
                      else if (stage === "files") navigateSurface("files");
                      else if (stage === "risks") navigateSurface("overview");
                      else navigateSurface("review");
                    }}
                    organisationId={organisationId}
                    tenderId={tenderId}
                    versionId={currentVersionId}
                  />
                ) : (
                  <div className="workspace-empty-row">
                    <p>
                      The current tender version is unavailable for controlled
                      review packaging.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="workspace-card review-export-bar">
            <div>
              <strong>Review &amp; Export</strong>
              <p>
                Resolve decision-required items, generate the controlled
                package, complete approvals, then download.
              </p>
            </div>
            <div className="inline-actions">
              <Button
                onClick={() => navigateSurface("draft")}
                variant="secondary"
              >
                Back to Draft
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {activeSurface !== "ask" ? (
        <ContextualAssistant
          contextLabel={
            activeSurface === "draft"
              ? "Selected draft section"
              : workspace.title
          }
          context={
            activeSurface === "eligibility"
              ? "this requirement"
              : activeSurface === "draft"
                ? "this section"
                : "this tender"
          }
          openInChatHref={askHref}
          organisationId={organisationId}
          tenderId={tenderId}
          {...(currentVersionId === "" ? {} : { versionId: currentVersionId })}
        />
      ) : null}
    </div>
  );
}
