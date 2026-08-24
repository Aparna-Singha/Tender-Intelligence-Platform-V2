"use client";

import { useEffect, useMemo, useState, type FormEvent, type JSX } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  humanizeEnum,
} from "@tender/ui";
import { apiRequest, formatApiError } from "../lib/api";
import { RationaleDialog } from "./rationale-dialog";

interface Issue {
  code: string;
  treatment:
    | "HARD_GENERATION_BLOCKER"
    | "PACKAGE_WARNING"
    | "REVIEW_BLOCKER"
    | "DOWNLOAD_BLOCKER";
}

interface Preflight {
  active_run: { id: string } | null;
  eligible_independent_approver_exists: boolean;
  hard_prerequisites_pass: boolean;
  issues: readonly Issue[];
  qualifying_export_template_version_id: string | null;
  transactional_revalidation_required: true;
}

interface PackageRun {
  artifact_id: string | null;
  created_at: string;
  failure_code: string | null;
  freshness: "CURRENT" | "STALE" | "INVALIDATED";
  generation_status: string;
  id: string;
  input_fingerprint: string;
  is_current: boolean;
  requested_by: { display_name: string; role_at_action: string };
  review_status: string;
  review_version?: number;
}

interface History {
  items: readonly PackageRun[];
}

interface Reviews {
  items: readonly {
    actor: { display_name: string; role_at_action: string };
    comment: string;
    created_at: string;
    id: string;
    outcome: string;
    review_version: number;
  }[];
}

interface Decisions {
  items: readonly {
    actor: { display_name: string; role_at_action: string };
    created_at: string;
    id: string;
    outcome: string;
    rationale: string;
    revoked_at: string | null;
    superseded_at: string | null;
  }[];
}

type NavigationStage = "draft" | "files" | "readiness" | "risks";

type PackageDialogState =
  | { readonly kind: "generate" }
  | {
      readonly kind: "decision";
      readonly outcome: "APPROVED_FOR_CONTROLLED_DOWNLOAD" | "REJECTED";
    }
  | { readonly kind: "revoke" }
  | null;

const base = (organisationId: string, tenderId: string): string =>
  `/organisations/${organisationId}/tenders/${tenderId}`;
const idempotencyKey = (): string => crypto.randomUUID();

function reviewPackageIssueCopy(issue: Issue): {
  readonly detail: string;
  readonly label: string;
} {
  switch (issue.code) {
    case "READINESS_RUN_NOT_CURRENT":
    case "INPUT_FINGERPRINT_STALE":
      return {
        detail:
          "Refresh the latest final review so the package uses current records.",
        label: "Final review needs refresh",
      };
    case "READINESS_RUN_NOT_COMPLETE":
      return {
        detail: "Finish the final review before creating a review package.",
        label: "Final review is not complete",
      };
    case "READINESS_RUN_INVALIDATED":
      return {
        detail: "The latest final review is out of date and must be run again.",
        label: "Final review is out of date",
      };
    case "FINAL_RISK_RUN_NOT_CURRENT":
    case "FINAL_RISK_RUN_NOT_COMPLETE":
      return {
        detail:
          "Finish the linked risk review before creating or approving the package.",
        label: "Linked risk review needs attention",
      };
    case "PROCEED_DECISION_NOT_CURRENT":
    case "PROCEED_DECISION_SUPERSEDED":
      return {
        detail:
          "Record a current Proceed decision from final review before continuing.",
        label: "Proceed decision is not current",
      };
    case "APPROVED_DRAFT_NOT_PINNED":
      return {
        detail:
          "Approve one current proposal draft version before creating the package.",
        label: "Proposal draft needs approval",
      };
    case "EXPORT_TEMPLATE_NOT_APPROVED":
      return {
        detail:
          "A current approved package template is required before generation can start.",
        label: "Package template needs attention",
      };
    case "SOURCE_HASH_UNAVAILABLE":
      return {
        detail:
          "Source verification is incomplete, so controlled download cannot be enabled yet.",
        label: "Source verification is incomplete",
      };
    case "ACTIVE_PACKAGE_ALREADY_EXISTS":
      return {
        detail:
          "A current package already exists. Open it instead of creating another one.",
        label: "A current review package already exists",
      };
    default:
      return {
        detail: humanizeEnum(issue.code),
        label: humanizeEnum(issue.treatment),
      };
  }
}

function reviewPackageIssueGroup(issue: Issue): {
  readonly actionLabel?: string;
  readonly detail: string;
  readonly key: string;
  readonly label: string;
  readonly stage?: NavigationStage;
} {
  switch (issue.code) {
    case "READINESS_RUN_NOT_CURRENT":
    case "INPUT_FINGERPRINT_STALE":
    case "READINESS_RUN_NOT_COMPLETE":
    case "READINESS_RUN_INVALIDATED":
      return {
        actionLabel: "Open final review",
        detail:
          "Refresh or rerun the latest final review so this package uses current records.",
        key: "final-review",
        label: "Final review needs attention",
        stage: "readiness",
      };
    case "FINAL_RISK_RUN_NOT_CURRENT":
    case "FINAL_RISK_RUN_NOT_COMPLETE":
      return {
        actionLabel: "Open risk review",
        detail:
          "Complete the linked risk review before creating or approving the package.",
        key: "risk-review",
        label: "Risk review needs attention",
        stage: "risks",
      };
    case "PROCEED_DECISION_NOT_CURRENT":
    case "PROCEED_DECISION_SUPERSEDED":
      return {
        actionLabel: "Open final review",
        detail:
          "Record a current Proceed decision from final review before continuing.",
        key: "proceed-decision",
        label: "A current Proceed decision is required",
        stage: "readiness",
      };
    case "APPROVED_DRAFT_NOT_PINNED":
      return {
        actionLabel: "Open draft",
        detail:
          "Approve one current proposal draft version before creating the package.",
        key: "draft-approval",
        label: "Proposal draft needs approval",
        stage: "draft",
      };
    case "EXPORT_TEMPLATE_NOT_APPROVED":
      return {
        detail:
          "A current approved package template is required before generation can start.",
        key: "template-approval",
        label: "Package template needs attention",
      };
    case "SOURCE_HASH_UNAVAILABLE":
      return {
        actionLabel: "Review tender files",
        detail:
          "Finish source verification before controlled download can be enabled.",
        key: "source-verification",
        label: "Source verification is incomplete",
        stage: "files",
      };
    case "ACTIVE_PACKAGE_ALREADY_EXISTS":
      return {
        detail:
          "A current package already exists. Open it instead of creating another one.",
        key: "current-package",
        label: "A current review package already exists",
      };
    default: {
      const copy = reviewPackageIssueCopy(issue);
      return {
        detail: copy.detail,
        key: `${issue.treatment}:${issue.code}`,
        label: copy.label,
      };
    }
  }
}

function isDownstreamPackageIssue(
  issue: ReturnType<typeof reviewPackageIssueGroup>,
): boolean {
  return issue.key === "source-verification";
}

function freshnessLabel(freshness: PackageRun["freshness"]): string {
  switch (freshness) {
    case "CURRENT":
      return "Current";
    case "STALE":
      return "Out of date";
    case "INVALIDATED":
      return "Superseded";
  }
}

function reviewPackageState(run: PackageRun | null): {
  readonly detail: string;
  readonly label: string;
} {
  if (run === null)
    return {
      detail: "Create the first review package after final review is ready.",
      label: "No review package yet",
    };
  if (run.review_status === "APPROVED")
    return {
      detail:
        "Controlled download can be authorised while this package stays current.",
      label: "Controlled download approved",
    };
  if (run.review_status === "REJECTED")
    return {
      detail:
        "A corrected package must be created before controlled download can continue.",
      label: "Changes required",
    };
  if (run.review_status === "IN_REVIEW")
    return {
      detail:
        "Human review is in progress before any controlled download decision.",
      label: "In review",
    };
  if (run.generation_status === "GENERATED")
    return {
      detail:
        "The package is ready for human review and controlled download approval.",
      label: "Ready for review",
    };
  return {
    detail: "Package creation is still running or needs attention.",
    label: humanizeEnum(run.generation_status),
  };
}

export function ControlledReviewPackageWorkspace({
  onNavigateStage,
  organisationId,
  tenderId,
  versionId,
}: {
  readonly onNavigateStage?: (stage: NavigationStage) => void;
  readonly organisationId: string;
  readonly tenderId: string;
  readonly versionId: string;
}): JSX.Element {
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [history, setHistory] = useState<readonly PackageRun[]>([]);
  const [selected, setSelected] = useState<PackageRun | null>(null);
  const [reviews, setReviews] = useState<Reviews["items"]>([]);
  const [decisions, setDecisions] = useState<Decisions["items"]>([]);
  const [dialog, setDialog] = useState<PackageDialogState>(null);
  const [message, setMessage] = useState("Loading controlled-review status...");
  const root = base(organisationId, tenderId);

  async function load(preferredId?: string): Promise<void> {
    try {
      const [nextPreflight, nextHistory] = await Promise.all([
        apiRequest<Preflight>(`${root}/controlled-review-packages/preflight`),
        apiRequest<History>(
          `${root}/versions/${versionId}/controlled-review-packages`,
        ),
      ]);
      const id =
        preferredId ??
        selected?.id ??
        nextPreflight.active_run?.id ??
        nextHistory.items[0]?.id;
      const detail =
        id === undefined
          ? null
          : await apiRequest<PackageRun>(
              `${root}/controlled-review-packages/${id}`,
            );
      const reviewHistory =
        id === undefined
          ? { items: [] }
          : await apiRequest<Reviews>(
              `${root}/controlled-review-packages/${id}/reviews`,
            );
      const decisionHistory =
        id === undefined
          ? { items: [] }
          : await apiRequest<Decisions>(
              `${root}/controlled-review-packages/${id}/decisions`,
            );
      setPreflight(nextPreflight);
      setHistory(nextHistory.items);
      setSelected(detail);
      setReviews(reviewHistory.items);
      setDecisions(decisionHistory.items);
      setMessage("");
    } catch (error) {
      setMessage(
        formatApiError(error, "Unable to load controlled-review packages."),
      );
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5_000);
    return () => window.clearInterval(timer);
  }, [organisationId, tenderId, versionId]);

  async function mutate(
    path: string,
    method: string,
    body: unknown,
    success: string,
  ): Promise<void> {
    try {
      const result = await apiRequest<{ package_id?: string }>(path, {
        body: JSON.stringify(body),
        method,
      });
      setMessage(success);
      await load(result.package_id);
    } catch (error) {
      setMessage(
        formatApiError(
          error,
          "The controlled-review action could not be completed.",
        ),
      );
    }
  }

  async function generate(): Promise<void> {
    await mutate(
      `${root}/controlled-review-packages`,
      "POST",
      { idempotency_key: idempotencyKey() },
      "Generation requested. Transactional prerequisites were revalidated.",
    );
  }

  async function submitReview(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (selected === null) return;

    const data = new FormData(event.currentTarget);
    await mutate(
      `${root}/controlled-review-packages/${selected.id}/reviews`,
      "POST",
      {
        comment: data.get("comment"),
        expected_review_version: reviews.at(-1)?.review_version ?? 0,
        outcome: "REVIEW_COMPLETE",
      },
      "Append-only review recorded.",
    );
  }

  async function submitRationale(rationale: string): Promise<void> {
    if (selected === null) return;
    if (dialog === null) return;

    if (dialog.kind === "decision") {
      setDialog(null);
      await mutate(
        `${root}/controlled-review-packages/${selected.id}/decisions`,
        "POST",
        {
          expected_fingerprint: selected.input_fingerprint,
          expected_review_version: reviews.at(-1)?.review_version ?? 0,
          outcome: dialog.outcome,
          rationale,
        },
        dialog.outcome === "REJECTED"
          ? "Package rejected; regenerate after correction."
          : "Approved for controlled download.",
      );
      return;
    }

    if (dialog.kind === "revoke") {
      setDialog(null);
      await mutate(
        `${root}/controlled-review-packages/${selected.id}/revocations`,
        "POST",
        {
          rationale,
          reason: "APPROVAL_WITHDRAWN",
        },
        "Controlled-download approval revoked.",
      );
    }
  }

  async function download(): Promise<void> {
    if (selected?.artifact_id === null || selected === null) return;

    try {
      const grant = await apiRequest<{ download_path: string }>(
        `${root}/controlled-review-packages/${selected.id}/download-grants`,
        {
          body: JSON.stringify({ artifact_id: selected.artifact_id }),
          method: "POST",
        },
      );
      const redemption = await apiRequest<{ download_url: string }>(
        grant.download_path,
      );
      window.location.assign(redemption.download_url);
    } catch (error) {
      setMessage(
        formatApiError(
          error,
          "The controlled download could not be authorised.",
        ),
      );
    }
  }

  const grouped = (treatment: Issue["treatment"]): readonly Issue[] =>
    preflight?.issues.filter((issue) => issue.treatment === treatment) ?? [];
  const state = reviewPackageState(selected);
  const visibleIssues = useMemo(() => {
    const deduplicated = new Map<
      string,
      ReturnType<typeof reviewPackageIssueGroup>
    >();
    for (const issue of preflight?.issues ?? []) {
      const groupedIssue = reviewPackageIssueGroup(issue);
      if (!deduplicated.has(groupedIssue.key))
        deduplicated.set(groupedIssue.key, groupedIssue);
    }
    return [...deduplicated.values()];
  }, [preflight?.issues]);
  const immediateIssues = visibleIssues.filter(
    (issue) => !isDownstreamPackageIssue(issue),
  );
  const nextStageIssues = visibleIssues.filter(isDownstreamPackageIssue);
  const controlledDownloadStatus =
    selected?.review_status === "APPROVED" && selected.freshness === "CURRENT"
      ? "Available"
      : selected?.review_status === "REVOKED"
        ? "Revoked"
        : selected?.review_status === "SUPERSEDED" ||
            selected?.freshness === "INVALIDATED"
          ? "Superseded"
          : "Unavailable until review and approval are complete.";

  return (
    <section aria-labelledby="controlled-package-heading">
      <h2 id="controlled-package-heading">Controlled download</h2>
      <Alert tone="warning">
        <p>
          Review packages are for authorised human review only. Generation and
          controlled-download approval do not approve or perform external
          submission, certify compliance, eligibility, completeness, or bid
          success.
        </p>
      </Alert>
      <p aria-live="polite">{message}</p>
      {preflight === null ? (
        <p>Loading informational preflight...</p>
      ) : (
        <>
          <Card>
            <h3>
              {preflight.hard_prerequisites_pass
                ? "Ready to create review package"
                : "Before you can create the review package"}
            </h3>
            <p>
              {preflight.hard_prerequisites_pass
                ? "The latest final review records allow package creation."
                : "Resolve the current stage blockers below before package creation can continue."}{" "}
              The start transaction always revalidates authority.
            </p>
            <p>
              Controlled download: <strong>{controlledDownloadStatus}</strong>
            </p>
            <p>
              Independent approver:{" "}
              {preflight.eligible_independent_approver_exists
                ? "available"
                : "not available"}
            </p>
            <p>
              <strong>{state.label}</strong> · {state.detail}
            </p>
            {visibleIssues.length === 0 ? (
              <p>No package actions or warnings are currently reported.</p>
            ) : (
              <>
                {immediateIssues.length > 0 ? (
                  <>
                    <h4>Current blockers</h4>
                    <ol>
                      {immediateIssues.map((issue) => (
                        <li key={issue.key}>
                          <strong>{issue.label}</strong>
                          <p>{issue.detail}</p>
                          {issue.stage !== undefined &&
                          issue.actionLabel !== undefined &&
                          onNavigateStage !== undefined ? (
                            <Button
                              onClick={() => onNavigateStage(issue.stage!)}
                              type="button"
                              variant="quiet"
                            >
                              {issue.actionLabel}
                            </Button>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                  </>
                ) : null}
                {nextStageIssues.length > 0 ? (
                  <>
                    <h4>Next stage</h4>
                    <p>
                      These checks matter after the package is created and moves
                      into review or controlled download.
                    </p>
                    <ul>
                      {nextStageIssues.map((issue) => (
                        <li key={issue.key}>
                          <strong>{issue.label}</strong>
                          <p>{issue.detail}</p>
                          {issue.stage !== undefined &&
                          issue.actionLabel !== undefined &&
                          onNavigateStage !== undefined ? (
                            <Button
                              onClick={() => onNavigateStage(issue.stage!)}
                              type="button"
                              variant="quiet"
                            >
                              {issue.actionLabel}
                            </Button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </>
            )}
            <p>
              Approval for controlled download does not mean approval to submit
              the bid.
            </p>
            <Button
              disabled={!preflight.hard_prerequisites_pass}
              onClick={() => setDialog({ kind: "generate" })}
            >
              Create review package
            </Button>
          </Card>
        </>
      )}
      {selected !== null && (
        <Card>
          <h3>Current review package</h3>
          <p>
            <Badge>{state.label}</Badge>{" "}
            <Badge>{freshnessLabel(selected.freshness)}</Badge>{" "}
            <Badge>{humanizeEnum(selected.review_status)}</Badge>{" "}
            {selected.is_current && (
              <Badge tone="success">Current package</Badge>
            )}
          </p>
          <p>
            Requested by {selected.requested_by.display_name} (
            {humanizeEnum(selected.requested_by.role_at_action)} at action).
          </p>
          <p>
            Controlled download: <strong>{controlledDownloadStatus}</strong>
          </p>
          {selected.failure_code !== null && (
            <Alert tone="danger">
              <p>
                Package generation stopped safely:{" "}
                {humanizeEnum(selected.failure_code)}
              </p>
            </Alert>
          )}
          {(["QUEUED", "PROCESSING"] as const).includes(
            selected.generation_status as "QUEUED",
          ) && (
            <Button
              onClick={() =>
                void mutate(
                  `${root}/controlled-review-packages/${selected.id}`,
                  "DELETE",
                  {
                    rationale:
                      "Cancellation requested during controlled package generation.",
                  },
                  "Cancellation requested; the worker will stop after observing it.",
                )
              }
            >
              Request cancellation
            </Button>
          )}
          {(["FAILED", "CANCELLED", "INVALIDATED"] as const).includes(
            selected.generation_status as "FAILED",
          ) && (
            <Button
              onClick={() =>
                void mutate(
                  `${root}/controlled-review-packages/${selected.id}/retry`,
                  "POST",
                  {
                    idempotency_key: idempotencyKey(),
                    rationale:
                      "Create a new immutable package run after the prior terminal result.",
                  },
                  "A new immutable retry run was requested.",
                )
              }
            >
              Create a corrected package
            </Button>
          )}
          {selected.generation_status === "GENERATED" && (
            <>
              <form onSubmit={(event) => void submitReview(event)}>
                <label>
                  Append-only review comment
                  <textarea
                    minLength={1}
                    maxLength={2000}
                    name="comment"
                    required
                  />
                </label>
                <Button type="submit">Record review complete</Button>
              </form>
              <Button
                onClick={() =>
                  setDialog({
                    kind: "decision",
                    outcome: "APPROVED_FOR_CONTROLLED_DOWNLOAD",
                  })
                }
              >
                Approve for controlled download
              </Button>
              <Button
                onClick={() =>
                  setDialog({ kind: "decision", outcome: "REJECTED" })
                }
                variant="quiet"
              >
                Reject package
              </Button>
              {selected.review_status === "APPROVED" && (
                <Button
                  onClick={() => setDialog({ kind: "revoke" })}
                  variant="secondary"
                >
                  Revoke controlled download
                </Button>
              )}
              {selected.review_status === "APPROVED" && (
                <Button onClick={() => void download()}>
                  Authorise one-minute download
                </Button>
              )}
            </>
          )}
        </Card>
      )}
      <details className="disclosure">
        <summary>
          Advanced readiness and audit details
          <small>Package history, warnings, and review records</small>
        </summary>
        <div className="disclosure__body">
          {(
            [
              "HARD_GENERATION_BLOCKER",
              "PACKAGE_WARNING",
              "REVIEW_BLOCKER",
              "DOWNLOAD_BLOCKER",
            ] as const
          ).map((treatment) => (
            <div key={treatment}>
              <h3>{humanizeEnum(treatment)}</h3>
              {grouped(treatment).length === 0 ? (
                <p>None reported.</p>
              ) : (
                <ul>
                  {grouped(treatment).map((issue) => (
                    <li key={`${treatment}:${issue.code}`}>
                      {humanizeEnum(issue.code)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          <h3>Package history</h3>
          {history.length === 0 ? (
            <EmptyState
              title="No review packages"
              description="Create the first review package after the latest final review is ready."
            />
          ) : (
            <ul>
              {history.map((run) => (
                <li key={run.id}>
                  <button onClick={() => void load(run.id)} type="button">
                    {new Date(run.created_at).toLocaleString()} -{" "}
                    {humanizeEnum(run.generation_status)} -{" "}
                    {humanizeEnum(run.review_status)}
                    {run.is_current ? " - Current package" : ""}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {selected !== null && (
            <>
              <h3>Selected package details</h3>
              <p>
                Generation status: {humanizeEnum(selected.generation_status)}
              </p>
              <p>Freshness: {freshnessLabel(selected.freshness)}</p>
              <p>Review status: {humanizeEnum(selected.review_status)}</p>
              <p>
                Request fingerprint:{" "}
                <code>{selected.input_fingerprint.slice(0, 16)}...</code>
              </p>
              <h4>Review history</h4>
              {reviews.length === 0 ? (
                <p>No review history recorded yet.</p>
              ) : (
                reviews.map((review) => (
                  <p key={review.id}>
                    {review.actor.display_name} (
                    {humanizeEnum(review.actor.role_at_action)}) -{" "}
                    {humanizeEnum(review.outcome)} - {review.comment}
                  </p>
                ))
              )}
              <h4>Approval history</h4>
              {decisions.length === 0 ? (
                <p>No approval decisions have been recorded yet.</p>
              ) : (
                decisions.map((decision) => (
                  <p key={decision.id}>
                    {decision.actor.display_name} (
                    {humanizeEnum(decision.actor.role_at_action)}) -{" "}
                    {humanizeEnum(decision.outcome)}
                    {decision.revoked_at === null ? "" : " - Revoked"} -{" "}
                    {decision.rationale}
                  </p>
                ))
              )}
            </>
          )}
        </div>
      </details>
      {dialog?.kind === "generate" && (
        <Modal label="Create review package" onClose={() => setDialog(null)}>
          <div className="workspace-section__header">
            <div>
              <h2>Create review package</h2>
              <p>
                Generate an immutable package for controlled human review only.
                This does not submit the tender.
              </p>
            </div>
          </div>
          <div className="inline-actions">
            <Button
              onClick={() => setDialog(null)}
              type="button"
              variant="secondary"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                setDialog(null);
                void generate();
              }}
              type="button"
            >
              Create review package
            </Button>
          </div>
        </Modal>
      )}
      {dialog?.kind === "decision" && (
        <RationaleDialog
          confirmLabel={
            dialog.outcome === "REJECTED"
              ? "Reject package"
              : "Approve for controlled download"
          }
          description={
            dialog.outcome === "REJECTED"
              ? "Record why this package needs correction before a new immutable package is created."
              : "Record the independent approval rationale for controlled download."
          }
          minLength={1}
          onClose={() => setDialog(null)}
          onConfirm={submitRationale}
          title={
            dialog.outcome === "REJECTED"
              ? "Reject package"
              : "Approve for controlled download"
          }
        />
      )}
      {dialog?.kind === "revoke" && (
        <RationaleDialog
          confirmLabel="Revoke controlled download"
          description="Record why controlled-download approval is being withdrawn."
          minLength={1}
          onClose={() => setDialog(null)}
          onConfirm={submitRationale}
          title="Revoke controlled download"
        />
      )}
    </section>
  );
}
