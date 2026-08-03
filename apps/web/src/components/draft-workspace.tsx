"use client";

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type JSX,
} from "react";
import { apiRequest } from "../lib/api";
import { humanizeEnum } from "@tender/ui";

type SourceMode =
  | "FULL_AUTHORISED_TENDER_CONTEXT"
  | "TENDER_AND_APPROVED_COMPANY_EVIDENCE"
  | "TENDER_AND_DERIVED_WORKFLOW_RECORDS"
  | "TENDER_ONLY";

interface TemplateVersion {
  id: string;
  versionNumber: number;
}

interface Template {
  activeVersionId: string | null;
  id: string;
  name: string;
  versions: readonly TemplateVersion[];
}

interface Run {
  citationCount: number;
  currentStage: string;
  draftId: string | null;
  id: string;
  placeholderCount: number;
  progressPercentage: number;
  safeFailureCode: string | null;
  status: string;
  validatedClaimCount: number;
}

interface Draft {
  currentVersionId: string | null;
  id: string;
  lifecycle: string;
  title: string;
}

interface Citation {
  clauseLabel: string | null;
  documentName: string;
  excerpt: string;
  handle: string;
  pageNumber: number | null;
}

interface Claim {
  citations: readonly Citation[];
  claimClass: string;
  claimText: string;
  id: string;
  supportState: string;
}

interface Placeholder {
  approvalBlocking: boolean;
  explanation: string;
  id: string;
  markerText: string;
  resolutionState: string;
}

interface Section {
  claims: readonly Claim[];
  content: string;
  heading: string;
  id: string;
  placeholders: readonly Placeholder[];
  reviewState: string;
  sectionKey: string;
}

interface Version {
  id: string;
  invalidatedAt: string | null;
  reviewState: string;
  sections: readonly Section[];
  versionNumber: number;
}

interface VersionSummary {
  createdAt: string;
  id: string;
  invalidatedAt: string | null;
  reviewState: string;
  versionNumber: number;
}

export function DraftWorkspace({
  organisationId,
  tenderId,
}: {
  readonly organisationId: string;
  readonly tenderId: string;
}): JSX.Element {
  const base = `/organisations/${organisationId}/tenders/${tenderId}`;
  const [templates, setTemplates] = useState<readonly Template[]>([]);
  const [runs, setRuns] = useState<readonly Run[]>([]);
  const [drafts, setDrafts] = useState<readonly Draft[]>([]);
  const [selectedDraft, setSelectedDraft] = useState("");
  const [version, setVersion] = useState<Version | null>(null);
  const [versionHistory, setVersionHistory] = useState<
    readonly VersionSummary[]
  >([]);
  const [mode, setMode] = useState<SourceMode>("TENDER_ONLY");
  const [status, setStatus] = useState("Loading drafting workspace…");

  const load = useCallback(async (): Promise<void> => {
    try {
      const [loadedTemplates, loadedRuns, loadedDrafts] = await Promise.all([
        apiRequest<readonly Template[]>(
          `${base}/draft-templates?draft_type=CONSOLIDATED_FIRST_DRAFT`,
        ),
        apiRequest<readonly Run[]>(`${base}/draft-generation-runs`),
        apiRequest<readonly Draft[]>(`${base}/drafts`),
      ]);
      setTemplates(loadedTemplates);
      setRuns(loadedRuns);
      setDrafts(loadedDrafts);
      setSelectedDraft((current) =>
        current === "" ? (loadedDrafts[0]?.id ?? "") : current,
      );
      setStatus("");
    } catch {
      setStatus("Drafting data is unavailable or not authorised.");
    }
  }, [base]);

  const loadVersion = useCallback(async (): Promise<void> => {
    const draft = drafts.find(({ id }) => id === selectedDraft);
    if (draft?.currentVersionId === null || draft === undefined) {
      setVersion(null);
      setVersionHistory([]);
      return;
    }
    try {
      const [loadedDraft, loadedVersion] = await Promise.all([
        apiRequest<{ versions: readonly VersionSummary[] }>(
          `${base}/drafts/${draft.id}`,
        ),
        apiRequest<Version>(
          `${base}/drafts/${draft.id}/versions/${draft.currentVersionId}`,
        ),
      ]);
      setVersionHistory(loadedDraft.versions);
      setVersion(loadedVersion);
    } catch {
      setStatus("The current draft version is unavailable.");
    }
  }, [base, drafts, selectedDraft]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5_000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    void loadVersion();
  }, [loadVersion]);

  async function createControlledTemplate(): Promise<void> {
    setStatus("Creating controlled organisation template…");
    try {
      const template = await apiRequest<Template>(`${base}/draft-templates`, {
        body: JSON.stringify({
          draft_type: "CONSOLIDATED_FIRST_DRAFT",
          name: "Controlled consolidated first draft",
        }),
        method: "POST",
      });
      await apiRequest(`${base}/draft-templates/${template.id}/versions`, {
        body: JSON.stringify({
          required_review_role: "REVIEWER",
          sections: [
            {
              allowed_claim_classes: [
                "TENDER_SOURCE_STATEMENT",
                "APPROVED_COMPANY_FACT",
                "DERIVED_ASSESSMENT_REFERENCE",
                "RISK_OR_CHECKLIST_WARNING",
                "INFERENCE_REQUIRING_REVIEW",
                "PLACEHOLDER",
              ],
              formatting_guidance:
                "Use concise, reviewable paragraphs. Preserve warnings and placeholders.",
              heading: "Requirement responses",
              key: "requirement-responses",
              order: 0,
              required_source_classes: [],
            },
            {
              allowed_claim_classes: [
                "TENDER_SOURCE_STATEMENT",
                "APPROVED_COMPANY_FACT",
                "HUMAN_AUTHORED_COMMITMENT",
                "INFERENCE_REQUIRING_REVIEW",
                "PLACEHOLDER",
              ],
              formatting_guidance:
                "Do not create commercial, legal, delivery, warranty, or service commitments without reviewed support.",
              heading: "Clarifications, deviations and required inputs",
              key: "clarifications-deviations",
              order: 1,
              required_source_classes: [],
            },
          ],
        }),
        method: "POST",
      });
      await load();
    } catch {
      setStatus("Template creation requires template-management permission.");
    }
  }

  async function startGeneration(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const title = values.get("title");
    const instructions = values.get("instructions");
    const template = templates.find(
      ({ activeVersionId }) => activeVersionId !== null,
    );
    if (
      template?.activeVersionId === null ||
      template === undefined ||
      typeof title !== "string" ||
      typeof instructions !== "string"
    )
      return;
    setStatus("Validating current Phase 5–9 authority…");
    try {
      await apiRequest(`${base}/draft-generation-runs`, {
        body: JSON.stringify({
          draft_type: "CONSOLIDATED_FIRST_DRAFT",
          idempotency_key: crypto.randomUUID(),
          instructions: instructions === "" ? undefined : instructions,
          source_mode: mode,
          template_version_id: template.activeVersionId,
          title,
        }),
        method: "POST",
      });
      form.reset();
      setStatus(
        "Draft generation queued. Human approval will still be required.",
      );
      await load();
    } catch {
      setStatus(
        "Generation could not start. Current extraction, CONTINUE decision, assessment, checklist, matching RAG index, evidence permission, template, and provider are required.",
      );
    }
  }

  async function review(
    action: "APPROVE_VERSION" | "REQUEST_CHANGES",
  ): Promise<void> {
    const draft = drafts.find(({ id }) => id === selectedDraft);
    if (draft === undefined || version === null) return;
    const rationale = window.prompt(
      action === "APPROVE_VERSION"
        ? "Approval rationale (minimum 10 characters)"
        : "Requested changes and rationale",
    );
    if (rationale === null) return;
    try {
      await apiRequest(
        `${base}/drafts/${draft.id}/versions/${version.id}/reviews`,
        {
          body: JSON.stringify({ action, rationale }),
          method: "POST",
        },
      );
      await loadVersion();
    } catch {
      setStatus(
        "Review action was blocked by permissions, separation of duties, unsupported claims, placeholders, conflicts, or stale sources.",
      );
    }
  }

  return (
    <section aria-labelledby="draft-heading">
      <h2 id="draft-heading">Fact-constrained tender draft</h2>
      <div className="warning" role="note">
        <p>This is an AI-assisted first draft, not a final bid package.</p>
        <p>
          Draft content is limited to authorised tender sources and approved
          evidence.
        </p>
        <p>Unsupported inputs remain visible as placeholders.</p>
        <p>Human review is mandatory.</p>
        <p>
          Approval here does not complete the final readiness audit or authorise
          submission.
        </p>
        <p>
          The platform does not determine legal compliance, provide legal
          advice, or guarantee bid success.
        </p>
      </div>
      {templates.length === 0 && (
        <button onClick={() => void createControlledTemplate()} type="button">
          Create controlled draft template
        </button>
      )}
      <form onSubmit={(event) => void startGeneration(event)}>
        <label>
          Draft title
          <input maxLength={200} name="title" required />
        </label>
        <label>
          Authorised source mode
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as SourceMode)}
          >
            <option value="TENDER_ONLY">Tender only</option>
            <option value="TENDER_AND_APPROVED_COMPANY_EVIDENCE">
              Tender and approved company evidence
            </option>
            <option value="TENDER_AND_DERIVED_WORKFLOW_RECORDS">
              Tender and derived workflow warnings
            </option>
            <option value="FULL_AUTHORISED_TENDER_CONTEXT">
              Full authorised context
            </option>
          </select>
        </label>
        <label>
          Writing preference only (not factual evidence)
          <textarea maxLength={2000} name="instructions" />
        </label>
        <button disabled={templates.length === 0} type="submit">
          Generate controlled first draft
        </button>
      </form>
      {status !== "" && <p aria-live="polite">{status}</p>}
      <h3>Generation history</h3>
      {runs.map((run) => (
        <p key={run.id}>
          {humanizeEnum(run.currentStage)} · {humanizeEnum(run.status)} ·{" "}
          {run.progressPercentage}% · {run.validatedClaimCount} validated claims
          · {run.citationCount} citations · {run.placeholderCount} placeholders
          {run.safeFailureCode === null ? "" : ` · ${run.safeFailureCode}`}
        </p>
      ))}
      <label>
        Draft
        <select
          value={selectedDraft}
          onChange={(event) => setSelectedDraft(event.target.value)}
        >
          <option value="">Select a draft</option>
          {drafts.map((draft) => (
            <option key={draft.id} value={draft.id}>
              {draft.title} · {draft.lifecycle}
            </option>
          ))}
        </select>
      </label>
      {version !== null && (
        <article aria-labelledby="draft-version-heading">
          <h3>Version history</h3>
          <ol>
            {versionHistory.map((item) => (
              <li key={item.id}>
                Version {item.versionNumber} · {humanizeEnum(item.reviewState)}
                {item.invalidatedAt === null ? "" : " · invalidated"}
              </li>
            ))}
          </ol>
          <h3 id="draft-version-heading">
            Version {version.versionNumber} ·{" "}
            {humanizeEnum(version.reviewState)}
          </h3>
          {version.invalidatedAt !== null && (
            <p className="warning">
              This version is invalidated and not current.
            </p>
          )}
          {version.sections.map((section) => (
            <section key={section.id}>
              <h4>{section.heading}</h4>
              <div className="draft-content">{section.content}</div>
              <h5>Claim support</h5>
              {section.claims.map((claim) => (
                <div key={claim.id}>
                  <p>
                    {humanizeEnum(claim.claimClass)} ·{" "}
                    {humanizeEnum(claim.supportState)}: {claim.claimText}
                  </p>
                  {claim.citations.map((citation) => (
                    <details key={`${claim.id}-${citation.handle}`}>
                      <summary>
                        {citation.handle}: {citation.documentName}
                        {citation.pageNumber === null
                          ? ""
                          : `, page ${citation.pageNumber}`}
                        {citation.clauseLabel === null
                          ? ""
                          : `, ${citation.clauseLabel}`}
                      </summary>
                      <p>{citation.excerpt}</p>
                    </details>
                  ))}
                </div>
              ))}
              {section.placeholders.length > 0 && <h5>Placeholders</h5>}
              {section.placeholders.map((placeholder) => (
                <div className="warning" key={placeholder.id}>
                  <strong>{placeholder.markerText}</strong>
                  <p>
                    {placeholder.explanation} ·{" "}
                    {humanizeEnum(placeholder.resolutionState)}
                    {placeholder.approvalBlocking ? " · blocks approval" : ""}
                  </p>
                </div>
              ))}
            </section>
          ))}
          <button onClick={() => void review("REQUEST_CHANGES")} type="button">
            Request changes
          </button>
          <button onClick={() => void review("APPROVE_VERSION")} type="button">
            Approve for final readiness review
          </button>
        </article>
      )}
    </section>
  );
}
