"use client";

import { useEffect, useState, type FormEvent, type JSX } from "react";
import { apiRequest } from "../lib/api";
import { humanizeEnum } from "@tender/ui";

interface RiskRun {
  id: string;
  extractionRunId: string;
  riskPolicyVersion: string;
  status: string;
  progressPercentage: number;
  publicMessage: string;
  summary: Readonly<Record<string, number>>;
}
interface RiskFinding {
  id: string;
  category: string;
  title: string;
  explanation: string;
  severity: string;
  confidence: string;
  materiality: string;
  findingStatus: string;
  reviewState: string;
  citations: readonly {
    extractionCitation: {
      id: string;
      boundedExcerpt: string;
      documentName: string;
      pageNumber: number | null;
      sheetName: string | null;
      tenderDocumentId: string;
    };
  }[];
}

export function RiskWorkspace({
  organisationId,
  tenderId,
  versionId,
}: {
  readonly organisationId: string;
  readonly tenderId: string;
  readonly versionId: string;
}): JSX.Element {
  const base = `/organisations/${organisationId}/tenders/${tenderId}`;
  const [runs, setRuns] = useState<readonly RiskRun[]>([]);
  const [runId, setRunId] = useState("");
  const [findings, setFindings] = useState<readonly RiskFinding[]>([]);
  const [severity, setSeverity] = useState("");
  const [message, setMessage] = useState("");
  const [decisionSubmitting, setDecisionSubmitting] = useState(false);

  async function loadRuns(): Promise<void> {
    try {
      const result = await apiRequest<readonly RiskRun[]>(
        `${base}/versions/${versionId}/risk-analyses`,
      );
      setRuns(result);
      setRunId((current) => (current === "" ? (result[0]?.id ?? "") : current));
    } catch {
      setMessage("Unable to load early risk-analysis status.");
    }
  }
  async function loadFindings(id: string): Promise<void> {
    if (id === "") return;
    const query = severity === "" ? "" : `?severity=${severity}`;
    try {
      setFindings(
        await apiRequest<readonly RiskFinding[]>(
          `${base}/risk-analyses/${id}/findings${query}`,
        ),
      );
    } catch {
      setFindings([]);
    }
  }
  useEffect(() => {
    void loadRuns();
    const timer = window.setInterval(() => void loadRuns(), 5000);
    return () => window.clearInterval(timer);
  }, [organisationId, tenderId, versionId]);
  useEffect(() => {
    void loadFindings(runId);
  }, [runId, severity]);

  async function start(): Promise<void> {
    await apiRequest(`${base}/versions/${versionId}/risk-analyses`, {
      body: JSON.stringify({ idempotency_key: crypto.randomUUID() }),
      method: "POST",
    });
    setMessage("Early risk analysis queued.");
    await loadRuns();
  }
  async function openSource(
    citation: RiskFinding["citations"][number]["extractionCitation"],
  ): Promise<void> {
    const result = await apiRequest<{ download_url: string }>(
      `${base}/documents/${citation.tenderDocumentId}/download`,
      { method: "POST" },
    );
    const page =
      citation.pageNumber === null ? "" : `#page=${citation.pageNumber}`;
    window.open(
      `${result.download_url}${page}`,
      "_blank",
      "noopener,noreferrer",
    );
  }
  async function decide(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (decisionSubmitting) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    setDecisionSubmitting(true);
    try {
      await apiRequest(`${base}/risk-analyses/${runId}/decisions`, {
        body: JSON.stringify({
          acknowledged_limitations: values.get("acknowledged") === "on",
          decision: values.get("decision"),
          rationale: values.get("rationale"),
        }),
        method: "POST",
      });
      form.reset();
      setMessage("Human pursuit decision recorded.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The human decision could not be recorded.",
      );
    } finally {
      setDecisionSubmitting(false);
    }
  }
  const active = runs.find((run) => run.id === runId);
  return (
    <section>
      <h2>Risks</h2>
      <p>This analysis highlights tender-related risks and ambiguities.</p>
      <p>It does not determine your organisation’s eligibility.</p>
      <p>Human review is required for important decisions.</p>
      <button onClick={() => void start()} type="button">
        Start early cited risk analysis
      </button>
      <p aria-live="polite">{message}</p>
      {runs.length > 0 && (
        <label>
          Risk-analysis run
          <select
            value={runId}
            onChange={(event) => setRunId(event.target.value)}
          >
            {runs.map((run, index) => (
              <option key={run.id} value={run.id}>
                {index === 0 ? "Latest" : "Historical"} —{" "}
                {humanizeEnum(run.status)}
              </option>
            ))}
          </select>
        </label>
      )}
      {active !== undefined && (
        <article>
          <h3>
            Early · {humanizeEnum(active.status)} · {active.progressPercentage}%
          </h3>
          <p>{active.publicMessage}</p>
          <p>Policy: {active.riskPolicyVersion}</p>
          <p>Input extraction: {active.extractionRunId}</p>
          {Object.entries(active.summary).map(([key, value]) => (
            <p key={key}>
              {key.replaceAll("_", " ")}: {value}
            </p>
          ))}
        </article>
      )}
      <label>
        Severity filter
        <select
          value={severity}
          onChange={(event) => setSeverity(event.target.value)}
        >
          <option value="">All</option>
          <option value="CRITICAL">Critical</option>
          <option value="HIGH">High</option>
          <option value="MEDIUM">Medium</option>
          <option value="LOW">Low</option>
          <option value="INFORMATIONAL">Informational</option>
        </select>
      </label>
      {active?.status === "COMPLETE" && findings.length === 0 && (
        <p>
          No source-supported deterministic findings were detected. This is not
          a guarantee that the tender has no risks.
        </p>
      )}
      {findings.map((finding) => (
        <article key={finding.id}>
          <h3>{finding.title}</h3>
          <p>
            Severity: {humanizeEnum(finding.severity)} · Confidence:{" "}
            {humanizeEnum(finding.confidence)} · Materiality:{" "}
            {humanizeEnum(finding.materiality)}
          </p>
          <p>{humanizeEnum(finding.category)}</p>
          <p>{finding.explanation}</p>
          <p>
            {humanizeEnum(finding.findingStatus)} ·{" "}
            {humanizeEnum(finding.reviewState)}
          </p>
          {finding.citations.map(({ extractionCitation }) => (
            <blockquote key={extractionCitation.id}>
              <p>{extractionCitation.boundedExcerpt}</p>
              <cite>
                {extractionCitation.documentName}
                {extractionCitation.pageNumber === null
                  ? ""
                  : `, page ${extractionCitation.pageNumber}`}
                {extractionCitation.sheetName === null
                  ? ""
                  : `, sheet ${extractionCitation.sheetName}`}
              </cite>
              <button
                onClick={() => void openSource(extractionCitation)}
                type="button"
              >
                Open authorised source
              </button>
            </blockquote>
          ))}
        </article>
      ))}
      {active?.status === "COMPLETE" && (
        <form onSubmit={(event) => void decide(event)}>
          <h3>Human pursuit decision</h3>
          <p>No decision is selected automatically.</p>
          <label>
            Decision
            <select defaultValue="" name="decision" required>
              <option disabled value="">
                Select CONTINUE, HOLD, or STOP
              </option>
              <option value="CONTINUE">CONTINUE</option>
              <option value="HOLD">HOLD</option>
              <option value="STOP">STOP</option>
            </select>
          </label>
          <label>
            Rationale
            <textarea minLength={20} name="rationale" required />
          </label>
          <label>
            <input name="acknowledged" required type="checkbox" />I acknowledge
            unresolved findings and source-quality limitations.
          </label>
          <button disabled={decisionSubmitting} type="submit">
            {decisionSubmitting
              ? "Recording decision…"
              : "Record human decision"}
          </button>
        </form>
      )}
    </section>
  );
}
