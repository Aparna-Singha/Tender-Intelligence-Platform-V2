"use client";

import { useEffect, useState, type FormEvent, type JSX } from "react";
import { apiRequest } from "../lib/api";
import { humanizeEnum } from "@tender/ui";

interface AssessmentRun {
  comparisonPolicyVersion: string;
  extractionRunId: string;
  id: string;
  invalidatedAt: string | null;
  progressPercentage: number;
  publicMessage: string;
  riskAnalysisRunId: string;
  snapshot?: { capturedAt: string } | null;
  status: string;
  tenderVersionId: string;
}
interface MatrixItem {
  currentState: string;
  evidenceLinks: readonly {
    evidenceCitation: {
      boundedExcerpt: string;
      documentId: string;
      documentName: string;
      pageNumber: number | null;
      validationStatus: string;
    } | null;
    linkType: string;
  }[];
  id: string;
  proposedConfidence: string;
  proposedRationale: string;
  proposedState: string;
  requirementCategory: string;
  requirementObligation: string;
  reviewState: string;
  structuredRequirement: {
    normalizedStatement: string;
    title: string;
  };
  tenderCitation: {
    boundedExcerpt: string;
    documentName: string;
    pageNumber: number | null;
    tenderDocumentId: string;
  };
  uncertainty: string;
}
interface MatrixResult {
  counts: readonly { _count: number; currentState: string }[];
  items: readonly MatrixItem[];
  total: number;
}
interface CompanyDocument {
  displayName: string;
  id: string;
  status: string;
}
interface CompanyDocumentDetails extends CompanyDocument {
  currentVersionId: string | null;
}
interface EvidenceFact {
  currentVersion: {
    citations: readonly { documentName: string; id: string }[];
    reviewState: string;
    versionNumber: number;
  } | null;
  factType: string;
  id: string;
  invalidatedAt: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

export function EvidenceMatrix({
  currentAssessmentRunId = null,
  focusRequest = null,
  organisationId,
  tenderId,
  versionId,
}: {
  readonly currentAssessmentRunId?: string | null;
  readonly focusRequest?: {
    readonly assessmentId?: string;
    readonly mode: "assessment" | "capture";
    readonly token: number;
  } | null;
  readonly organisationId: string;
  readonly tenderId: string;
  readonly versionId: string;
}): JSX.Element {
  const base = `/organisations/${organisationId}/tenders/${tenderId}`;
  const [runs, setRuns] = useState<readonly AssessmentRun[]>([]);
  const [runId, setRunId] = useState("");
  const [matrix, setMatrix] = useState<MatrixResult | null>(null);
  const [state, setState] = useState("");
  const [message, setMessage] = useState("");
  const [documents, setDocuments] = useState<readonly CompanyDocument[]>([]);
  const [facts, setFacts] = useState<readonly EvidenceFact[]>([]);

  async function loadRuns(): Promise<void> {
    try {
      const result = await apiRequest<unknown>(
        `${base}/versions/${versionId}/eligibility-assessments`,
      );
      const safeRuns = Array.isArray(result)
        ? result.filter(isAssessmentRunValue)
        : [];
      setRuns(safeRuns);
      const preferredRunId =
        safeRuns.find(
          (run) =>
            run.invalidatedAt == null &&
            currentAssessmentRunId !== null &&
            run.id === currentAssessmentRunId,
        )?.id ??
        safeRuns.find((run) => run.invalidatedAt == null)?.id ??
        safeRuns[0]?.id ??
        "";
      setRunId((current) =>
        current === "" || !safeRuns.some((run) => run.id === current)
          ? preferredRunId
          : current,
      );
    } catch {
      setMessage("Unable to load evidence-assessment history.");
    }
  }
  async function loadDocuments(): Promise<void> {
    try {
      setDocuments(
        (
          await apiRequest<readonly CompanyDocument[]>(
            `/organisations/${organisationId}/documents?status=READY`,
          )
        ).filter((document) => document.status === "READY"),
      );
    } catch {
      setDocuments([]);
    }
  }
  async function loadFacts(): Promise<void> {
    try {
      setFacts(
        await apiRequest<readonly EvidenceFact[]>(
          `/organisations/${organisationId}/company-evidence-facts`,
        ),
      );
    } catch {
      setFacts([]);
    }
  }
  async function loadMatrix(): Promise<void> {
    if (runId === "") return;
    const query = state === "" ? "" : `?state=${state}`;
    try {
      const result = await apiRequest<unknown>(
        `${base}/eligibility-assessments/${runId}/matrix${query}`,
      );
      setMatrix(isMatrixResultValue(result) ? result : null);
    } catch {
      setMatrix(null);
    }
  }
  useEffect(() => {
    void loadRuns();
    void loadDocuments();
    void loadFacts();
    const timer = window.setInterval(() => void loadRuns(), 5000);
    return () => window.clearInterval(timer);
  }, [currentAssessmentRunId, organisationId, tenderId, versionId]);
  useEffect(() => {
    void loadMatrix();
  }, [runId, state]);

  async function start(): Promise<void> {
    try {
      await apiRequest(
        `${base}/versions/${versionId}/eligibility-assessments`,
        {
          body: JSON.stringify({ idempotency_key: crypto.randomUUID() }),
          method: "POST",
        },
      );
      setMessage("Refreshing requirements...");
      await loadRuns();
    } catch {
      setMessage(
        "Comparison requires a current completed extraction, EARLY risk run, and authorised CONTINUE decision.",
      );
    }
  }
  async function openTenderSource(item: MatrixItem): Promise<void> {
    const result = await apiRequest<{ download_url: string }>(
      `${base}/documents/${item.tenderCitation.tenderDocumentId}/download`,
      { method: "POST" },
    );
    window.open(
      `${result.download_url}${item.tenderCitation.pageNumber === null ? "" : `#page=${item.tenderCitation.pageNumber}`}`,
      "_blank",
      "noopener,noreferrer",
    );
  }
  async function openCompanySource(documentId: string): Promise<void> {
    const result = await apiRequest<{ download_url: string }>(
      `/organisations/${organisationId}/documents/${documentId}/download`,
      { method: "POST" },
    );
    window.open(result.download_url, "_blank", "noopener,noreferrer");
  }

  async function captureFact(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const documentId = formText(values, "document_id");
    try {
      const details = await apiRequest<CompanyDocumentDetails>(
        `/organisations/${organisationId}/documents/${documentId}`,
      );
      if (details.currentVersionId === null)
        throw new Error("No current document version");
      const fact = await apiRequest<{
        currentVersion: { id: string };
        id: string;
      }>(`/organisations/${organisationId}/company-evidence-facts`, {
        body: JSON.stringify({
          document_id: documentId,
          document_version_id: details.currentVersionId,
          fact_type: values.get("fact_type"),
          ...(formText(values, "scope") === ""
            ? {}
            : { scope: formText(values, "scope") }),
          value: {
            text_value: values.get("fact_value"),
            value_type: "TEXT",
          },
        }),
        method: "POST",
      });
      const page = formText(values, "page_number");
      await apiRequest(
        `/organisations/${organisationId}/company-evidence-facts/${fact.id}/citations`,
        {
          body: JSON.stringify({
            bounded_excerpt: values.get("excerpt"),
            document_id: documentId,
            document_version_id: details.currentVersionId,
            ...(page === "" ? {} : { page_number: Number(page) }),
            ...(formText(values, "section_label") === ""
              ? {}
              : { section_label: formText(values, "section_label") }),
          }),
          method: "POST",
        },
      );
      form.reset();
      setMessage(
        "Evidence fact and citation saved for independent reviewer confirmation.",
      );
      await loadFacts();
    } catch {
      setMessage(
        "Evidence capture failed. Select a current approved document and provide bounded source details.",
      );
    }
  }

  async function reviewFact(
    event: FormEvent<HTMLFormElement>,
    factId: string,
  ): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    try {
      await apiRequest(
        `/organisations/${organisationId}/company-evidence-facts/${factId}/reviews`,
        {
          body: JSON.stringify({
            action: values.get("action"),
            rationale: values.get("rationale"),
          }),
          method: "POST",
        },
      );
      setMessage(
        "Evidence-fact review recorded; current assessments were invalidated.",
      );
      form.reset();
      await Promise.all([loadFacts(), loadRuns()]);
    } catch {
      setMessage("Evidence-fact review was rejected.");
    }
  }

  async function reviewAssessment(
    event: FormEvent<HTMLFormElement>,
    assessmentId: string,
  ): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    try {
      await apiRequest(
        `${base}/eligibility-assessments/${runId}/items/${assessmentId}/reviews`,
        {
          body: JSON.stringify({
            action: values.get("action"),
            rationale: values.get("rationale"),
          }),
          method: "POST",
        },
      );
      setMessage("Append-only human review recorded.");
      form.reset();
      await loadMatrix();
    } catch {
      setMessage(
        "Review was rejected. Final states require reviewer authority, rationale, and valid direct citations.",
      );
    }
  }

  const currentRun =
    currentAssessmentRunId === null
      ? null
      : (runs.find(
          (run) =>
            run.invalidatedAt == null && run.id === currentAssessmentRunId,
        ) ?? null);
  const active = runs.find((run) => run.id === runId);

  useEffect(() => {
    if (focusRequest === null) return;
    if (focusRequest.mode === "assessment" && currentRun?.id !== undefined) {
      if (runId !== currentRun.id) {
        setRunId(currentRun.id);
        return;
      }
      const target = document.getElementById(
        focusRequest.assessmentId === undefined
          ? "evidence-matrix-panel"
          : `assessment-review-${focusRequest.assessmentId}`,
      );
      if (target instanceof HTMLElement) {
        target.scrollIntoView({ block: "start" });
        target.focus();
      }
      return;
    }
    if (focusRequest.mode === "capture") {
      const target = document.getElementById("evidence-fact-type-input");
      if (target instanceof HTMLElement) {
        target.scrollIntoView({ block: "start" });
        target.focus();
      }
    }
  }, [currentRun?.id, focusRequest, matrix, runId]);

  return (
    <section aria-labelledby="matrix-heading" id="evidence-matrix-panel">
      <h2 id="matrix-heading">Requirements & Evidence</h2>
      <p className="warning">
        Assessment results do not guarantee eligibility or bid success. Verified
        and not-applicable states still require authorised human action.
      </p>
      <details>
        <summary>Why evidence matters</summary>
        <p>
          Document existence alone may not prove detailed compliance. OCR and
          automatic company-document fact extraction are unavailable, so use
          reviewed, manually captured facts with exact source locations.
        </p>
      </details>
      <button onClick={() => void start()} type="button">
        Refresh requirements check
      </button>
      <p aria-live="polite">{message}</p>
      <form onSubmit={(event) => void captureFact(event)}>
        <h3>Capture a bounded company-document fact</h3>
        <label>
          Approved current document
          <select name="document_id" required>
            <option value="">Select a READY document</option>
            {documents.map((document) => (
              <option key={document.id} value={document.id}>
                {document.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Fact type
          <input
            id="evidence-fact-type-input"
            name="fact_type"
            pattern="[A-Z][A-Z0-9_]{1,79}"
            placeholder="OEM_AUTHORISATION_SCOPE"
            required
          />
        </label>
        <label>
          Fact value
          <input name="fact_value" required />
        </label>
        <label>
          Scope
          <input maxLength={1000} name="scope" />
        </label>
        <label>
          Page number (only when visible in the source)
          <input min={1} name="page_number" type="number" />
        </label>
        <label>
          Section label (optional)
          <input maxLength={160} name="section_label" />
        </label>
        <label>
          Bounded excerpt
          <textarea maxLength={1000} name="excerpt" required />
        </label>
        <button type="submit">Save for reviewer confirmation</button>
      </form>
      <h3>Company evidence facts</h3>
      {facts.length === 0 && <p>No manually captured evidence facts.</p>}
      {facts.map((fact) => (
        <article key={fact.id}>
          <h4>{fact.factType.replaceAll("_", " ")}</h4>
          <p>
            Version {fact.currentVersion?.versionNumber ?? "—"} ·{" "}
            {humanizeEnum(
              fact.currentVersion?.reviewState ?? "NO_CURRENT_VERSION",
            )}
          </p>
          <p>
            Citations: {fact.currentVersion?.citations.length ?? 0}
            {fact.invalidatedAt === null ? "" : " · INVALIDATED"}
          </p>
          {fact.currentVersion?.citations.map((citation) => (
            <p key={citation.id}>{citation.documentName}</p>
          ))}
          {fact.invalidatedAt === null && (
            <form onSubmit={(event) => void reviewFact(event, fact.id)}>
              <label>
                Evidence review action
                <select name="action" required>
                  <option value="REQUEST_HUMAN_REVIEW">Request review</option>
                  <option value="ACCEPT">Accept cited fact</option>
                  <option value="REJECT">Reject</option>
                  <option value="INVALIDATE">Invalidate</option>
                </select>
              </label>
              <label>
                Rationale
                <textarea
                  minLength={10}
                  maxLength={1000}
                  name="rationale"
                  required
                />
              </label>
              <button type="submit">Record evidence review</button>
            </form>
          )}
        </article>
      ))}
      {runs.length > 0 && (
        <label>
          Assessment run
          <select
            value={runId}
            onChange={(event) => setRunId(event.target.value)}
          >
            {runs.map((run) => (
              <option key={run.id} value={run.id}>
                {run.id === currentRun?.id
                  ? "Current"
                  : run.invalidatedAt == null
                    ? "Previous"
                    : "Historical"}{" "}
                - {humanizeEnum(run.status)}
              </option>
            ))}
          </select>
        </label>
      )}
      {active !== undefined && (
        <article>
          <h3>
            {humanizeEnum(active.status)} · {active.progressPercentage}%
          </h3>
          <p>{active.publicMessage}</p>
          <p>Policy: {active.comparisonPolicyVersion}</p>
          <p>Tender version: {active.tenderVersionId}</p>
          <p>Extraction run: {active.extractionRunId}</p>
          <p>EARLY risk run: {active.riskAnalysisRunId}</p>
          <p>
            Snapshot:{" "}
            {active.snapshot?.capturedAt === undefined
              ? "Unavailable for this run."
              : new Date(active.snapshot.capturedAt).toLocaleString()}
          </p>
          {active.invalidatedAt !== null && (
            <p className="warning">
              This historical run is invalidated and is not current.
            </p>
          )}
        </article>
      )}
      <label>
        Assessment state
        <select
          value={state}
          onChange={(event) => setState(event.target.value)}
        >
          <option value="">All states</option>
          {[
            "VERIFIED",
            "LIKELY_MET",
            "MISSING",
            "CONFLICT",
            "NOT_APPLICABLE",
            "HUMAN_REVIEW_REQUIRED",
          ].map((value) => (
            <option key={value} value={value}>
              {value.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </label>
      {matrix?.counts.map((count) => (
        <span key={count.currentState}>
          {humanizeEnum(count.currentState)}: {count._count}{" "}
        </span>
      ))}
      {active?.status === "COMPLETE" && matrix?.total === 0 && (
        <p>No applicable cited requirements were available for comparison.</p>
      )}
      {matrix?.items.map((item) => (
        <article id={`assessment-review-${item.id}`} key={item.id} tabIndex={0}>
          <h3>{item.structuredRequirement.title}</h3>
          <p>{item.structuredRequirement.normalizedStatement}</p>
          <p>
            {item.requirementObligation} · {item.requirementCategory}
          </p>
          <p>
            Proposed: {humanizeEnum(item.proposedState)} · Current:{" "}
            {humanizeEnum(item.currentState)} · Review:{" "}
            {humanizeEnum(item.reviewState)}
          </p>
          <p>Confidence: {item.proposedConfidence}</p>
          <p>{item.proposedRationale}</p>
          <p>Uncertainty: {item.uncertainty}</p>
          <blockquote>
            <p>{item.tenderCitation.boundedExcerpt}</p>
            <cite>
              {item.tenderCitation.documentName}
              {item.tenderCitation.pageNumber === null
                ? ""
                : `, page ${item.tenderCitation.pageNumber}`}
            </cite>
            <button onClick={() => void openTenderSource(item)} type="button">
              Open tender source
            </button>
          </blockquote>
          {item.evidenceLinks.length === 0 && (
            <p>Evidence scope is incomplete; human review is required.</p>
          )}
          {item.evidenceLinks.map((link, index) => (
            <blockquote key={`${item.id}:${index}`}>
              <p>{link.linkType.replaceAll("_", " ")}</p>
              {link.evidenceCitation !== null && (
                <>
                  <p>{link.evidenceCitation.boundedExcerpt}</p>
                  <cite>
                    {link.evidenceCitation.documentName}
                    {link.evidenceCitation.pageNumber === null
                      ? ""
                      : `, page ${link.evidenceCitation.pageNumber}`}
                  </cite>
                  <button
                    onClick={() =>
                      void openCompanySource(
                        link.evidenceCitation?.documentId ?? "",
                      )
                    }
                    type="button"
                  >
                    Open authorised company source
                  </button>
                </>
              )}
            </blockquote>
          ))}
          {item.currentState === "MISSING" && (
            <p>
              Missing evidence detected. Checklist generation is not implemented
              in this phase.
            </p>
          )}
          <form onSubmit={(event) => void reviewAssessment(event, item.id)}>
            <label>
              Human review action
              <select name="action" required>
                <option value="REQUEST_HUMAN_REVIEW">
                  Request human review
                </option>
                <option value="ACCEPT_PROPOSAL">Accept proposal</option>
                <option value="MARK_LIKELY_MET">Mark likely met</option>
                <option value="MARK_MISSING">Mark missing</option>
                <option value="MARK_CONFLICT">Mark conflict</option>
                <option value="MARK_VERIFIED">Mark verified</option>
                <option value="MARK_NOT_APPLICABLE">Mark not applicable</option>
                <option value="RESOLVE_CONFLICT">
                  Resolve conflict to human review
                </option>
                <option value="REOPEN">Reopen</option>
              </select>
            </label>
            <label>
              Review rationale
              <textarea
                minLength={10}
                maxLength={2000}
                name="rationale"
                required
              />
            </label>
            <button type="submit">Record human review</button>
          </form>
        </article>
      ))}
    </section>
  );
}

function formText(values: FormData, key: string): string {
  const value = values.get(key);
  return typeof value === "string" ? value : "";
}
