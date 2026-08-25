"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type JSX,
} from "react";
import { Badge, Button } from "@tender/ui";
import { apiRequest, formatApiError } from "../lib/api";
import { humanizeEnum } from "@tender/ui";
import { RationaleDialog } from "./rationale-dialog";

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

function isSectionReady(section: Section): boolean {
  const state = section.reviewState.toUpperCase();
  return (
    (state.includes("COMPLETE") || state.includes("APPROVED")) &&
    section.placeholders.every((placeholder) => !placeholder.approvalBlocking)
  );
}

function describeDraftReviewState(reviewState: string | null): {
  readonly detail: string;
  readonly label: string;
} {
  switch (reviewState) {
    case "IN_REVIEW":
      return {
        detail:
          "This draft is with a reviewer now. Changes and approval stay recorded on the draft itself.",
        label: "Review requested",
      };
    case "CHANGES_REQUESTED":
      return {
        detail:
          "Reviewer feedback is still outstanding before the draft can move forward.",
        label: "Changes requested",
      };
    case "APPROVED":
      return {
        detail:
          "This draft version is approved for final review readiness checks.",
        label: "Approved for final review",
      };
    case "REJECTED":
      return {
        detail:
          "This draft version was rejected and needs a new reviewed version.",
        label: "Rejected",
      };
    default:
      return {
        detail:
          "Create the draft, then request review when the content is ready.",
        label: "Not yet requested",
      };
  }
}

export function DraftWorkspace({
  onOpenReview,
  organisationId,
  tenderId,
}: {
  readonly onOpenReview?: () => void;
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
  const [selectedSectionId, setSelectedSectionId] = useState("");
  const [mode, setMode] = useState<SourceMode>("TENDER_ONLY");
  const [reviewAction, setReviewAction] = useState<
    "APPROVE_VERSION" | "REQUEST_CHANGES" | "START_REVIEW" | null
  >(null);
  const draftSetupDetails = useRef<HTMLDetailsElement>(null);
  const [draftSetupOpen, setDraftSetupOpen] = useState(false);
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

  useEffect(() => {
    if (version === null || version.sections.length === 0) {
      setSelectedSectionId("");
      return;
    }
    setSelectedSectionId((current) =>
      current === "" ||
      !version.sections.some((section) => section.id === current)
        ? (version.sections[0]?.id ?? "")
        : current,
    );
  }, [version]);

  async function createControlledTemplate(): Promise<void> {
    setStatus("Creating draft template…");
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
    setStatus("Verifying drafting authority...");
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
      setStatus("Draft generation started. Review will be required.");
      await load();
    } catch (error) {
      setStatus(
        formatApiError(
          error,
          "Generation could not start. Current extraction, assessment, checklist, evidence permission, template, and provider authority are required.",
        ),
      );
    }
  }

  async function review(
    action: "APPROVE_VERSION" | "REQUEST_CHANGES" | "START_REVIEW",
    rationale: string,
  ): Promise<void> {
    const draft = drafts.find(({ id }) => id === selectedDraft);
    if (draft === undefined || version === null) return;
    try {
      await apiRequest(
        `${base}/drafts/${draft.id}/versions/${version.id}/reviews`,
        {
          body: JSON.stringify({ action, rationale }),
          method: "POST",
        },
      );
      setReviewAction(null);
      await loadVersion();
    } catch (error) {
      setStatus(
        formatApiError(
          error,
          "Review action was blocked by permissions, separation of duties, unsupported claims, placeholders, conflicts, or stale sources.",
        ),
      );
    }
  }

  function focusDraftSetup(): void {
    if (draftSetupDetails.current !== null) {
      draftSetupDetails.current.open = true;
    }
    setDraftSetupOpen(true);
    window.setTimeout(() => {
      document.getElementById("draft-title-input")?.focus();
    }, 0);
  }

  const selectedSection =
    version?.sections.find((section) => section.id === selectedSectionId) ??
    null;
  const readiness =
    version === null || version.sections.length === 0
      ? null
      : Math.round(
          (version.sections.filter(isSectionReady).length /
            version.sections.length) *
            100,
        );
  const blockingPlaceholders =
    selectedSection?.placeholders.filter(
      (placeholder) => placeholder.approvalBlocking,
    ) ?? [];
  const reviewSummary = describeDraftReviewState(version?.reviewState ?? null);
  const showPrimaryDraftSetup =
    version === null && drafts.length === 0 && draftSetupOpen;
  const draftSetupForm = (
    <>
      <h4>Start a new AI-assisted draft</h4>
      <p>This is an AI-assisted first draft, not a final bid package.</p>
      <p>Human review is mandatory.</p>
      <p>
        The platform does not determine legal compliance, provide legal advice,
        or guarantee bid success.
      </p>
      <form onSubmit={(event) => void startGeneration(event)}>
        <label>
          Draft title
          <input id="draft-title-input" maxLength={200} name="title" required />
        </label>
        <details className="disclosure" style={{ margin: "16px 0" }}>
          <summary>Advanced settings</summary>
          <div className="disclosure__body">
            <label>
              Source scope
              <select
                value={mode}
                onChange={(event) => setMode(event.target.value as SourceMode)}
              >
                <option value="TENDER_ONLY">Tender only</option>
                <option value="TENDER_AND_APPROVED_COMPANY_EVIDENCE">
                  Tender and company evidence
                </option>
                <option value="TENDER_AND_DERIVED_WORKFLOW_RECORDS">
                  Tender and workflow warnings
                </option>
                <option value="FULL_AUTHORISED_TENDER_CONTEXT">
                  Use all approved documents
                </option>
              </select>
            </label>
            <label>
              Writing preferences
              <textarea maxLength={2000} name="instructions" />
            </label>
          </div>
        </details>
        <button disabled={templates.length === 0} type="submit">
          Generate draft
        </button>
      </form>
    </>
  );

  return (
    <section aria-labelledby="draft-heading" className="draft-columns">
      <div className="workspace-card draft-nav">
        {version === null || version.sections.length === 0 ? (
          <div className="workspace-empty-row">
            <p>No draft sections yet.</p>
          </div>
        ) : (
          version.sections.map((section, index) => (
            <button
              className={`draft-nav__item ${section.id === selectedSectionId ? "draft-nav__item--active" : ""}`}
              key={section.id}
              onClick={() => setSelectedSectionId(section.id)}
              type="button"
            >
              <strong>
                {index + 1}. {section.heading}
              </strong>
              <Badge tone={isSectionReady(section) ? "success" : "warning"}>
                {humanizeEnum(section.reviewState)}
              </Badge>
            </button>
          ))
        )}
      </div>

      <div className="workspace-card draft-center">
        <h2 className="visually-hidden" id="draft-heading">
          Your proposal draft
        </h2>
        {version?.invalidatedAt != null && (
          <p className="warning">
            This version is out of date and needs refresh.
          </p>
        )}
        {selectedSection === null ? (
          <div className="draft-center__header">
            <div>
              <h3>Your proposal draft</h3>
              <p>
                Content stays limited to authorised tender sources and approved
                evidence; unsupported inputs remain visible as placeholders.
              </p>
            </div>
          </div>
        ) : null}
        {selectedSection === null ? (
          <div className="workspace-empty-row">
            {showPrimaryDraftSetup ? (
              <div style={{ display: "grid", gap: 16, width: "100%" }}>
                <div>
                  <h3>Start a new proposal draft</h3>
                  <p>
                    Create the first draft from current tender sources and
                    approved evidence. Unsupported inputs remain visible for
                    human review.
                  </p>
                </div>
                {draftSetupForm}
              </div>
            ) : (
              <p>
                {drafts.length === 0
                  ? "No draft has been created yet. Use Draft setup on the right to start one."
                  : "Select a section to review its content."}
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="requirement-detail__header">
              <div>
                <h3>{selectedSection.heading}</h3>
                <p style={{ margin: "2px 0 0", fontSize: "0.78rem" }}>
                  Content stays limited to authorised tender sources and
                  approved evidence.
                </p>
              </div>
              <Badge
                tone={isSectionReady(selectedSection) ? "success" : "warning"}
              >
                {humanizeEnum(selectedSection.reviewState)}
              </Badge>
            </div>
            <div className="draft-content">{selectedSection.content}</div>
            {blockingPlaceholders.length > 0 && (
              <div
                style={{
                  borderTop: "1px solid var(--border-subtle)",
                  marginTop: 16,
                  paddingTop: 14,
                }}
              >
                <h4>Placeholders</h4>
                {blockingPlaceholders.map((placeholder) => (
                  <p className="warning" key={placeholder.id}>
                    <strong>{placeholder.markerText}</strong> —{" "}
                    {placeholder.explanation}
                  </p>
                ))}
              </div>
            )}
            {selectedSection.claims.length > 0 && (
              <div>
                <h4>Supporting evidence</h4>
                <div className="draft-claim-list">
                  {selectedSection.claims.map((claim) => (
                    <div className="draft-claim" key={claim.id}>
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
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="workspace-card draft-rail">
        <div className="draft-rail__readiness">
          <strong>
            {version === null
              ? "—"
              : readiness === null
                ? "0%"
                : `${readiness}%`}
          </strong>
          <span>
            {version === null
              ? "No proposal draft yet"
              : "Sections ready for review"}
          </span>
        </div>
        {version !== null ? (
          <p style={{ fontSize: "0.76rem", margin: 0 }}>
            Version {version.versionNumber} ·{" "}
            {humanizeEnum(version.reviewState)}
          </p>
        ) : (
          <p style={{ fontSize: "0.76rem", margin: 0 }}>
            Set up the first draft to start writing and review.
          </p>
        )}
        <div style={{ display: "grid", gap: 8 }}>
          <strong>{reviewSummary.label}</strong>
          <p
            style={{
              color: "var(--text-secondary)",
              fontSize: "0.82rem",
              margin: 0,
            }}
          >
            {reviewSummary.detail}
          </p>
        </div>
        {version === null ? (
          <div className="draft-rail__actions">
            <Button onClick={focusDraftSetup} type="button">
              Set up draft
            </Button>
          </div>
        ) : (
          <div className="draft-rail__actions">
            <Button
              onClick={() => setReviewAction("START_REVIEW")}
              type="button"
              variant="secondary"
            >
              Request review
            </Button>
            <Button
              onClick={() => setReviewAction("REQUEST_CHANGES")}
              type="button"
              variant="secondary"
            >
              Request changes
            </Button>
            <Button
              onClick={() => setReviewAction("APPROVE_VERSION")}
              type="button"
            >
              Approve for final readiness review
            </Button>
            {onOpenReview !== undefined && (
              <Button onClick={onOpenReview} variant="secondary">
                Open review package
              </Button>
            )}
          </div>
        )}
        {onOpenReview !== undefined && version === null ? (
          <div className="draft-rail__actions">
            <Button onClick={onOpenReview} variant="secondary">
              Open review package
            </Button>
          </div>
        ) : null}
        <p aria-live="polite" style={{ fontSize: "0.76rem" }}>
          {status}
        </p>

        <details
          className="disclosure"
          onToggle={(event) =>
            setDraftSetupOpen((event.currentTarget as HTMLDetailsElement).open)
          }
          ref={draftSetupDetails}
        >
          <summary>
            Draft setup and history
            <small>
              Select drafts, review older versions, or start a new draft
            </small>
          </summary>
          <div className="disclosure__body tender-tools-panel">
            {drafts.length > 0 && (
              <label>
                Draft
                <select
                  value={selectedDraft}
                  onChange={(event) => setSelectedDraft(event.target.value)}
                >
                  <option value="">Select a draft</option>
                  {drafts.map((draft) => (
                    <option key={draft.id} value={draft.id}>
                      {draft.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {versionHistory.length > 0 && (
              <>
                <h4>Version history</h4>
                <ol>
                  {versionHistory.map((item) => (
                    <li key={item.id}>
                      Version {item.versionNumber} ·{" "}
                      {humanizeEnum(item.reviewState)}
                      {item.invalidatedAt === null ? "" : " · out of date"}
                    </li>
                  ))}
                </ol>
              </>
            )}
            {runs.length > 0 && (
              <>
                <h4>Draft history</h4>
                {runs.map((run) => (
                  <p key={run.id}>
                    {humanizeEnum(run.status)} · {run.progressPercentage}% ·{" "}
                    {run.validatedClaimCount} supported claims ·{" "}
                    {run.citationCount} citations · {run.placeholderCount}{" "}
                    placeholders
                    {run.safeFailureCode === null ? "" : " · needs attention"}
                  </p>
                ))}
              </>
            )}
            {templates.length === 0 && (
              <button
                onClick={() => void createControlledTemplate()}
                type="button"
              >
                Create controlled draft template
              </button>
            )}
            {showPrimaryDraftSetup ? (
              <p>
                Draft setup is open in the main workspace so you have more room
                to title the draft, choose evidence scope, and start generation.
              </p>
            ) : (
              draftSetupForm
            )}
          </div>
        </details>
      </div>
      {reviewAction !== null && (
        <RationaleDialog
          confirmLabel={
            reviewAction === "APPROVE_VERSION"
              ? "Approve draft"
              : reviewAction === "START_REVIEW"
                ? "Request review"
                : "Request changes"
          }
          description={
            reviewAction === "APPROVE_VERSION"
              ? "Approval stays recorded on the draft and unlocks downstream final-review checks."
              : reviewAction === "START_REVIEW"
                ? "Tell the reviewer what to focus on before the draft moves forward."
                : "Record the changes needed before this draft can move forward."
          }
          helperText="Enter at least 10 characters."
          onClose={() => setReviewAction(null)}
          onConfirm={(rationale) => review(reviewAction, rationale)}
          title={
            reviewAction === "APPROVE_VERSION"
              ? "Approve draft"
              : reviewAction === "START_REVIEW"
                ? "Request draft review"
                : "Request draft changes"
          }
        />
      )}
    </section>
  );
}
