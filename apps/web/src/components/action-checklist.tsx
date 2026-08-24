"use client";

import Link from "next/link";
import { useEffect, useState, type JSX } from "react";
import {
  Badge,
  Button,
  Card,
  FormMessage,
  Input,
  Modal,
  Textarea,
  humanizeEnum,
} from "@tender/ui";
import { PublicApiError, apiRequest, formatApiError } from "../lib/api";

interface ChecklistRun {
  assessmentRunId: string;
  checklistPolicyVersion: string;
  completedAt: string | null;
  evidenceSnapshotId: string;
  id: string;
  invalidatedAt: string | null;
  progressPercentage: number;
  publicMessage: string;
  status: string;
}

interface ChecklistItem {
  completionCriteria: string;
  currentDueDate: string | null;
  currentPriority: string;
  currentTitle: string;
  dateIsOfficial: boolean;
  evidenceNeedCategory: string;
  id: string;
  itemType: string;
  proposedExplanation: string;
  status: string;
}

interface ChecklistResult {
  items: readonly ChecklistItem[];
  priority_counts: readonly { _count: number; currentPriority: string }[];
  status_counts: readonly { _count: number; status: string }[];
  total: number;
}

type TransitionDialogState = {
  readonly item: ChecklistItem;
  readonly nextStatus: string;
} | null;

type WorkflowEditField = "assignee_id" | "due_date";

type WorkflowEditDialogState = {
  readonly field: WorkflowEditField;
  readonly item: ChecklistItem;
} | null;

function badgeToneForPriority(
  priority: string,
): "danger" | "info" | "neutral" | "success" | "warning" {
  switch (priority) {
    case "BLOCKING":
    case "HIGH":
      return "danger";
    case "MEDIUM":
      return "warning";
    case "LOW":
      return "info";
    default:
      return "neutral";
  }
}

function badgeToneForStatus(
  status: string,
): "danger" | "info" | "neutral" | "success" | "warning" {
  switch (status) {
    case "RESOLVED":
      return "success";
    case "BLOCKED":
      return "danger";
    case "READY_FOR_REASSESSMENT":
      return "info";
    case "IN_PROGRESS":
      return "warning";
    case "DISMISSED":
      return "neutral";
    default:
      return "warning";
  }
}

function primaryActionForItem(item: ChecklistItem): {
  readonly label: string;
  readonly nextStatus: string;
} | null {
  switch (item.status) {
    case "OPEN":
      return {
        label: describeTaskAction(item),
        nextStatus: "IN_PROGRESS",
      };
    case "IN_PROGRESS":
      return {
        label: "Mark ready for reassessment",
        nextStatus: "READY_FOR_REASSESSMENT",
      };
    case "BLOCKED":
      return {
        label: resumeTaskLabel(item),
        nextStatus: "IN_PROGRESS",
      };
    case "READY_FOR_REASSESSMENT":
      return { label: "Resolve using latest review", nextStatus: "RESOLVED" };
    case "RESOLVED":
    case "DISMISSED":
      return { label: "Reopen", nextStatus: "OPEN" };
    default:
      return null;
  }
}

function countForStatus(
  result: ChecklistResult | null,
  status: string,
): number {
  return result?.items.filter((item) => item.status === status).length ?? 0;
}

function attentionCount(result: ChecklistResult | null): number {
  if (result === null) return 0;
  return ["OPEN", "IN_PROGRESS", "BLOCKED", "READY_FOR_REASSESSMENT"].reduce(
    (sum, status) => sum + countForStatus(result, status),
    0,
  );
}

function sanitizeChecklistCopy(text: string): string {
  return text
    .replace(
      /current controlled Phase 7 assessment/giu,
      "latest eligibility review",
    )
    .replace(/controlled Phase 7 assessment/giu, "latest eligibility review")
    .replace(/cited interpretation in Phase 7/giu, "cited interpretation")
    .replace(
      /an authorised reviewer records/giu,
      "An authorised reviewer needs to record",
    )
    .replace(/\bPhase 7\b/giu, "eligibility review");
}

function isGenericChecklistExplanation(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
  return (
    normalized.includes("derived from the latest eligibility review") ||
    normalized.includes("derived from the latest review") ||
    normalized.includes("does not independently determine eligibility")
  );
}

function checklistCardSummary(item: ChecklistItem): string {
  const explanation = sanitizeChecklistCopy(item.proposedExplanation).trim();
  const completionCriteria = sanitizeChecklistCopy(
    item.completionCriteria,
  ).trim();
  if (explanation !== "" && !isGenericChecklistExplanation(explanation)) {
    return explanation;
  }
  if (completionCriteria !== "") return completionCriteria;
  if (explanation !== "") return explanation;
  return "Review the current tender and company evidence for this action.";
}

function transitionDialogCopy(dialog: NonNullable<TransitionDialogState>): {
  readonly confirmLabel: string;
  readonly helperText: string;
  readonly title: string;
} {
  switch (dialog.nextStatus) {
    case "BLOCKED":
      return {
        confirmLabel: "Mark blocked",
        helperText: "Enter at least 10 characters.",
        title: "Mark blocked",
      };
    case "DISMISSED":
      return {
        confirmLabel: "Dismiss item",
        helperText: "Enter at least 10 characters.",
        title: "Dismiss item",
      };
    case "RESOLVED":
      return {
        confirmLabel: "Resolve item",
        helperText: "Enter at least 10 characters.",
        title: "Resolve item",
      };
    case "READY_FOR_REASSESSMENT":
      return {
        confirmLabel: "Mark ready",
        helperText: "Enter at least 10 characters.",
        title: "Ready for reassessment",
      };
    case "IN_PROGRESS":
      return {
        confirmLabel: "Save update",
        helperText: "Enter at least 10 characters.",
        title:
          dialog.item.status === "OPEN"
            ? describeTaskAction(dialog.item)
            : resumeTaskLabel(dialog.item),
      };
    default:
      return {
        confirmLabel: "Confirm",
        helperText: "Enter at least 10 characters.",
        title: "Update item",
      };
  }
}

function workflowEditCopy(field: WorkflowEditField): {
  readonly fieldHelper: string;
  readonly fieldLabel: string;
  readonly title: string;
  readonly valueMode: "date" | "text";
} {
  if (field === "due_date")
    return {
      fieldHelper: "Leave blank to clear the internal target date.",
      fieldLabel: "Internal target date",
      title: "Set internal target date",
      valueMode: "date",
    };
  return {
    fieldHelper:
      "Enter an active organisation member ID, or leave blank to unassign.",
    fieldLabel: "Organisation member ID",
    title: "Assign or unassign",
    valueMode: "text",
  };
}

function isConflict(error: unknown): boolean {
  return error instanceof PublicApiError && error.status === 409;
}

function describeTaskAction(item: ChecklistItem): string {
  const title = sanitizeChecklistCopy(item.currentTitle).trim();
  if (title !== "") return title;
  if (item.evidenceNeedCategory === "LEGAL_INTERPRETATION")
    return "Review requirement";
  return "Review action";
}

function resumeTaskLabel(item: ChecklistItem): string {
  const title = sanitizeChecklistCopy(item.currentTitle).toLowerCase();
  if (title.startsWith("review ")) return "Resume review";
  if (title.startsWith("confirm ")) return "Resume confirmation";
  return "Resume task";
}

export function ActionChecklist({
  currentAssessmentRunId = null,
  presentation = "full",
  organisationId,
  tenderId,
  visibleItemIds,
  versionId,
}: {
  readonly currentAssessmentRunId?: string | null;
  readonly presentation?: "full" | "history";
  readonly organisationId: string;
  readonly tenderId: string;
  readonly visibleItemIds?: readonly string[];
  readonly versionId: string;
}): JSX.Element {
  const base = `/organisations/${organisationId}/tenders/${tenderId}`;
  const [runs, setRuns] = useState<readonly ChecklistRun[]>([]);
  const [historyRunId, setHistoryRunId] = useState("");
  const [result, setResult] = useState<ChecklistResult | null>(null);
  const [status, setStatus] = useState("");
  const [message, setMessage] = useState("");
  const [transitionDialog, setTransitionDialog] =
    useState<TransitionDialogState>(null);
  const [workflowEditDialog, setWorkflowEditDialog] =
    useState<WorkflowEditDialogState>(null);
  const [transitionRationale, setTransitionRationale] = useState("");
  const [blockedReason, setBlockedReason] = useState("");
  const [workflowValue, setWorkflowValue] = useState("");
  const [workflowRationale, setWorkflowRationale] = useState("");
  const [dialogError, setDialogError] = useState("");

  async function loadRuns(): Promise<void> {
    try {
      const loaded = await apiRequest<readonly ChecklistRun[]>(
        `${base}/versions/${versionId}/checklists`,
      );
      setRuns(loaded);
      const preferredRunId =
        loaded.find(
          (run) =>
            run.invalidatedAt == null &&
            currentAssessmentRunId !== null &&
            run.assessmentRunId === currentAssessmentRunId,
        )?.id ??
        loaded[0]?.id ??
        "";
      setHistoryRunId((current) =>
        current === "" || !loaded.some((run) => run.id === current)
          ? preferredRunId
          : current,
      );
    } catch (error) {
      setMessage(formatApiError(error, "Unable to load checklist history."));
    }
  }

  async function loadItems(
    nextRunId: string,
    nextStatus = status,
  ): Promise<void> {
    if (nextRunId === "") return;
    const query = nextStatus === "" ? "" : `?status=${nextStatus}`;
    try {
      setResult(
        await apiRequest<ChecklistResult>(
          `${base}/checklists/${nextRunId}/items${query}`,
        ),
      );
    } catch (error) {
      setResult(null);
      setMessage(formatApiError(error, "Unable to load action-list items."));
    }
  }

  useEffect(() => {
    void loadRuns();
    const timer = window.setInterval(() => void loadRuns(), 5_000);
    return () => window.clearInterval(timer);
  }, [currentAssessmentRunId, organisationId, tenderId, versionId]);

  const currentRun =
    currentAssessmentRunId === null
      ? null
      : (runs.find(
          (run) =>
            run.invalidatedAt == null &&
            run.assessmentRunId === currentAssessmentRunId,
        ) ?? null);
  const currentRunId = currentRun?.id ?? "";

  useEffect(() => {
    if (currentRunId === "") {
      setResult(null);
      return;
    }
    void loadItems(currentRunId);
  }, [currentRunId, status]);

  async function refreshAfterConflict(): Promise<void> {
    await loadRuns();
    if (currentRunId !== "") await loadItems(currentRunId);
    setMessage(
      "This item changed while you were reviewing it. We loaded the latest version. Please review it again.",
    );
  }

  function resetDialogState(): void {
    setTransitionDialog(null);
    setWorkflowEditDialog(null);
    setTransitionRationale("");
    setBlockedReason("");
    setWorkflowValue("");
    setWorkflowRationale("");
    setDialogError("");
  }

  async function start(): Promise<void> {
    try {
      await apiRequest(`${base}/versions/${versionId}/checklists`, {
        body: JSON.stringify({ idempotency_key: crypto.randomUUID() }),
        method: "POST",
      });
      setMessage(
        "Missing-item review started from the latest eligibility results.",
      );
      await loadRuns();
    } catch (error) {
      setMessage(
        formatApiError(
          error,
          "This review can start after tender processing, risk review, Continue, and the latest eligibility check are complete.",
        ),
      );
    }
  }

  function openTransitionDialog(item: ChecklistItem, nextStatus: string): void {
    setTransitionDialog({ item, nextStatus });
    setTransitionRationale("");
    setBlockedReason("");
    setDialogError("");
  }

  async function submitTransition(): Promise<void> {
    if (transitionDialog === null) return;
    const rationale = transitionRationale.trim();
    if (rationale.length < 10) {
      setDialogError("Enter at least 10 characters.");
      return;
    }
    const blocked = blockedReason.trim();
    if (transitionDialog.nextStatus === "BLOCKED" && blocked.length < 10) {
      setDialogError("Add a blocked reason with at least 10 characters.");
      return;
    }

    try {
      await apiRequest(
        `${base}/checklists/${currentRunId}/items/${transitionDialog.item.id}`,
        {
          body: JSON.stringify({
            ...(transitionDialog.nextStatus === "BLOCKED"
              ? { blocked_reason: blocked }
              : {}),
            ...(transitionDialog.nextStatus === "DISMISSED"
              ? { dismissal_rationale: rationale }
              : {}),
            ...(transitionDialog.nextStatus === "RESOLVED"
              ? { resolution_note: rationale }
              : {}),
            rationale,
            status: transitionDialog.nextStatus,
          }),
          method: "PATCH",
        },
      );
      resetDialogState();
      await loadItems(currentRunId);
    } catch (error) {
      if (isConflict(error)) {
        resetDialogState();
        await refreshAfterConflict();
        return;
      }
      setDialogError(
        formatApiError(error, "The checklist update could not be completed."),
      );
    }
  }

  function openWorkflowEditDialog(
    item: ChecklistItem,
    field: WorkflowEditField,
  ): void {
    setWorkflowEditDialog({ field, item });
    setWorkflowValue(
      field === "due_date" && item.currentDueDate !== null
        ? item.currentDueDate.slice(0, 10)
        : "",
    );
    setWorkflowRationale("");
    setDialogError("");
  }

  async function submitWorkflowEdit(): Promise<void> {
    if (workflowEditDialog === null) return;
    const rationale = workflowRationale.trim();
    if (rationale.length < 10) {
      setDialogError("Enter at least 10 characters.");
      return;
    }

    const fieldValue =
      workflowEditDialog.field === "due_date"
        ? workflowValue.trim() === ""
          ? null
          : `${workflowValue.trim()}T00:00:00.000Z`
        : workflowValue.trim() === ""
          ? null
          : workflowValue.trim();

    try {
      await apiRequest(
        `${base}/checklists/${currentRunId}/items/${workflowEditDialog.item.id}`,
        {
          body: JSON.stringify({
            [workflowEditDialog.field]: fieldValue,
            rationale,
          }),
          method: "PATCH",
        },
      );
      resetDialogState();
      await loadItems(currentRunId);
    } catch (error) {
      if (isConflict(error)) {
        resetDialogState();
        await refreshAfterConflict();
        return;
      }
      setDialogError(
        formatApiError(
          error,
          "The assignment or internal target date was rejected.",
        ),
      );
    }
  }

  const selected = runs.find((run) => run.id === historyRunId);
  const visibleItems =
    visibleItemIds === undefined
      ? (result?.items ?? [])
      : (result?.items.filter((item) => visibleItemIds.includes(item.id)) ??
        []);
  const visibleResult =
    result === null
      ? null
      : {
          ...result,
          items: visibleItems,
          total: visibleItems.length,
        };
  const needsAttention = attentionCount(visibleResult);
  const resolvedCount = countForStatus(visibleResult, "RESOLVED");
  const transitionCopy =
    transitionDialog === null ? null : transitionDialogCopy(transitionDialog);
  const workflowCopy =
    workflowEditDialog === null
      ? null
      : workflowEditCopy(workflowEditDialog.field);
  const historyContent = (
    <div className="tender-tools-panel">
      <p>
        Missing-item progress:{" "}
        {visibleResult === null || visibleResult.total === 0
          ? "No items"
          : `${resolvedCount} of ${visibleResult.total} resolved`}
      </p>
      <p>
        Current and previous action-list runs stay available here for audit and
        currentness review. Official tender deadlines remain separate from
        internal target dates.
      </p>
      {presentation === "full" ? (
        <Button onClick={() => void start()} type="button" variant="secondary">
          Refresh action list
        </Button>
      ) : null}
      <label>
        Action-list history
        <select
          value={historyRunId}
          onChange={(event) => setHistoryRunId(event.target.value)}
        >
          <option value="">No checklist selected</option>
          {runs.map((run) => (
            <option key={run.id} value={run.id}>
              {run.id === currentRunId
                ? "Current"
                : run.invalidatedAt == null
                  ? "Previous"
                  : "Out of date"}{" "}
              - {humanizeEnum(run.status)} - {run.checklistPolicyVersion}
            </option>
          ))}
        </select>
      </label>
      {selected !== undefined ? (
        <p>
          {humanizeEnum(selected.status)} - {selected.progressPercentage}% -{" "}
          {selected.publicMessage}
          {selected.invalidatedAt === null ? "" : " - Out of date"}
        </p>
      ) : null}
      <label>
        Status filter
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">All</option>
          {[
            "OPEN",
            "IN_PROGRESS",
            "BLOCKED",
            "READY_FOR_REASSESSMENT",
            "RESOLVED",
            "DISMISSED",
          ].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </label>
    </div>
  );

  return (
    <section aria-labelledby="action-checklist-heading">
      <h2 className="visually-hidden" id="action-checklist-heading">
        Missing documents and actions
      </h2>
      {presentation === "full" ? (
        <p className="field__hint">
          These actions help resolve eligibility questions. Completing an action
          does not automatically determine overall eligibility.
        </p>
      ) : null}
      <p aria-live="polite">{message}</p>
      {presentation === "history" ? (
        runs.length === 0 ? (
          <div className="workspace-empty-row">
            <p>No previous action lists are available yet.</p>
          </div>
        ) : (
          historyContent
        )
      ) : (
        <>
          {runs.length === 0 ? (
            <Card className="tender-summary-card">
              <span className="tender-summary-card__label">
                Missing items and actions
              </span>
              <strong>No action list yet</strong>
              <p>
                Start the action list after the latest eligibility review is
                ready.
              </p>
              <div className="inline-actions">
                <Button onClick={() => void start()}>Create action list</Button>
                <Link
                  className="button button--secondary"
                  href={`/documents/${organisationId}`}
                >
                  Open company documents
                </Link>
              </div>
            </Card>
          ) : currentRun === null ? (
            <Card className="tender-summary-card">
              <span className="tender-summary-card__label">
                Missing items and actions
              </span>
              <strong>No current action list yet</strong>
              <p>
                The latest eligibility review does not have a current action
                list. Previous action lists remain available in Audit &amp;
                evidence.
              </p>
              <div className="inline-actions">
                <Button onClick={() => void start()}>
                  Refresh action list
                </Button>
                <Link
                  className="button button--secondary"
                  href={`/documents/${organisationId}`}
                >
                  Open company documents
                </Link>
              </div>
            </Card>
          ) : (
            <>
              <div className="tender-stat-row">
                <div className="tender-stat">
                  <strong>{needsAttention}</strong>
                  <span>
                    item{needsAttention === 1 ? "" : "s"} need attention
                  </span>
                </div>
                <div className="tender-stat">
                  <strong>{countForStatus(result, "BLOCKED")}</strong>
                  <span>Blocked</span>
                </div>
                <div className="tender-stat">
                  <strong>{resolvedCount}</strong>
                  <span>Resolved</span>
                </div>
              </div>
              <p>
                <Link href={`/documents/${organisationId}`}>
                  Open company documents
                </Link>{" "}
                . Evidence details are available above when you need them.
              </p>
              {visibleItems.length === 0 ? (
                <div className="workspace-empty-row">
                  <p>No current actions are shown in this view.</p>
                </div>
              ) : (
                visibleItems.map((item) => {
                  const primaryAction = primaryActionForItem(item);
                  return (
                    <article
                      className="workspace-card"
                      key={item.id}
                      tabIndex={0}
                    >
                      <div className="requirement-detail__header">
                        <div>
                          <div
                            style={{
                              display: "flex",
                              flexWrap: "wrap",
                              gap: 8,
                              marginBottom: 8,
                            }}
                          >
                            <Badge
                              tone={badgeToneForPriority(item.currentPriority)}
                            >
                              {humanizeEnum(item.currentPriority)}
                            </Badge>
                            <Badge tone={badgeToneForStatus(item.status)}>
                              {humanizeEnum(item.status)}
                            </Badge>
                          </div>
                          <h3>{sanitizeChecklistCopy(item.currentTitle)}</h3>
                        </div>
                      </div>
                      <p>{checklistCardSummary(item)}</p>
                      {item.currentDueDate === null ? null : (
                        <p>
                          <strong>Due date:</strong>{" "}
                          {`${new Date(item.currentDueDate).toLocaleDateString()} (${item.dateIsOfficial ? "official tender date" : "internal target date"})`}
                        </p>
                      )}
                      {primaryAction !== null ? (
                        <div className="inline-actions">
                          <Button
                            onClick={() =>
                              openTransitionDialog(
                                item,
                                primaryAction.nextStatus,
                              )
                            }
                            type="button"
                          >
                            {primaryAction.label}
                          </Button>
                        </div>
                      ) : null}
                      <details className="disclosure">
                        <summary>
                          More actions
                          <small>
                            Assignment, internal dates, and secondary updates
                          </small>
                        </summary>
                        <div className="disclosure__body">
                          <div className="inline-actions">
                            <Button
                              onClick={() =>
                                openWorkflowEditDialog(item, "assignee_id")
                              }
                              type="button"
                              variant="secondary"
                            >
                              Assign or unassign
                            </Button>
                            <Button
                              onClick={() =>
                                openWorkflowEditDialog(item, "due_date")
                              }
                              type="button"
                              variant="secondary"
                            >
                              Set internal target date
                            </Button>
                            {["OPEN", "IN_PROGRESS"].includes(item.status) && (
                              <Button
                                onClick={() =>
                                  openTransitionDialog(item, "BLOCKED")
                                }
                                type="button"
                                variant="secondary"
                              >
                                Mark blocked
                              </Button>
                            )}
                            {["OPEN", "IN_PROGRESS", "BLOCKED"].includes(
                              item.status,
                            ) && (
                              <Button
                                onClick={() =>
                                  openTransitionDialog(item, "DISMISSED")
                                }
                                type="button"
                                variant="secondary"
                              >
                                Dismiss with rationale
                              </Button>
                            )}
                            {["RESOLVED", "DISMISSED"].includes(
                              item.status,
                            ) && (
                              <Button
                                onClick={() =>
                                  openTransitionDialog(item, "OPEN")
                                }
                                type="button"
                                variant="secondary"
                              >
                                Reopen
                              </Button>
                            )}
                          </div>
                        </div>
                      </details>
                    </article>
                  );
                })
              )}
            </>
          )}
        </>
      )}
      {transitionDialog !== null && transitionCopy !== null && (
        <Modal label={transitionCopy.title} onClose={resetDialogState}>
          <div className="workspace-section__header">
            <div>
              <h2>{transitionCopy.title}</h2>
              <p>{sanitizeChecklistCopy(transitionDialog.item.currentTitle)}</p>
            </div>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submitTransition();
            }}
          >
            {transitionDialog.nextStatus === "BLOCKED" && (
              <label>
                Why is it blocked?
                <Textarea
                  autoFocus
                  maxLength={1_000}
                  onChange={(event) => setBlockedReason(event.target.value)}
                  rows={4}
                  value={blockedReason}
                />
              </label>
            )}
            <label>
              Rationale
              <Textarea
                autoFocus={transitionDialog.nextStatus !== "BLOCKED"}
                maxLength={1_000}
                onChange={(event) => setTransitionRationale(event.target.value)}
                rows={5}
                value={transitionRationale}
              />
            </label>
            <p>{transitionCopy.helperText}</p>
            {dialogError !== "" && <FormMessage>{dialogError}</FormMessage>}
            <div className="inline-actions">
              <Button
                onClick={resetDialogState}
                type="button"
                variant="secondary"
              >
                Cancel
              </Button>
              <Button type="submit">{transitionCopy.confirmLabel}</Button>
            </div>
          </form>
        </Modal>
      )}
      {workflowEditDialog !== null && workflowCopy !== null && (
        <Modal label={workflowCopy.title} onClose={resetDialogState}>
          <div className="workspace-section__header">
            <div>
              <h2>{workflowCopy.title}</h2>
              <p>
                {sanitizeChecklistCopy(workflowEditDialog.item.currentTitle)}
              </p>
            </div>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submitWorkflowEdit();
            }}
          >
            <label>
              {workflowCopy.fieldLabel}
              <Input
                autoFocus
                onChange={(event) => setWorkflowValue(event.target.value)}
                type={workflowCopy.valueMode}
                value={workflowValue}
              />
            </label>
            <p>{workflowCopy.fieldHelper}</p>
            <label>
              Rationale
              <Textarea
                maxLength={1_000}
                onChange={(event) => setWorkflowRationale(event.target.value)}
                rows={5}
                value={workflowRationale}
              />
            </label>
            <p>Enter at least 10 characters.</p>
            {dialogError !== "" && <FormMessage>{dialogError}</FormMessage>}
            <div className="inline-actions">
              <Button
                onClick={resetDialogState}
                type="button"
                variant="secondary"
              >
                Cancel
              </Button>
              <Button type="submit">Save</Button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
