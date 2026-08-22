"use client";

import { useEffect, useRef, useState, type FormEvent, type JSX } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Progress,
  humanizeEnum,
} from "@tender/ui";
import { PublicApiError, apiRequest } from "../lib/api";

type Treatment =
  "BLOCKER" | "HUMAN_DISPOSITION_REQUIRED" | "WARNING" | "INFORMATIONAL";
type Disposition =
  | "PROCEED_TO_CONTROLLED_EXPORT_REVIEW"
  | "HOLD_FOR_REMEDIATION"
  | "STOP_PURSUIT";
type Stage = "extraction" | "risks" | "evidence" | "checklist" | "draft";

interface Preflight {
  eligible_independent_decision_actor_exists: boolean;
  evaluated_at: string;
  hard_prerequisites_pass: boolean;
  informational_only: true;
  policy_version: string;
  prerequisite_denials: readonly { code: string; prerequisite: string }[];
  qualifying_consolidated_draft_version_id: string | null;
  tender_version_id: string;
  transactional_revalidation_required: true;
}
interface Run {
  completed_at: string | null;
  created_at: string;
  current_disposition: { disposition: Disposition; rationale: string } | null;
  disposition_concurrency_token: string;
  failure_code: string | null;
  final_risk_run_id: string;
  final_risk_status: string;
  finding_counts: {
    blockers: number;
    human_disposition_required: number;
    informational: number;
    warnings: number;
  };
  id: string;
  invalidated: boolean;
  is_current: boolean;
  policy_version: string;
  stale: boolean;
  started_at: string | null;
  status: string;
  tender_version_id: string;
  updated_at: string;
}
interface Finding {
  created_at: string;
  current_review_version: number;
  explanation: string;
  id: string;
  lifecycle_state: string;
  materiality: string | null;
  provenance: readonly { id: string; source_class: string }[];
  provenance_valid: boolean;
  review_state: string;
  review_summary: {
    acknowledgement_recorded: boolean;
    latest_action: string | null;
    reviewed_at: string | null;
    reviewer: { display_name: string } | null;
  };
  rule_code: string;
  title: string;
  treatment: Treatment;
}
interface Review {
  acknowledgement_recorded: boolean;
  action: string;
  actor: { display_name: string };
  created_at: string;
  id: string;
  rationale: string;
  review_version: number;
}
interface ProgressState {
  occurred_at: string;
  progress_percent: number;
  stage: string;
  status: string;
}
interface RiskFinding {
  confidence: string;
  explanation: string;
  findingStatus: string;
  id: string;
  materiality: string;
  reviewState: string;
  severity: string;
  title: string;
}
interface Membership {
  organisation: { id: string };
  role: string;
}

const treatments: readonly Treatment[] = [
  "BLOCKER",
  "HUMAN_DISPOSITION_REQUIRED",
  "WARNING",
  "INFORMATIONAL",
];
const dispositionLabels: Record<Disposition, string> = {
  PROCEED_TO_CONTROLLED_EXPORT_REVIEW: "Proceed to controlled export review",
  HOLD_FOR_REMEDIATION: "Hold for remediation",
  STOP_PURSUIT: "Stop pursuit",
};
const sourceLabels: Record<string, { label: string; stage: Stage }> = {
  EXTRACTION_CITATION: { label: "Extraction citation", stage: "extraction" },
  RISK_FINDING: { label: "Risk finding", stage: "risks" },
  ELIGIBILITY_ASSESSMENT: {
    label: "Eligibility assessment",
    stage: "evidence",
  },
  EVIDENCE_FACT_VERSION: { label: "Evidence record", stage: "evidence" },
  EVIDENCE_CITATION: { label: "Evidence citation", stage: "evidence" },
  CHECKLIST_ITEM: { label: "Checklist item", stage: "checklist" },
  DRAFT_VERSION: { label: "Draft version", stage: "draft" },
  DRAFT_CLAIM: { label: "Draft claim", stage: "draft" },
  DRAFT_CITATION: { label: "Draft citation", stage: "draft" },
  DRAFT_PLACEHOLDER: { label: "Draft placeholder", stage: "draft" },
  HUMAN_REVIEW_RECORD: { label: "Human review record", stage: "draft" },
};
const prerequisiteStages: Partial<Record<string, Stage>> = {
  EXTRACTION: "extraction",
  EARLY_RISK: "risks",
  ELIGIBILITY_ASSESSMENT: "evidence",
  EVIDENCE_SNAPSHOT: "evidence",
  CHECKLIST_GENERATION: "checklist",
  CONSOLIDATED_DRAFT: "draft",
};
const safeErrors: Record<string, string> = {
  FINAL_READINESS_PREREQUISITES_NOT_CURRENT:
    "Current authoritative prerequisites do not permit starting this audit.",
  FINAL_READINESS_ALREADY_ACTIVE: "A final-readiness audit is already active.",
  FINAL_READINESS_RUN_STALE:
    "Authoritative inputs changed. This run is historical and cannot be changed.",
  FINAL_READINESS_RUN_INVALIDATED:
    "This run was invalidated and cannot be changed.",
  FINAL_READINESS_RUN_NOT_COMPLETE:
    "The run is not in a state that permits this action.",
  FINAL_READINESS_FINAL_RISK_NOT_COMPLETE:
    "The linked final-risk analysis is not complete.",
  FINAL_READINESS_DECISION_BLOCKED:
    "The decision is blocked by unresolved findings, acknowledgements, provenance, or concurrent changes.",
  FINAL_READINESS_SEPARATION_OF_DUTIES_REQUIRED:
    "An eligible independent reviewer is required. The requester or draft creator cannot decide.",
  FINAL_READINESS_SOURCE_INVALID:
    "Authoritative provenance is unavailable or invalid.",
  FINAL_READINESS_RUN_NOT_RETRYABLE:
    "This run cannot be retried in its current state.",
  FINAL_READINESS_IDEMPOTENCY_CONFLICT:
    "This request conflicts with an earlier operation. Refresh before trying again.",
  NETWORK_ERROR:
    "The service could not be reached. Your displayed data may be out of date.",
};

function when(value: string | null): string {
  return value === null ? "Not recorded" : new Date(value).toLocaleString();
}
function safeMessage(error: unknown, fallback: string): string {
  if (!(error instanceof PublicApiError)) return fallback;
  const message =
    safeErrors[error.code] ??
    (error.status === 403
      ? "You do not have permission to complete this action."
      : fallback);
  return error.requestId === undefined
    ? message
    : `${message} Request ID: ${error.requestId}`;
}
function formText(values: FormData, name: string): string {
  const value = values.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export function FinalReadinessWorkspace({
  organisationId,
  tenderId,
  versionId,
  onNavigateStage,
}: {
  readonly organisationId: string;
  readonly tenderId: string;
  readonly versionId: string;
  readonly onNavigateStage: (stage: Stage) => void;
}): JSX.Element {
  const base = `/organisations/${organisationId}/tenders/${tenderId}`;
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [runs, setRuns] = useState<readonly Run[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [findings, setFindings] = useState<readonly Finding[]>([]);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [riskFindings, setRiskFindings] = useState<readonly RiskFinding[]>([]);
  const [role, setRole] = useState("");
  const [filter, setFilter] = useState<Treatment | "ALL">("ALL");
  const [message, setMessage] = useState("Loading final-readiness review…");
  const [reviewFinding, setReviewFinding] = useState<Finding | null>(null);
  const [reviews, setReviews] = useState<readonly Review[]>([]);
  const [confirming, setConfirming] = useState<Disposition | null>(null);
  const reviewTrigger = useRef<HTMLButtonElement | null>(null);
  const decisionTrigger = useRef<HTMLButtonElement | null>(null);
  const selectedRun = runs.find(({ id }) => id === selectedRunId) ?? null;
  const canOperate = [
    "OWNER",
    "ADMIN",
    "TENDER_EXECUTIVE",
    "CONSULTANT",
  ].includes(role);
  const canReview = ["OWNER", "ADMIN", "REVIEWER"].includes(role);

  async function loadOverview(): Promise<void> {
    try {
      const [nextPreflight, current, history, memberships] = await Promise.all([
        apiRequest<Preflight>(`${base}/final-readiness/preflight`),
        apiRequest<{ run: Run | null }>(
          `${base}/versions/${versionId}/final-readiness/current`,
        ),
        apiRequest<{ items: readonly Run[]; next_cursor: string | null }>(
          `${base}/versions/${versionId}/final-readiness?limit=25`,
        ),
        apiRequest<readonly Membership[]>("/organisations"),
      ]);
      const all =
        current.run === null
          ? history.items
          : [
              current.run,
              ...history.items.filter(({ id }) => id !== current.run?.id),
            ];
      setPreflight(nextPreflight);
      setRuns(all);
      setHistoryCursor(history.next_cursor);
      setSelectedRunId((value) =>
        value === "" ? (current.run?.id ?? all[0]?.id ?? "") : value,
      );
      setRole(
        memberships.find(
          ({ organisation }) => organisation.id === organisationId,
        )?.role ?? "",
      );
      setMessage("");
    } catch (error) {
      setMessage(
        safeMessage(error, "Final-readiness information could not be loaded."),
      );
    }
  }
  async function loadRun(runId: string): Promise<void> {
    if (runId === "") {
      setFindings([]);
      setProgress(null);
      setRiskFindings([]);
      return;
    }
    try {
      const runDetail = runs.find(({ id }) => id === runId);
      const [detail, list, nextProgress, nextRiskFindings] = await Promise.all([
        apiRequest<Run>(`${base}/final-readiness/${runId}/events`),
        apiRequest<{ items: readonly Finding[] }>(
          `${base}/final-readiness/${runId}/findings?limit=100`,
        ),
        apiRequest<ProgressState>(`${base}/final-readiness/${runId}`),
        runDetail === undefined
          ? Promise.resolve([])
          : apiRequest<readonly RiskFinding[]>(
              `${base}/risk-analyses/${runDetail.final_risk_run_id}/findings`,
            ),
      ]);
      setRuns((values) =>
        values.map((value) => (value.id === detail.id ? detail : value)),
      );
      setFindings(list.items);
      setProgress(nextProgress);
      setRiskFindings(nextRiskFindings);
    } catch (error) {
      setMessage(safeMessage(error, "Run details could not be refreshed."));
    }
  }
  async function loadOlderRuns(): Promise<void> {
    if (historyCursor === null) return;
    try {
      const history = await apiRequest<{
        items: readonly Run[];
        next_cursor: string | null;
      }>(
        `${base}/versions/${versionId}/final-readiness?limit=25&cursor=${historyCursor}`,
      );
      setRuns((current) => [
        ...current,
        ...history.items.filter(
          (item) => !current.some(({ id }) => id === item.id),
        ),
      ]);
      setHistoryCursor(history.next_cursor);
    } catch (error) {
      setMessage(safeMessage(error, "Older run history could not be loaded."));
    }
  }
  useEffect(() => {
    void loadOverview();
  }, [organisationId, tenderId, versionId]);
  useEffect(() => {
    void loadRun(selectedRunId);
  }, [selectedRunId]);
  useEffect(() => {
    if (
      selectedRun === null ||
      !["QUEUED", "PROCESSING"].includes(selectedRun.status)
    )
      return;
    const timer = window.setInterval(() => {
      void loadOverview();
      void loadRun(selectedRun.id);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [selectedRun?.id, selectedRun?.status]);

  async function start(): Promise<void> {
    try {
      const result = await apiRequest<{ run_id: string }>(
        `${base}/final-readiness`,
        {
          body: JSON.stringify({ idempotency_key: crypto.randomUUID() }),
          method: "POST",
        },
      );
      setMessage(
        "Final-readiness audit queued. Transactional checks were repeated by the server.",
      );
      await loadOverview();
      setSelectedRunId(result.run_id);
    } catch (error) {
      setMessage(safeMessage(error, "The audit could not be started."));
    }
  }
  async function cancel(): Promise<void> {
    if (selectedRun === null) return;
    const rationale = window.prompt(
      "Why should this run be cancelled? Enter at least 20 characters.",
    );
    if (rationale === null || rationale.trim().length < 20) {
      setMessage(
        "Cancellation requires a rationale of at least 20 characters.",
      );
      return;
    }
    try {
      await apiRequest(`${base}/final-readiness/${selectedRun.id}`, {
        body: JSON.stringify({ rationale, run_id: selectedRun.id }),
        method: "DELETE",
      });
      setMessage("Cancellation requested.");
      await loadOverview();
    } catch (error) {
      setMessage(safeMessage(error, "Cancellation was rejected."));
    }
  }
  async function retry(): Promise<void> {
    if (selectedRun === null) return;
    try {
      const result = await apiRequest<{ run_id: string }>(
        `${base}/final-readiness/${selectedRun.id}/retry`,
        {
          body: JSON.stringify({
            idempotency_key: crypto.randomUUID(),
            run_id: selectedRun.id,
          }),
          method: "POST",
        },
      );
      setMessage(
        "A new audit run was queued after server-side prerequisite checks.",
      );
      await loadOverview();
      setSelectedRunId(result.run_id);
    } catch (error) {
      setMessage(safeMessage(error, "Retry was rejected."));
    }
  }
  async function openReview(
    finding: Finding,
    trigger: HTMLButtonElement,
  ): Promise<void> {
    reviewTrigger.current = trigger;
    setReviewFinding(finding);
    try {
      const history = await apiRequest<{ items: readonly Review[] }>(
        `${base}/final-readiness/${selectedRunId}/findings/${finding.id}/reviews`,
      );
      setReviews(history.items);
    } catch (error) {
      setReviews([]);
      setMessage(safeMessage(error, "Review history could not be loaded."));
    }
  }
  function closeReview(): void {
    setReviewFinding(null);
    setReviews([]);
    window.setTimeout(() => reviewTrigger.current?.focus(), 0);
  }
  async function submitReview(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (reviewFinding === null) return;
    const values = new FormData(event.currentTarget);
    const rationale = formText(values, "rationale");
    if (rationale.length < 20) {
      setMessage("Finding review rationale must be at least 20 characters.");
      return;
    }
    try {
      await apiRequest(
        `${base}/final-readiness/${selectedRunId}/findings/${reviewFinding.id}/reviews`,
        {
          body: JSON.stringify({
            acknowledgement_recorded: values.get("acknowledgement") === "on",
            action: values.get("action"),
            expected_current_review_version:
              reviewFinding.current_review_version,
            rationale,
          }),
          method: "POST",
        },
      );
      const refreshed = await apiRequest<Finding>(
        `${base}/final-readiness/${selectedRunId}/findings/${reviewFinding.id}`,
      );
      setFindings((items) =>
        items.map((item) => (item.id === refreshed.id ? refreshed : item)),
      );
      setReviewFinding(refreshed);
      const history = await apiRequest<{ items: readonly Review[] }>(
        `${base}/final-readiness/${selectedRunId}/findings/${refreshed.id}/reviews`,
      );
      setReviews(history.items);
      setMessage("Finding review appended.");
    } catch (error) {
      setMessage(
        safeMessage(
          error,
          "The review conflicted with newer state. Refresh and try again.",
        ),
      );
    }
  }
  function requestDecision(
    value: Disposition,
    trigger: HTMLButtonElement,
  ): void {
    decisionTrigger.current = trigger;
    setConfirming(value);
  }
  function closeDecision(): void {
    setConfirming(null);
    window.setTimeout(() => decisionTrigger.current?.focus(), 0);
  }
  async function submitDecision(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (selectedRun === null || confirming === null) return;
    const values = new FormData(event.currentTarget);
    const rationale = formText(values, "decision_rationale");
    if (rationale.length < 20) {
      setMessage("Final disposition rationale must be at least 20 characters.");
      return;
    }
    const acknowledgementIds = findings
      .filter(({ treatment }) => treatment === "HUMAN_DISPOSITION_REQUIRED")
      .filter(({ id }) => values.getAll("acknowledgement_ids").includes(id))
      .map(({ id }) => id);
    try {
      await apiRequest(`${base}/final-readiness/${selectedRun.id}/decisions`, {
        body: JSON.stringify({
          acknowledgement_ids: acknowledgementIds,
          disposition: confirming,
          expected_fingerprint: selectedRun.disposition_concurrency_token,
          rationale,
          run_id: selectedRun.id,
        }),
        method: "POST",
      });
      closeDecision();
      setMessage(
        "Final human disposition recorded. This is not approval to submit.",
      );
      await loadOverview();
    } catch (error) {
      setMessage(safeMessage(error, "The final disposition was rejected."));
    }
  }

  const visible =
    filter === "ALL"
      ? findings
      : findings.filter(({ treatment }) => treatment === filter);
  return (
    <section
      aria-labelledby="final-readiness-heading"
      className="stack"
      style={{ minWidth: 0, overflowWrap: "anywhere" }}
    >
      <h2 className="visually-hidden" id="final-readiness-heading">
        Final readiness
      </h2>
      <p style={{ margin: 0, fontSize: "0.78rem" }}>
        A final human check — this aid does not guarantee eligibility,
        compliance, or bid success.
      </p>
      <p aria-live="polite" role="status">
        {message}
      </p>

      <details className="disclosure">
        <summary>Start preflight</summary>
        <div className="disclosure__body">
          <Alert tone="warning">
            <p>
              Independent platform, not affiliated with GeM, CPPP or another
              government portal. Proceed permits only future controlled Phase 12
              export review; it is not approval to submit.
            </p>
          </Alert>
          {preflight === null ? (
            <p>Loading informational prerequisite check…</p>
          ) : (
            <>
              <p>
                <strong>
                  {preflight.hard_prerequisites_pass
                    ? "Hard prerequisites currently pass"
                    : "Hard prerequisites need attention"}
                </strong>
              </p>
              <dl className="detail-list">
                <div>
                  <dt>Current tender version</dt>
                  <dd>{preflight.tender_version_id}</dd>
                </div>
                <div>
                  <dt>Qualifying consolidated draft</dt>
                  <dd>
                    {preflight.qualifying_consolidated_draft_version_id ??
                      "None"}
                  </dd>
                </div>
                <div>
                  <dt>Independent decision actor</dt>
                  <dd>
                    {preflight.eligible_independent_decision_actor_exists
                      ? "Available"
                      : "Not currently available—invite or assign an eligible reviewer"}
                  </dd>
                </div>
                <div>
                  <dt>Policy</dt>
                  <dd>{preflight.policy_version}</dd>
                </div>
                <div>
                  <dt>Evaluated</dt>
                  <dd>{when(preflight.evaluated_at)}</dd>
                </div>
              </dl>
              {preflight.prerequisite_denials.map((denial) => (
                <div
                  key={`${denial.prerequisite}:${denial.code}`}
                  className="warning"
                >
                  <strong>{humanizeEnum(denial.prerequisite)}</strong>:{" "}
                  {humanizeEnum(denial.code)}{" "}
                  {prerequisiteStages[denial.prerequisite] !== undefined && (
                    <Button
                      variant="quiet"
                      onClick={() =>
                        onNavigateStage(
                          prerequisiteStages[denial.prerequisite]!,
                        )
                      }
                    >
                      Open{" "}
                      {humanizeEnum(prerequisiteStages[denial.prerequisite]!)}
                    </Button>
                  )}
                </div>
              ))}
              <p className="disclaimer">
                Informational and race-prone: starting repeats every
                prerequisite check transactionally.
              </p>
              {canOperate && (
                <Button
                  disabled={!preflight.hard_prerequisites_pass}
                  onClick={() => void start()}
                >
                  Start final-readiness audit
                </Button>
              )}
            </>
          )}
        </div>
      </details>

      <details className="disclosure">
        <summary>
          Run history &amp; linked risk analysis
          <small>
            Preflight runs, policy versions, and the linked final-risk analysis
          </small>
        </summary>
        <div className="disclosure__body">
          <Card>
            <h3>Run history</h3>
            {runs.length === 0 ? (
              <EmptyState
                title="No final-readiness run"
                description="Run preflight and start an audit after authoritative prerequisite records are current."
              />
            ) : (
              <>
                <label>
                  Selected current or historical run
                  <select
                    value={selectedRunId}
                    onChange={(event) => setSelectedRunId(event.target.value)}
                  >
                    {runs.map((run) => (
                      <option key={run.id} value={run.id}>
                        {run.is_current ? "Current" : "Historical"} ·{" "}
                        {humanizeEnum(run.status)} · {when(run.created_at)}
                      </option>
                    ))}
                  </select>
                </label>
                {historyCursor !== null && (
                  <Button onClick={() => void loadOlderRuns()} variant="quiet">
                    Load older runs
                  </Button>
                )}
                {selectedRun !== null && (
                  <>
                    <div className="tender-header-meta">
                      <Badge>
                        {selectedRun.is_current ? "Current" : "Historical"}
                      </Badge>
                      <Badge
                        tone={
                          selectedRun.invalidated || selectedRun.stale
                            ? "warning"
                            : "info"
                        }
                      >
                        {selectedRun.invalidated
                          ? "Invalidated"
                          : selectedRun.stale
                            ? "Stale"
                            : humanizeEnum(selectedRun.status)}
                      </Badge>
                    </div>
                    {progress !== null && (
                      <Progress
                        label={`${humanizeEnum(progress.stage)} · ${progress.status}`}
                        value={progress.progress_percent}
                      />
                    )}
                    <dl className="detail-list">
                      <div>
                        <dt>Policy</dt>
                        <dd>{selectedRun.policy_version}</dd>
                      </div>
                      <div>
                        <dt>Created</dt>
                        <dd>{when(selectedRun.created_at)}</dd>
                      </div>
                      <div>
                        <dt>Started</dt>
                        <dd>{when(selectedRun.started_at)}</dd>
                      </div>
                      <div>
                        <dt>Completed</dt>
                        <dd>{when(selectedRun.completed_at)}</dd>
                      </div>
                      <div>
                        <dt>Updated</dt>
                        <dd>{when(selectedRun.updated_at)}</dd>
                      </div>
                      <div>
                        <dt>Safe failure/invalidation</dt>
                        <dd>
                          {selectedRun.failure_code === null
                            ? "None"
                            : humanizeEnum(selectedRun.failure_code)}
                        </dd>
                      </div>
                    </dl>
                    <div className="summary-grid">
                      <Card>
                        <strong>{selectedRun.finding_counts.blockers}</strong>
                        <span> Blockers</span>
                      </Card>
                      <Card>
                        <strong>
                          {
                            selectedRun.finding_counts
                              .human_disposition_required
                          }
                        </strong>
                        <span> Human disposition required</span>
                      </Card>
                      <Card>
                        <strong>{selectedRun.finding_counts.warnings}</strong>
                        <span> Warnings</span>
                      </Card>
                      <Card>
                        <strong>
                          {selectedRun.finding_counts.informational}
                        </strong>
                        <span> Informational</span>
                      </Card>
                    </div>
                    <p>
                      Current human disposition:{" "}
                      {selectedRun.current_disposition === null
                        ? "None recorded"
                        : dispositionLabels[
                            selectedRun.current_disposition.disposition
                          ]}
                    </p>
                    {riskFindings.length === 0 ? (
                      <p>
                        No source-supported final-risk findings are available.
                      </p>
                    ) : (
                      riskFindings.map((risk) => (
                        <article key={risk.id}>
                          <h4>{risk.title}</h4>
                          <p>
                            Severity: {humanizeEnum(risk.severity)} ·
                            Confidence: {humanizeEnum(risk.confidence)} ·
                            Materiality: {humanizeEnum(risk.materiality)}
                          </p>
                          <p>{risk.explanation}</p>
                          <p>
                            {humanizeEnum(risk.findingStatus)} ·{" "}
                            {humanizeEnum(risk.reviewState)}
                          </p>
                        </article>
                      ))
                    )}
                    {canOperate &&
                      ["QUEUED", "PROCESSING"].includes(selectedRun.status) && (
                        <Button onClick={() => void cancel()} variant="quiet">
                          Cancel run
                        </Button>
                      )}
                    {canOperate &&
                      ["FAILED", "CANCELLED"].includes(selectedRun.status) && (
                        <Button onClick={() => void retry()} variant="quiet">
                          Retry as a new run
                        </Button>
                      )}
                  </>
                )}
              </>
            )}
          </Card>

          {selectedRun !== null && (
            <Card>
              <h3>Linked FINAL_READINESS risk analysis</h3>
              <p>
                Status:{" "}
                <strong>{humanizeEnum(selectedRun.final_risk_status)}</strong>
              </p>
              <p>
                Risk severity describes importance; readiness treatment
                describes the workflow action required. A severe risk is not
                automatically proof of ineligibility. Accepted risks remain
                visible and auditable.
              </p>
              <Button variant="quiet" onClick={() => onNavigateStage("risks")}>
                Open risk workspace
              </Button>
            </Card>
          )}
        </div>
      </details>

      {selectedRun !== null && (
        <Card>
          <h3>Readiness findings</h3>
          <div
            className="filter-bar"
            role="group"
            aria-label="Finding treatment filter"
          >
            {["ALL", ...treatments].map((value) => (
              <button
                aria-pressed={filter === value}
                key={value}
                onClick={() => setFilter(value as Treatment | "ALL")}
                type="button"
              >
                {humanizeEnum(value)}
              </button>
            ))}
          </div>
          {visible.length === 0 && <p>No findings in this treatment group.</p>}
          <div className="review-sections">
            {visible.map((finding) => (
              <article key={finding.id} tabIndex={0}>
                <h4>{finding.title}</h4>
                <p>
                  <strong>Treatment: {humanizeEnum(finding.treatment)}</strong>{" "}
                  · Lifecycle: {humanizeEnum(finding.lifecycle_state)} · Review:{" "}
                  {humanizeEnum(finding.review_state)}
                </p>
                <p>{finding.explanation}</p>
                <p style={{ fontSize: "0.76rem" }}>
                  Materiality:{" "}
                  {finding.materiality === null
                    ? "Not applicable"
                    : humanizeEnum(finding.materiality)}
                  {finding.provenance_valid ? "" : " · Provenance needs review"}
                  {" · "}
                  Created: {when(finding.created_at)}
                </p>
                <ul>
                  {finding.provenance.map((source) => {
                    const safe = sourceLabels[source.source_class];
                    return (
                      <li key={`${source.source_class}:${source.id}`}>
                        {safe?.label ?? humanizeEnum(source.source_class)}
                        {safe !== undefined && (
                          <Button
                            variant="quiet"
                            onClick={() => onNavigateStage(safe.stage)}
                          >
                            Open {humanizeEnum(safe.stage)}
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <p>
                  Latest review:{" "}
                  {finding.review_summary.latest_action === null
                    ? "None"
                    : `${humanizeEnum(finding.review_summary.latest_action)} by ${finding.review_summary.reviewer?.display_name ?? "authorised reviewer"}`}
                </p>
                <Button
                  onClick={(event) =>
                    void openReview(finding, event.currentTarget)
                  }
                  variant="quiet"
                >
                  Review history{canReview ? " and action" : ""}
                </Button>
              </article>
            ))}
          </div>
        </Card>
      )}

      {selectedRun !== null &&
        canReview &&
        selectedRun.status === "COMPLETED" &&
        !selectedRun.stale &&
        !selectedRun.invalidated && (
          <Card>
            <h3>Final human disposition</h3>
            <p>
              No option is preselected. Server validation of permission,
              independence, currentness, provenance, blockers and
              acknowledgements remains authoritative.
            </p>
            <div className="stack">
              {(Object.keys(dispositionLabels) as Disposition[]).map(
                (value) => (
                  <div key={value}>
                    <strong>{dispositionLabels[value]}</strong>
                    <p>
                      {value === "PROCEED_TO_CONTROLLED_EXPORT_REVIEW"
                        ? "Permits only future controlled Phase 12 export review; not approval to submit. Requires no unresolved blockers or human-disposition findings and requires valid provenance and acknowledgements."
                        : value === "HOLD_FOR_REMEDIATION"
                          ? "Records that remediation is required and may be available while blockers exist."
                          : "Records a human decision to stop pursuit and may be available while blockers exist."}
                    </p>
                    <Button
                      disabled={
                        value === "PROCEED_TO_CONTROLLED_EXPORT_REVIEW" &&
                        (selectedRun.finding_counts.blockers > 0 ||
                          selectedRun.finding_counts
                            .human_disposition_required > 0)
                      }
                      onClick={(event) =>
                        requestDecision(value, event.currentTarget)
                      }
                    >
                      {dispositionLabels[value]}
                    </Button>
                  </div>
                ),
              )}
            </div>
          </Card>
        )}

      {reviewFinding !== null && (
        <div className="overlay">
          <div
            aria-labelledby="review-dialog-title"
            aria-modal="true"
            className="modal"
            role="dialog"
            tabIndex={-1}
          >
            <h3 id="review-dialog-title">Finding review</h3>
            <p>{reviewFinding.title}</p>
            <h4>Append-only history</h4>
            {reviews.length === 0 ? (
              <p>No reviews recorded.</p>
            ) : (
              <ol>
                {reviews.map((review) => (
                  <li key={review.id}>
                    Version {review.review_version}:{" "}
                    {humanizeEnum(review.action)} by {review.actor.display_name}{" "}
                    on {when(review.created_at)} — {review.rationale}
                  </li>
                ))}
              </ol>
            )}
            {canReview && (
              <form onSubmit={(event) => void submitReview(event)}>
                <label>
                  Review action
                  <select name="action" defaultValue="ACKNOWLEDGE">
                    <option>ACKNOWLEDGE</option>
                    <option>ACCEPT</option>
                    <option>REMEDIATE</option>
                    <option>DISMISS</option>
                    <option>REOPEN</option>
                  </select>
                </label>
                <label>
                  Rationale
                  <textarea
                    minLength={20}
                    maxLength={2000}
                    name="rationale"
                    required
                  />
                </label>
                <label>
                  <input name="acknowledgement" type="checkbox" /> Record
                  acknowledgement
                </label>
                <Button type="submit">Append review</Button>
              </form>
            )}
            <Button autoFocus onClick={closeReview} variant="quiet">
              Close
            </Button>
          </div>
        </div>
      )}

      {confirming !== null && selectedRun !== null && (
        <div className="overlay">
          <div
            aria-labelledby="decision-dialog-title"
            aria-modal="true"
            className="modal"
            role="dialog"
            tabIndex={-1}
          >
            <h3 id="decision-dialog-title">Confirm final disposition</h3>
            <p>
              You selected <strong>{dispositionLabels[confirming]}</strong>.
              This is a human workflow record and is not approval to submit.
            </p>
            <form onSubmit={(event) => void submitDecision(event)}>
              <label>
                Mandatory rationale
                <textarea
                  minLength={20}
                  maxLength={2000}
                  name="decision_rationale"
                  required
                />
              </label>
              {findings
                .filter(
                  ({ treatment }) => treatment === "HUMAN_DISPOSITION_REQUIRED",
                )
                .map((finding) => (
                  <label key={finding.id}>
                    <input
                      name="acknowledgement_ids"
                      required
                      type="checkbox"
                      value={finding.id}
                    />{" "}
                    Acknowledge: {finding.title}
                  </label>
                ))}
              <div className="inline-actions">
                <Button type="submit">
                  Confirm {dispositionLabels[confirming]}
                </Button>
                <Button onClick={closeDecision} type="button" variant="quiet">
                  Go back
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
