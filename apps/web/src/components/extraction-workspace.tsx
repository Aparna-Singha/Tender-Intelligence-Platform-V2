"use client";

import { useEffect, useState, type FormEvent, type JSX } from "react";
import { apiRequest } from "../lib/api";
import { humanizeEnum } from "@tender/ui";

interface ExtractionRun {
  current_stage: string;
  id: string;
  parser_policy_version: string;
  progress_percentage: number;
  public_message: string;
  quality_summary: Readonly<Record<string, number>>;
  source_fingerprint: string;
  status: string;
}

interface Citation {
  archiveMemberPath: string | null;
  boundedExcerpt: string;
  documentName: string;
  id: string;
  pageNumber: number | null;
  sheetName: string | null;
  tenderDocumentId: string;
}

interface Requirement {
  category: string;
  citations: readonly Citation[];
  confidence: string;
  findingState: string;
  id: string;
  normalizedStatement: string;
  obligation: string;
  reviewState: string;
  sourceWording: string;
  title: string;
}

interface ExtractedField {
  citations: readonly Citation[];
  confidence: string;
  fieldType: string;
  findingState: string;
  id: string;
  normalizedTextValue: string | null;
  reviewState: string;
  sourceWording: string;
}

interface ExtractionIssue {
  id: string;
  issueType: string;
  requiresHumanReview: boolean;
  safeMessage: string;
  severity: string;
}

export function ExtractionWorkspace({
  organisationId,
  tenderId,
  versionId,
}: {
  readonly organisationId: string;
  readonly tenderId: string;
  readonly versionId: string;
}): JSX.Element {
  const base = `/organisations/${organisationId}/tenders/${tenderId}`;
  const [runs, setRuns] = useState<readonly ExtractionRun[]>([]);
  const [activeRunId, setActiveRunId] = useState("");
  const [requirements, setRequirements] = useState<readonly Requirement[]>([]);
  const [fields, setFields] = useState<readonly ExtractedField[]>([]);
  const [issues, setIssues] = useState<readonly ExtractionIssue[]>([]);
  const [message, setMessage] = useState("Loading extraction status…");
  const [category, setCategory] = useState("");
  const [confidence, setConfidence] = useState("");
  const [reviewState, setReviewState] = useState("");
  const [search, setSearch] = useState("");

  async function loadRuns(): Promise<void> {
    try {
      const loaded = await apiRequest<readonly ExtractionRun[]>(
        `${base}/versions/${versionId}/extractions`,
      );
      setRuns(loaded);
      setActiveRunId((current) =>
        current === "" ? (loaded[0]?.id ?? "") : current,
      );
      setMessage("");
    } catch {
      setMessage("Unable to load extraction status.");
    }
  }

  async function loadResults(runId: string): Promise<void> {
    if (runId === "") return;
    const query = new URLSearchParams();
    if (category !== "") query.set("category", category);
    if (confidence !== "") query.set("confidence", confidence);
    if (reviewState !== "") query.set("review_state", reviewState);
    if (search !== "") query.set("search", search);
    try {
      const [loadedRequirements, loadedFields, loadedIssues] =
        await Promise.all([
          apiRequest<readonly Requirement[]>(
            `${base}/extractions/${runId}/requirements?${query.toString()}`,
          ),
          apiRequest<readonly ExtractedField[]>(
            `${base}/extractions/${runId}/fields`,
          ),
          apiRequest<readonly ExtractionIssue[]>(
            `${base}/extractions/${runId}/issues`,
          ),
        ]);
      setRequirements(loadedRequirements);
      setFields(loadedFields);
      setIssues(loadedIssues);
    } catch {
      setMessage("Extraction results are not available yet.");
    }
  }

  useEffect(() => {
    void loadRuns();
    const timer = window.setInterval(() => void loadRuns(), 5000);
    return () => window.clearInterval(timer);
  }, [organisationId, tenderId, versionId]);

  useEffect(() => {
    void loadResults(activeRunId);
  }, [activeRunId, category, confidence, reviewState, search]);

  async function start(): Promise<void> {
    try {
      await apiRequest(`${base}/versions/${versionId}/extractions`, {
        body: JSON.stringify({
          idempotency_key: crypto.randomUUID(),
        }),
        method: "POST",
      });
      setMessage("Extraction queued.");
      await loadRuns();
    } catch {
      setMessage(
        "Extraction could not start. Confirm all current-version sources are ready.",
      );
    }
  }

  async function review(
    event: FormEvent<HTMLFormElement>,
    requirementId: string,
  ): Promise<void> {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const action = values.get("action");
    const reason = values.get("reason");
    const correctedValue = values.get("corrected_value");
    try {
      await apiRequest(
        `${base}/extractions/${activeRunId}/requirements/${requirementId}/reviews`,
        {
          body: JSON.stringify({
            action,
            corrected_value:
              typeof correctedValue === "string" && correctedValue.length > 0
                ? correctedValue
                : undefined,
            reason,
          }),
          method: "POST",
        },
      );
      setMessage("Review recorded without changing machine extraction.");
      await loadResults(activeRunId);
    } catch {
      setMessage("Review could not be recorded.");
    }
  }

  async function openCitation(citation: Citation): Promise<void> {
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

  const activeRun = runs.find((run) => run.id === activeRunId);
  return (
    <>
      <section>
        <h2>Extraction processing</h2>
        <button onClick={() => void start()} type="button">
          Start extraction
        </button>
        <p aria-live="polite">{message}</p>
        {runs.length > 0 && (
          <label>
            Extraction run
            <select
              value={activeRunId}
              onChange={(event) => setActiveRunId(event.target.value)}
            >
              {runs.map((run, index) => (
                <option key={run.id} value={run.id}>
                  {index === 0 ? "Latest — " : "Historical — "}
                  {humanizeEnum(run.status)}
                </option>
              ))}
            </select>
          </label>
        )}
        {activeRun !== undefined && (
          <article>
            <h3>
              {humanizeEnum(activeRun.status)} · {activeRun.progress_percentage}
              %
            </h3>
            <p>{activeRun.public_message}</p>
            <p>Parser policy: {activeRun.parser_policy_version}</p>
            <p>
              Source fingerprint: {activeRun.source_fingerprint.slice(0, 16)}…
            </p>
            <dl>
              {Object.entries(activeRun.quality_summary).map(([key, value]) => (
                <div key={key}>
                  <dt>{key.replaceAll("_", " ")}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </article>
        )}
        {issues.map((issue) => (
          <p className="warning" key={issue.id}>
            {humanizeEnum(issue.severity)}: {issue.safeMessage}
            {issue.requiresHumanReview ? " — human review required" : ""}
          </p>
        ))}
      </section>
      <section>
        <h2>Source-extracted tender identity</h2>
        <p>
          Deterministic extracted fields only. This is not an AI narrative
          summary, eligibility assessment, or risk decision.
        </p>
        {fields.length === 0 && <p>No structured fields were found.</p>}
        {fields.map((field) => (
          <article key={field.id}>
            <h3>{field.fieldType.replaceAll("_", " ")}</h3>
            <p>{field.normalizedTextValue}</p>
            <p>
              {humanizeEnum(field.confidence)} confidence ·{" "}
              {humanizeEnum(field.findingState)} ·{" "}
              {humanizeEnum(field.reviewState)}
            </p>
            {field.citations.map((citation) => (
              <CitationView
                citation={citation}
                key={citation.id}
                openCitation={openCitation}
              />
            ))}
          </article>
        ))}
      </section>
      <section>
        <h2>Requirements</h2>
        <p>
          These records state what the source says. They do not decide whether
          the organisation satisfies any requirement.
        </p>
        <div>
          <label>
            Category
            <input
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            />
          </label>
          <label>
            Confidence
            <select
              value={confidence}
              onChange={(event) => setConfidence(event.target.value)}
            >
              <option value="">All</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
              <option value="HUMAN_REVIEW_REQUIRED">
                Human review required
              </option>
            </select>
          </label>
          <label>
            Review state
            <select
              value={reviewState}
              onChange={(event) => setReviewState(event.target.value)}
            >
              <option value="">All</option>
              <option value="UNREVIEWED">Unreviewed</option>
              <option value="ACCEPTED">Accepted</option>
              <option value="REJECTED">Rejected</option>
              <option value="CORRECTED">Corrected</option>
            </select>
          </label>
          <label>
            Search source wording
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>
        {requirements.length === 0 && <p>No requirements were extracted.</p>}
        {requirements.map((requirement) => (
          <article key={requirement.id}>
            <h3>{requirement.title}</h3>
            <p>{requirement.normalizedStatement}</p>
            <p>
              {humanizeEnum(requirement.category)} ·{" "}
              {humanizeEnum(requirement.obligation)} ·{" "}
              {humanizeEnum(requirement.confidence)} confidence ·{" "}
              {humanizeEnum(requirement.findingState)}
            </p>
            {requirement.citations.map((citation) => (
              <CitationView
                citation={citation}
                key={citation.id}
                openCitation={openCitation}
              />
            ))}
            <form onSubmit={(event) => void review(event, requirement.id)}>
              <label>
                Review action
                <select name="action">
                  <option value="ACCEPT">Accept extraction</option>
                  <option value="REJECT">Reject extraction</option>
                  <option value="CORRECT">Correct normalized value</option>
                  <option value="MARK_AMBIGUOUS">Mark ambiguous</option>
                  <option value="REQUEST_REVIEW">Request review</option>
                </select>
              </label>
              <label>
                Corrected value, when correcting
                <textarea name="corrected_value" />
              </label>
              <label>
                Review reason
                <input name="reason" required />
              </label>
              <button type="submit">Record review</button>
            </form>
          </article>
        ))}
      </section>
    </>
  );
}

function CitationView({
  citation,
  openCitation,
}: {
  readonly citation: Citation;
  readonly openCitation: (citation: Citation) => Promise<void>;
}): JSX.Element {
  return (
    <blockquote>
      <p>{citation.boundedExcerpt}</p>
      <cite>
        {citation.documentName}
        {citation.pageNumber === null ? "" : `, page ${citation.pageNumber}`}
        {citation.sheetName === null ? "" : `, sheet ${citation.sheetName}`}
        {citation.archiveMemberPath === null
          ? ""
          : `, archive member ${citation.archiveMemberPath}`}
      </cite>
      <button onClick={() => void openCitation(citation)} type="button">
        Open authorised source
      </button>
    </blockquote>
  );
}
