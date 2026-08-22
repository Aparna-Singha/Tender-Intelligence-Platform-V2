import { parseTenderDateTime } from "@tender/domain";

export type WorkflowTone =
  "accent" | "danger" | "info" | "neutral" | "success" | "warning";

export type TenderWorkflowStateCode =
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

export interface TenderWorkflowState {
  readonly actionLabel: string;
  readonly code: TenderWorkflowStateCode;
  readonly detail: string;
  readonly isCompleted: boolean;
  readonly isDraft: boolean;
  readonly isInProgress: boolean;
  readonly needsAttention: boolean;
  readonly onHold: boolean;
  readonly statusLabel: string;
  readonly tone: WorkflowTone;
}

interface CurrentDocumentSummary {
  readonly role: string;
  readonly status: string;
  readonly uploadSessionExpiresAt: Date;
}

interface CurrentRunSummary {
  readonly invalidatedAt: Date | null;
  readonly publicMessage?: string | null;
  readonly safeFailureMessage?: string | null;
  readonly status: string;
}

interface CurrentDecisionSummary {
  readonly decision: "CONTINUE" | "HOLD" | "STOP";
}

export interface SubmissionDeadlineResolution {
  readonly deadlineSource: "EXTRACTED_SOURCE" | "METADATA" | "UNAVAILABLE";
  readonly extractedSubmissionDeadline: string | null;
  readonly extractedSubmissionDeadlineText: string | null;
  readonly hasMismatch: boolean;
  readonly metadataSubmissionDeadline: string | null;
  readonly submissionDeadline: string | null;
}

export interface TenderWorkflowContext {
  readonly assessment: CurrentRunSummary | null;
  readonly currentDecision: CurrentDecisionSummary | null;
  readonly currentDraftExists: boolean;
  readonly currentDraftRunStatus: string | null;
  readonly documents: readonly CurrentDocumentSummary[];
  readonly extraction: CurrentRunSummary | null;
  readonly processingJobs: readonly {
    readonly publicMessage: string;
    readonly state: string;
  }[];
  readonly risk: CurrentRunSummary | null;
}

export function resolveSubmissionDeadline(
  metadataSubmissionDeadline: Date | null | undefined,
  extractedSubmissionDeadlineText: string | null,
): SubmissionDeadlineResolution {
  const metadata = metadataSubmissionDeadline?.toISOString() ?? null;
  const extracted =
    extractedSubmissionDeadlineText === null
      ? null
      : (parseTenderDateTime(extractedSubmissionDeadlineText)?.toISOString() ??
        null);
  return {
    deadlineSource:
      extracted !== null
        ? "EXTRACTED_SOURCE"
        : metadata !== null
          ? "METADATA"
          : "UNAVAILABLE",
    extractedSubmissionDeadline: extracted,
    extractedSubmissionDeadlineText,
    hasMismatch:
      metadata !== null &&
      extracted !== null &&
      Math.abs(new Date(metadata).getTime() - new Date(extracted).getTime()) >=
        60_000,
    metadataSubmissionDeadline: metadata,
    submissionDeadline: extracted ?? metadata,
  };
}

export function deriveTenderWorkflowState(
  context: TenderWorkflowContext,
): TenderWorkflowState {
  const expiredUpload = context.documents.find(isExpiredUpload);
  if (expiredUpload !== undefined) {
    return {
      actionLabel: "Review",
      code: "FAILED_RECOVERABLE",
      detail:
        "A tender upload expired before processing finished. Remove the failed upload and upload the same file again.",
      isCompleted: false,
      isDraft: false,
      isInProgress: false,
      needsAttention: true,
      onHold: false,
      statusLabel: "Upload failed",
      tone: "danger",
    };
  }

  if (context.documents.length === 0) {
    return {
      actionLabel: "Upload tender",
      code: "AWAITING_SOURCE",
      detail:
        "Upload the current tender source so analysis can begin automatically.",
      isCompleted: false,
      isDraft: false,
      isInProgress: false,
      needsAttention: false,
      onHold: false,
      statusLabel: "Upload tender",
      tone: "neutral",
    };
  }

  if (context.documents.some(isUploading)) {
    return {
      actionLabel: "Open",
      code: "UPLOADING",
      detail:
        "The tender file is still uploading. Analysis will continue automatically after upload verification completes.",
      isCompleted: false,
      isDraft: false,
      isInProgress: true,
      needsAttention: false,
      onHold: false,
      statusLabel: "Uploading tender...",
      tone: "info",
    };
  }

  const sourceProcessingFailure = context.processingJobs.find(
    (job) => job.state === "FAILED",
  );
  if (sourceProcessingFailure !== undefined) {
    return {
      actionLabel: "Review",
      code: "FAILED_RECOVERABLE",
      detail:
        sourceProcessingFailure.publicMessage ||
        "Tender source processing failed safely. Retry with the current source file.",
      isCompleted: false,
      isDraft: false,
      isInProgress: false,
      needsAttention: true,
      onHold: false,
      statusLabel: "Source processing failed",
      tone: "danger",
    };
  }

  if (
    context.documents.some((document) => document.status === "UPLOADED") ||
    context.processingJobs.some(
      (job) => !["CANCELLED", "COMPLETE", "FAILED"].includes(job.state),
    )
  ) {
    return {
      actionLabel: "Open",
      code: "PROCESSING_SOURCE",
      detail:
        "The uploaded tender file is being checked and prepared for extraction.",
      isCompleted: false,
      isDraft: false,
      isInProgress: true,
      needsAttention: false,
      onHold: false,
      statusLabel: "Checking tender file...",
      tone: "info",
    };
  }

  if (context.extraction?.status === "FAILED") {
    return {
      actionLabel: "Review",
      code: "FAILED_RECOVERABLE",
      detail:
        context.extraction.safeFailureMessage ??
        context.extraction.publicMessage ??
        "Tender extraction failed safely. Retry with the current source set.",
      isCompleted: false,
      isDraft: false,
      isInProgress: false,
      needsAttention: true,
      onHold: false,
      statusLabel: "Extraction failed",
      tone: "danger",
    };
  }

  if (
    context.extraction?.invalidatedAt !== null ||
    context.extraction.status !== "COMPLETE"
  ) {
    return {
      actionLabel: "Open",
      code: "EXTRACTING",
      detail:
        "The platform is reading the current tender source and extracting source-grounded requirements automatically.",
      isCompleted: false,
      isDraft: false,
      isInProgress: true,
      needsAttention: false,
      onHold: false,
      statusLabel: "Reading tender...",
      tone: "info",
    };
  }

  if (context.risk?.status === "FAILED") {
    return {
      actionLabel: "Review",
      code: "FAILED_RECOVERABLE",
      detail:
        context.risk.safeFailureMessage ??
        context.risk.publicMessage ??
        "Early risk analysis failed safely for the current tender version.",
      isCompleted: false,
      isDraft: false,
      isInProgress: false,
      needsAttention: true,
      onHold: false,
      statusLabel: "Risk analysis failed",
      tone: "danger",
    };
  }

  if (
    context.risk?.invalidatedAt !== null ||
    context.risk.status !== "COMPLETE"
  ) {
    return {
      actionLabel: "Open",
      code: "REVIEWING_RISKS",
      detail:
        "Extraction is complete and cited early risk analysis is still running automatically.",
      isCompleted: false,
      isDraft: false,
      isInProgress: true,
      needsAttention: false,
      onHold: false,
      statusLabel: "Analysing tender...",
      tone: "info",
    };
  }

  if (context.currentDecision === null) {
    return {
      actionLabel: "Review",
      code: "AWAITING_EARLY_DECISION",
      detail:
        "Tender analysis is ready for human review. Record an authorised CONTINUE, HOLD, or STOP decision to unlock the next step.",
      isCompleted: false,
      isDraft: false,
      isInProgress: false,
      needsAttention: true,
      onHold: false,
      statusLabel: "Review tender",
      tone: "warning",
    };
  }

  if (context.currentDecision.decision !== "CONTINUE") {
    const onHold = context.currentDecision.decision === "HOLD";
    return {
      actionLabel: "Review",
      code: "AWAITING_EARLY_DECISION",
      detail: onHold
        ? "A current HOLD decision is recorded. Update that decision when the tender is ready to move forward."
        : "A current STOP decision is recorded. Change the decision only if the tender should re-enter the workflow.",
      isCompleted: false,
      isDraft: false,
      isInProgress: false,
      needsAttention: true,
      onHold,
      statusLabel: "Review tender",
      tone: onHold ? "warning" : "danger",
    };
  }

  if (context.assessment?.status === "FAILED") {
    return {
      actionLabel: "Review",
      code: "FAILED_RECOVERABLE",
      detail:
        context.assessment.safeFailureMessage ??
        context.assessment.publicMessage ??
        "Eligibility comparison failed safely for the current tender version.",
      isCompleted: false,
      isDraft: false,
      isInProgress: false,
      needsAttention: true,
      onHold: false,
      statusLabel: "Eligibility failed",
      tone: "danger",
    };
  }

  if (
    context.assessment?.invalidatedAt !== null ||
    context.assessment.status !== "COMPLETE"
  ) {
    return {
      actionLabel: "Open",
      code: "COMPARING_ELIGIBILITY",
      detail:
        "Eligibility comparison is running against the current authorised evidence snapshot.",
      isCompleted: false,
      isDraft: false,
      isInProgress: true,
      needsAttention: false,
      onHold: false,
      statusLabel: "Checking eligibility...",
      tone: "info",
    };
  }

  if (context.currentDraftRunStatus === "FAILED") {
    return {
      actionLabel: "Review",
      code: "FAILED_RECOVERABLE",
      detail:
        "Draft preparation failed safely. Retry drafting from the current tender analysis state.",
      isCompleted: false,
      isDraft: true,
      isInProgress: false,
      needsAttention: true,
      onHold: false,
      statusLabel: "Draft preparation failed",
      tone: "danger",
    };
  }

  if (
    context.currentDraftRunStatus !== null &&
    [
      "QUEUED",
      "SNAPSHOTTING",
      "PLANNING",
      "RETRIEVING",
      "GENERATING",
      "VALIDATING",
    ].includes(context.currentDraftRunStatus)
  ) {
    return {
      actionLabel: "Open",
      code: "DRAFTING",
      detail:
        "Analysis is complete and the platform is preparing the current bid draft.",
      isCompleted: false,
      isDraft: true,
      isInProgress: true,
      needsAttention: false,
      onHold: false,
      statusLabel: "Preparing draft...",
      tone: "accent",
    };
  }

  if (context.currentDraftExists) {
    return {
      actionLabel: "Review draft",
      code: "REVIEW_READY",
      detail:
        "A current draft is ready for human review and controlled export steps.",
      isCompleted: false,
      isDraft: true,
      isInProgress: false,
      needsAttention: true,
      onHold: false,
      statusLabel: "Ready for review",
      tone: "accent",
    };
  }

  return {
    actionLabel: "Continue",
    code: "ANALYSIS_READY",
    detail:
      "Tender analysis is ready. Review eligibility and move into drafting when the team is ready.",
    isCompleted: false,
    isDraft: false,
    isInProgress: false,
    needsAttention: false,
    onHold: false,
    statusLabel: "Analysis ready",
    tone: "success",
  };
}

function isExpiredUpload(document: CurrentDocumentSummary): boolean {
  return (
    document.status === "UPLOADING" &&
    document.uploadSessionExpiresAt.getTime() < Date.now()
  );
}

function isUploading(document: CurrentDocumentSummary): boolean {
  return document.status === "UPLOADING" && !isExpiredUpload(document);
}
