"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type JSX,
} from "react";
import { Badge, Button, Modal } from "@tender/ui";
import { apiRequest, formatApiError, PublicApiError } from "../lib/api";
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
  sourceMode: SourceMode;
  status: string;
  title: string;
  validatedClaimCount: number;
}

interface RagIndexRun {
  id: string;
  safeFailureMessage?: string | null;
  status: string;
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

interface DraftFailurePresentation {
  readonly detail: string;
  readonly title: string;
}

function draftFailurePresentation(
  code: string | null | undefined,
): DraftFailurePresentation {
  const normalized = code?.toUpperCase() ?? "";
  if (
    normalized === "PROVIDER_UNAVAILABLE" ||
    normalized === "AI_PROVIDER_UNAVAILABLE" ||
    normalized === "PROVIDER_AUTH_FAILED" ||
    normalized === "PROVIDER_DEPENDENCY_UNAVAILABLE" ||
    normalized === "PROVIDER_MODEL_UNAVAILABLE" ||
    normalized === "PROVIDER_NETWORK_ERROR" ||
    normalized === "PROVIDER_QUOTA_EXHAUSTED" ||
    normalized === "PROVIDER_RATE_LIMITED" ||
    normalized === "PROVIDER_SERVICE_UNAVAILABLE" ||
    normalized === "PROVIDER_TIMEOUT" ||
    normalized === "SERVICE_UNAVAILABLE"
  )
    return {
      detail:
        "Your tender and review work are safe. Try again once the drafting service is available.",
      title: "Draft generation is temporarily unavailable.",
    };
  if (normalized === "NETWORK_ERROR")
    return {
      detail: "We couldn't reach the drafting service. Try again.",
      title: "We couldn't create the draft.",
    };
  if (normalized === "HTTP_401" || normalized === "HTTP_403")
    return {
      detail: "You don't have permission to perform this action.",
      title: "We couldn't create the draft.",
    };
  if (normalized === "HTTP_409" || normalized === "CONFLICT")
    return {
      detail:
        "The current tender prerequisites have changed. Complete eligibility review before creating a draft.",
      title: "We couldn't create the draft.",
    };
  return {
    detail: "Try again when the current tender sources and review are ready.",
    title: "We couldn't create the draft.",
  };
}

function draftStartFailurePresentation(
  error: unknown,
): DraftFailurePresentation {
  if (error instanceof PublicApiError) {
    if (error.status === 503 || error.code === "SERVICE_UNAVAILABLE")
      return draftFailurePresentation("PROVIDER_UNAVAILABLE");
    return draftFailurePresentation(error.code);
  }
  return draftFailurePresentation(null);
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
  onNavigateStage,
  onOpenReview,
  organisationId,
  tenderId,
  versionId = null,
}: {
  readonly onNavigateStage?: (
    stage: "ask" | "eligibility" | "overview",
  ) => void;
  readonly onOpenReview?: () => void;
  readonly organisationId: string;
  readonly tenderId: string;
  readonly versionId?: string | null;
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
  const [creationFailure, setCreationFailure] =
    useState<DraftFailurePresentation | null>(null);
  const [retryingGeneration, setRetryingGeneration] = useState(false);
  const draftPollInFlight = useRef(false);
  const draftLoadToken = useRef(0);
  const [draftingDataLoaded, setDraftingDataLoaded] = useState(false);
  const [status, setStatus] = useState("Loading drafting workspace…");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [showCreationForm, setShowCreationForm] = useState(false);
  const [sectionEditContent, setSectionEditContent] = useState("");
  const [savingSectionEdit, setSavingSectionEdit] = useState(false);

  async function ensureCurrentSourceIndex(): Promise<void> {
    if (versionId === null) return;
    setStatus("Preparing the current authorised source index...");
    let index = await apiRequest<RagIndexRun>(
      `${base}/versions/${versionId}/rag-indexes`,
      {
        body: JSON.stringify({
          idempotency_key: crypto.randomUUID(),
          source_mode: mode,
        }),
        method: "POST",
      },
    );
    for (let attempt = 0; attempt < 150; attempt += 1) {
      if (index.status === "COMPLETE") return;
      if (["FAILED", "CANCELLED", "INVALIDATED"].includes(index.status))
        throw new Error(
          index.safeFailureMessage ??
            "The authorised source index could not be prepared.",
        );
      await new Promise((resolve) => window.setTimeout(resolve, 1_000));
      index = await apiRequest<RagIndexRun>(`${base}/rag-indexes/${index.id}`);
    }
    throw new Error("The authorised source index is still processing.");
  }

  const load = useCallback(async (): Promise<void> => {
    const token = ++draftLoadToken.current;
    try {
      const [loadedTemplates, loadedRuns, loadedDrafts] = await Promise.all([
        apiRequest<readonly Template[]>(
          `${base}/draft-templates?draft_type=CONSOLIDATED_FIRST_DRAFT`,
        ),
        apiRequest<readonly Run[]>(`${base}/draft-generation-runs`),
        apiRequest<readonly Draft[]>(`${base}/drafts`),
      ]);
      if (token !== draftLoadToken.current) return;
      setTemplates(loadedTemplates);
      setRuns(loadedRuns);
      setDrafts(loadedDrafts);
      setDraftingDataLoaded(true);
      setSelectedDraft((current) =>
        current === "" ? (loadedDrafts[0]?.id ?? "") : current,
      );
      setStatus("");
    } catch {
      if (token !== draftLoadToken.current) return;
      setDraftingDataLoaded(true);
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
    return () => {
      draftLoadToken.current += 1;
    };
  }, [load]);

  const draftRunActive = runs.some(
    (run) =>
      !["COMPLETE", "FAILED", "CANCELLED", "INVALIDATED"].includes(run.status),
  );
  useEffect(() => {
    if (!draftRunActive) return;
    const timer = window.setInterval(() => {
      if (draftPollInFlight.current) return;
      draftPollInFlight.current = true;
      void load().finally(() => {
        draftPollInFlight.current = false;
      });
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [draftRunActive, load]);

  useEffect(() => {
    const refresh = (): void => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
    };
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
    setCreationFailure(null);
    setStatus("Verifying drafting authority...");
    try {
      await ensureCurrentSourceIndex();
      const run = await apiRequest<Run>(`${base}/draft-generation-runs`, {
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
      setRuns((current) => [
        run,
        ...current.filter((item) => item.id !== run.id),
      ]);
      setShowCreationForm(false);
      setStatus("Creating proposal draft...");
      await load();
    } catch (error) {
      const failure = draftStartFailurePresentation(error);
      setCreationFailure(failure);
      setStatus(failure.detail);
    }
  }

  async function retryGeneration(): Promise<void> {
    if (failedGeneration === undefined) {
      setCreationFailure(null);
      focusDraftSetup();
      return;
    }
    setCreationFailure(null);
    setRetryingGeneration(true);
    setStatus("Creating proposal draft...");
    try {
      let run: Run;
      try {
        run = await apiRequest<Run>(
          `${base}/draft-generation-runs/${failedGeneration.id}/retry`,
          {
            method: "POST",
          },
        );
      } catch (error) {
        if (!(error instanceof PublicApiError) || error.status !== 409)
          throw error;
        const template = templates.find(
          ({ activeVersionId }) => activeVersionId !== null,
        );
        if (template?.activeVersionId == null) throw error;
        await ensureCurrentSourceIndex();
        run = await apiRequest<Run>(`${base}/draft-generation-runs`, {
          body: JSON.stringify({
            draft_type: "CONSOLIDATED_FIRST_DRAFT",
            idempotency_key: crypto.randomUUID(),
            source_mode: failedGeneration.sourceMode ?? mode,
            template_version_id: template.activeVersionId,
            title: failedGeneration.title ?? "Proposal draft",
          }),
          method: "POST",
        });
      }
      setRuns((current) => [
        run,
        ...current.filter((item) => item.id !== run.id),
      ]);
      await load();
    } catch (error) {
      const failure = draftStartFailurePresentation(error);
      setCreationFailure(failure);
      setStatus(failure.detail);
    } finally {
      setRetryingGeneration(false);
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

  async function saveSectionEdit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    const draft = drafts.find(({ id }) => id === selectedDraft);
    if (draft === undefined || version === null || selectedSection === null)
      return;
    const values = new FormData(event.currentTarget);
    const changeSummary = values.get("change_summary");
    if (typeof changeSummary !== "string") return;
    setSavingSectionEdit(true);
    setStatus("Saving a new reviewable draft version...");
    try {
      const edited = await apiRequest<{ id: string }>(
        `${base}/drafts/${draft.id}/versions/${version.id}/edits`,
        {
          body: JSON.stringify({
            change_summary: changeSummary,
            sections: [
              {
                content: sectionEditContent,
                section_key: selectedSection.sectionKey,
              },
            ],
          }),
          method: "POST",
        },
      );
      const loadedVersion = await apiRequest<Version>(
        `${base}/drafts/${draft.id}/versions/${edited.id}`,
      );
      setVersion(loadedVersion);
      setStatus(
        "Section edit saved as a new version. Human-edited claims require review.",
      );
      await load();
    } catch (error) {
      setStatus(formatApiError(error, "The section edit could not be saved."));
    } finally {
      setSavingSectionEdit(false);
    }
  }

  function focusDraftSetup(): void {
    window.setTimeout(() => {
      document.getElementById("draft-title-input")?.focus();
    }, 0);
  }

  const selectedSection =
    version?.sections.find((section) => section.id === selectedSectionId) ??
    null;
  useEffect(() => {
    setSectionEditContent(selectedSection?.content ?? "");
  }, [selectedSection?.content, selectedSection?.id]);
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
  const sectionStatusCounts = version?.sections.reduce(
    (counts, section) => {
      if (section.placeholders.some((item) => item.approvalBlocking))
        counts.missing += 1;
      else if (isSectionReady(section)) counts.complete += 1;
      else if (section.reviewState.toUpperCase().includes("REVIEW"))
        counts.review += 1;
      else counts.input += 1;
      return counts;
    },
    { complete: 0, input: 0, missing: 0, review: 0 },
  ) ?? { complete: 0, input: 0, missing: 0, review: 0 };
  const reviewSummary = describeDraftReviewState(version?.reviewState ?? null);
  const activeGeneration = runs.find((run) =>
    [
      "QUEUED",
      "SNAPSHOTTING",
      "PLANNING",
      "RETRIEVING",
      "GENERATING",
      "VALIDATING",
    ].includes(run.status),
  );
  const failedGeneration = runs.find((run) => run.status === "FAILED");
  const activeTemplate = templates.find(
    ({ activeVersionId }) => activeVersionId !== null,
  );
  const draftCreationReason = !draftingDataLoaded
    ? "Checking whether a controlled draft template is available."
    : activeTemplate === undefined
      ? "A controlled draft template is required before a proposal can be created."
      : null;
  const draftSetupForm = (
    <>
      <h3>Create proposal draft</h3>
      <p>
        Start a working proposal using this tender's approved sources and
        company evidence. You'll review and edit every section before export.
      </p>
      <form onSubmit={(event) => void startGeneration(event)}>
        <label>
          Draft name
          <input id="draft-title-input" maxLength={200} name="title" required />
        </label>
        <details
          className="disclosure draft-advanced-settings"
          style={{ margin: "16px 0" }}
        >
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
                  Tender warnings
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
        <Button disabled={draftCreationReason !== null} type="submit">
          Create draft
        </Button>
        {draftCreationReason !== null ? (
          <div className="draft-create-form__blocker" role="status">
            <span>{draftCreationReason}</span>
            {draftingDataLoaded && templates.length === 0 ? (
              <Button
                onClick={() => void createControlledTemplate()}
                type="button"
                variant="quiet"
              >
                Create controlled template
              </Button>
            ) : null}
          </div>
        ) : null}
        <small>
          Generated content requires human review and does not determine legal
          compliance.
        </small>
      </form>
    </>
  );
  const selectedVersionSummary = versionHistory.find(
    (item) => item.id === version?.id,
  );
  const readinessLabel =
    readiness === null
      ? "Draft readiness is being calculated"
      : `${readiness}% ready`;
  const lastUpdatedLabel =
    selectedVersionSummary === undefined
      ? null
      : new Intl.DateTimeFormat(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(selectedVersionSummary.createdAt));

  return (
    <section aria-labelledby="draft-heading" className="draft-columns">
      <header className="draft-workspace-header">
        <div>
          <button
            className="tender-header__back"
            onClick={() => onNavigateStage?.("overview")}
            type="button"
          >
            ← Back to Overview
          </button>
          <h2 id="draft-heading">Your proposal draft</h2>
          <p>
            {readinessLabel}
            {lastUpdatedLabel === null
              ? ""
              : ` · Last updated ${lastUpdatedLabel}`}
          </p>
        </div>
        <Button
          disabled={version === null}
          onClick={() => setPreviewOpen(true)}
          type="button"
          variant="secondary"
        >
          Preview full draft
        </Button>
      </header>
      <nav aria-label="Draft workspace tabs" className="draft-workspace-tabs">
        <button onClick={() => onNavigateStage?.("overview")} type="button">
          Overview
        </button>
        <button onClick={() => onNavigateStage?.("eligibility")} type="button">
          Eligibility
        </button>
        <span aria-current="page" className="draft-workspace-tabs__active">
          Draft
        </span>
        <button onClick={() => onNavigateStage?.("ask")} type="button">
          AI Chat
        </button>
      </nav>
      <div className="workspace-card draft-nav">
        <h3>Draft sections</h3>
        {version === null || version.sections.length === 0 ? (
          <div className="workspace-empty-row">
            <p>Sections will appear after you create the proposal draft.</p>
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
        {version?.invalidatedAt != null && (
          <p className="warning">
            This version is out of date and needs refresh.
          </p>
        )}
        {showCreationForm ? (
          <div className="draft-create-form">{draftSetupForm}</div>
        ) : selectedSection === null ? (
          <div className="workspace-empty-row">
            {activeGeneration ? (
              <div className="draft-generation-state">
                <h3>Creating your proposal draft…</h3>
                <p>
                  {humanizeEnum(activeGeneration.currentStage)} ·{" "}
                  {activeGeneration.progressPercentage}%
                </p>
              </div>
            ) : failedGeneration || creationFailure !== null ? (
              <div className="draft-generation-state">
                <h3>
                  {
                    (
                      creationFailure ??
                      draftFailurePresentation(
                        failedGeneration?.safeFailureCode,
                      )
                    ).title
                  }
                </h3>
                <p>
                  {
                    (
                      creationFailure ??
                      draftFailurePresentation(
                        failedGeneration?.safeFailureCode,
                      )
                    ).detail
                  }
                </p>
                <Button
                  disabled={retryingGeneration}
                  loading={retryingGeneration}
                  onClick={() => void retryGeneration()}
                >
                  {retryingGeneration ? "Retrying..." : "Retry"}
                </Button>
              </div>
            ) : drafts.length === 0 ? (
              <div className="draft-create-form">{draftSetupForm}</div>
            ) : (
              <p>Select a section to review its content.</p>
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
            <details className="disclosure draft-section-edit">
              <summary>Edit this section</summary>
              <form onSubmit={(event) => void saveSectionEdit(event)}>
                <label>
                  Section content
                  <textarea
                    maxLength={12_000}
                    onChange={(event) =>
                      setSectionEditContent(event.target.value)
                    }
                    required
                    value={sectionEditContent}
                  />
                </label>
                <label>
                  Change summary
                  <input
                    maxLength={1_000}
                    minLength={10}
                    name="change_summary"
                    required
                  />
                </label>
                <Button
                  disabled={
                    savingSectionEdit ||
                    sectionEditContent === selectedSection.content
                  }
                  loading={savingSectionEdit}
                  type="submit"
                >
                  {savingSectionEdit ? "Saving..." : "Save as new version"}
                </Button>
              </form>
            </details>
            {blockingPlaceholders.length > 0 && (
              <div className="draft-missing-info">
                <h4>Information needed</h4>
                {blockingPlaceholders.map((placeholder) => (
                  <p className="warning" key={placeholder.id}>
                    <strong>{placeholder.markerText}</strong> —{" "}
                    {placeholder.explanation}
                  </p>
                ))}
              </div>
            )}
            {selectedSection.claims.length > 0 ? (
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
            ) : (
              <div className="workspace-empty-row draft-evidence-empty">
                <h4>Supporting evidence</h4>
                <p>No linked evidence is available for this section.</p>
              </div>
            )}
          </>
        )}
      </div>

      <div className="workspace-card draft-rail">
        <h3>Readiness</h3>
        <div className="draft-rail__readiness">
          <strong>
            {version === null
              ? "—"
              : readiness === null
                ? "0%"
                : `${readiness}%`}
          </strong>
          <span>
            {version === null ? "Draft not started" : "Overall draft readiness"}
          </span>
        </div>
        {version !== null ? (
          <div className="draft-readiness-breakdown">
            <span>
              <i className="status-dot status-dot--success" />
              {sectionStatusCounts.complete} Complete
            </span>
            <span>
              <i className="status-dot status-dot--warning" />
              {sectionStatusCounts.input} Need your input
            </span>
            <span>
              <i className="status-dot status-dot--info" />
              {sectionStatusCounts.review} Under review
            </span>
            <span>
              <i className="status-dot status-dot--danger" />
              {sectionStatusCounts.missing} Missing
            </span>
          </div>
        ) : null}
        {version !== null ? (
          <p style={{ fontSize: "0.76rem", margin: 0 }}>
            Version {version.versionNumber} ·{" "}
            {humanizeEnum(version.reviewState)}
          </p>
        ) : (
          <p style={{ fontSize: "0.76rem", margin: 0 }}>
            Eligibility and evidence checks remain visible in the tender
            workspace.
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
        {version === null ? null : (
          <div className="draft-rail__actions">
            <Button
              onClick={() => setReviewAction("START_REVIEW")}
              type="button"
              variant="secondary"
            >
              Request review
            </Button>
            <div className="draft-advanced-actions">
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
            </div>
            {onOpenReview !== undefined && (
              <>
                <Button onClick={onOpenReview}>Review & Export</Button>
              </>
            )}
            {activeTemplate !== undefined && (
              <Button
                onClick={() => setShowCreationForm(true)}
                type="button"
                variant="secondary"
              >
                Create another draft
              </Button>
            )}
          </div>
        )}
        <p
          aria-live="polite"
          className="draft-rail__status"
          style={{ fontSize: "0.76rem" }}
        >
          {creationFailure === null ? status : ""}
        </p>

        <details className="disclosure draft-history">
          <summary>
            Draft history
            <small>Select another draft or review previous versions</small>
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
              ? "Approval stays recorded on the draft and enables final readiness checks."
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
      {previewOpen && version !== null ? (
        <Modal
          label="Full proposal draft preview"
          onClose={() => setPreviewOpen(false)}
        >
          <div className="draft-preview">
            <div className="draft-preview__header">
              <div>
                <h2>Full proposal draft</h2>
                <p>
                  Version {version.versionNumber} · {readinessLabel}
                </p>
              </div>
              <Badge tone={readiness === 100 ? "success" : "warning"}>
                {humanizeEnum(version.reviewState)}
              </Badge>
            </div>
            {version.sections.length === 0 ? (
              <div className="workspace-empty-row">
                <p>No draft sections are available to preview yet.</p>
              </div>
            ) : (
              <ol className="draft-preview__sections">
                {version.sections.map((section, index) => (
                  <li key={section.id}>
                    <h3>
                      {index + 1}. {section.heading}
                    </h3>
                    <p>{section.content}</p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </Modal>
      ) : null}
    </section>
  );
}
