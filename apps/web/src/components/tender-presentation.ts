"use client";

import { humanizeEnum } from "@tender/ui";

export interface TenderSummary {
  readonly buyer: string;
  readonly deadlineResolution?: {
    readonly deadlineSource: "EXTRACTED_SOURCE" | "METADATA" | "UNAVAILABLE";
    readonly extractedSubmissionDeadline?: string | null;
    readonly extractedSubmissionDeadlineText?: string | null;
    readonly hasMismatch: boolean;
    readonly metadataSubmissionDeadline?: string | null;
    readonly submissionDeadline?: string | null;
  };
  readonly id: string;
  readonly isDemonstration: boolean;
  readonly lifecycleStatus: string;
  readonly metadataSubmissionDeadline?: string;
  readonly sourceTenderNumber: string | null;
  readonly submissionDeadline?: string;
  readonly title: string;
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
    readonly tone: TenderTone;
  };
  readonly workspace: {
    readonly processingProgress: number;
    readonly status: string;
  } | null;
}

export type TenderTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "accent";

export interface TenderPresentation {
  readonly actionLabel: string;
  readonly isCompleted: boolean;
  readonly isDraft: boolean;
  readonly isInProgress: boolean;
  readonly needsAttention: boolean;
  readonly onHold: boolean;
  readonly statusLabel: string;
  readonly supportingLabel: string;
  readonly tone: TenderTone;
}

function hasAny(value: string, candidates: readonly string[]): boolean {
  return candidates.some((candidate) => value.includes(candidate));
}

function authoritativeLifecycleLabel(
  lifecycle: string,
  workspaceStatus: string,
): string {
  return humanizeEnum(workspaceStatus !== "" ? workspaceStatus : lifecycle);
}

export function getDeadlineDays(
  submissionDeadline: string | null | undefined,
): number | null {
  if (submissionDeadline === undefined || submissionDeadline === null) return null;
  const deadline = new Date(submissionDeadline);
  if (Number.isNaN(deadline.getTime())) return null;
  const today = new Date();
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const startOfDeadline = new Date(
    deadline.getFullYear(),
    deadline.getMonth(),
    deadline.getDate(),
  );
  return Math.round(
    (startOfDeadline.getTime() - startOfToday.getTime()) / 86_400_000,
  );
}

export function formatDeadline(
  submissionDeadline: string | null | undefined,
): string {
  if (submissionDeadline === undefined || submissionDeadline === null)
    return "Deadline unavailable";
  const deadline = new Date(submissionDeadline);
  if (Number.isNaN(deadline.getTime())) return "Deadline unavailable";
  return deadline.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDeadlineCountdown(
  submissionDeadline: string | null | undefined,
): string {
  const days = getDeadlineDays(submissionDeadline);
  if (days === null) return "Deadline unavailable";
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`;
  if (days === 0) return "Due today";
  if (days === 1) return "1 day left";
  return `${days} days left`;
}

export function describeTender(tender: TenderSummary): TenderPresentation {
  const daysUntilDeadline = getDeadlineDays(tender.submissionDeadline);
  const deadlineSoon = daysUntilDeadline !== null && daysUntilDeadline <= 7;
  const overdue = daysUntilDeadline !== null && daysUntilDeadline < 0;

  if (tender.workflowState !== undefined) {
    return {
      actionLabel: tender.workflowState.actionLabel,
      isCompleted: tender.workflowState.isCompleted,
      isDraft: tender.workflowState.isDraft,
      isInProgress: tender.workflowState.isInProgress,
      needsAttention:
        tender.workflowState.needsAttention || overdue || deadlineSoon,
      onHold: tender.workflowState.onHold,
      statusLabel: tender.workflowState.statusLabel,
      supportingLabel: tender.workflowState.detail,
      tone: tender.workflowState.tone,
    };
  }

  const lifecycle = tender.lifecycleStatus.toUpperCase();
  const workspaceStatus = tender.workspace?.status.toUpperCase() ?? "";
  const combined = `${lifecycle} ${workspaceStatus}`;
  const progress = tender.workspace?.processingProgress ?? 0;

  if (hasAny(combined, ["FAILED", "ERROR", "REJECTED", "BLOCKED"])) {
    return {
      actionLabel: "Review",
      isCompleted: false,
      isDraft: false,
      isInProgress: false,
      needsAttention: true,
      onHold: false,
      statusLabel: "Needs attention",
      supportingLabel: humanizeEnum(
        workspaceStatus !== "" ? workspaceStatus : lifecycle,
      ),
      tone: "danger",
    };
  }

  if (hasAny(combined, ["REVIEW", "REQUIRES_ACTION", "HUMAN"])) {
    return {
      actionLabel: "Review",
      isCompleted: false,
      isDraft: false,
      isInProgress: false,
      needsAttention: true,
      onHold: false,
      statusLabel: "Needs review",
      supportingLabel: humanizeEnum(
        workspaceStatus !== "" ? workspaceStatus : lifecycle,
      ),
      tone: "warning",
    };
  }

  if (hasAny(combined, ["DRAFT"])) {
    const readyForReview = hasAny(combined, ["READY", "APPROVAL", "REVIEW"]);
    return {
      actionLabel: readyForReview ? "Review draft" : "Continue",
      isCompleted: false,
      isDraft: true,
      isInProgress: !readyForReview && progress > 0 && progress < 100,
      needsAttention: readyForReview || overdue || deadlineSoon,
      onHold: false,
      statusLabel: readyForReview ? "Draft ready" : "Draft in progress",
      supportingLabel:
        progress > 0 && progress < 100
          ? `${progress}% ready`
          : humanizeEnum(workspaceStatus !== "" ? workspaceStatus : lifecycle),
      tone: readyForReview ? "accent" : "info",
    };
  }

  if (
    progress > 0 &&
    progress < 100 &&
    hasAny(combined, ["INGEST", "PROCESS", "RUNNING", "ANALYS", "QUEUE"])
  ) {
    return {
      actionLabel: "Open",
      isCompleted: false,
      isDraft: false,
      isInProgress: true,
      needsAttention: false,
      onHold: false,
      statusLabel: "Analysis running",
      supportingLabel: `${progress}% complete`,
      tone: "info",
    };
  }

  if (hasAny(combined, ["COMPLETE", "COMPLETED", "READY", "APPROVED"])) {
    const lifecycleLabel = authoritativeLifecycleLabel(
      lifecycle,
      workspaceStatus,
    );
    return {
      actionLabel: "Continue",
      isCompleted: false,
      isDraft: false,
      isInProgress: false,
      needsAttention: overdue || deadlineSoon,
      onHold: false,
      statusLabel: lifecycleLabel,
      supportingLabel: lifecycleLabel,
      tone: hasAny(combined, ["COMPLETE", "COMPLETED"]) ? "success" : "success",
    };
  }

  return {
    actionLabel: "Open",
    isCompleted: false,
    isDraft: false,
    isInProgress: false,
    needsAttention: overdue || deadlineSoon,
    onHold: false,
    statusLabel: humanizeEnum(lifecycle),
    supportingLabel:
      workspaceStatus === "" ? "Awaiting next action" : humanizeEnum(workspaceStatus),
    tone: deadlineSoon ? "warning" : "neutral",
  };
}
