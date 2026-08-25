import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import type { BrowserContext, Page, Route } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../packages/database/src/index";

const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error(
    "DATABASE_URL must be set for tender workspace browser validation.",
  );
}

const prisma = createPrismaClient(databaseUrl);
const apiBaseUrl =
  process.env.API_PUBLIC_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://127.0.0.1:4000";
const PASSWORD = "WorkspaceFlowPassword123";
const REQUEST_TIMEOUT_MS = 90_000;
const MOCK_TENDER_ID = "mock-tender-live-flow";
const MOCK_VERSION_ID = "mock-version-live-flow";
const MOCK_RISK_ID = "mock-risk-live-flow";
const MOCK_EXTRACTION_ID = "mock-extraction-live-flow";
const MOCK_ASSESSMENT_ID = "mock-assessment-live-flow";
const MOCK_CHECKLIST_ID = "mock-checklist-live-flow";

interface BrowserFixture {
  readonly organisationId: string;
  readonly user: {
    readonly displayName: string;
    readonly email: string;
  };
}

type MockResponse<T> =
  | { readonly data: T; readonly status?: 200 }
  | {
      readonly code: string;
      readonly message: string;
      readonly status: number;
    };

type WorkspaceMockHandlers = {
  readonly assessmentRuns?: () => unknown;
  readonly checklistItems?: (
    method: string,
    body: unknown,
  ) => MockResponse<unknown>;
  readonly checklistRuns?: () => unknown;
  readonly currentAssessment?: () => MockResponse<unknown>;
  readonly currentChecklist?: () => MockResponse<unknown>;
  readonly currentRisk?: () => MockResponse<unknown>;
  readonly decisions?: (method: string, body: unknown) => MockResponse<unknown>;
  readonly draftRuns?: () => unknown;
  readonly draftTemplates?: () => unknown;
  readonly drafts?: () => unknown;
  readonly extractionFields?: () => unknown;
  readonly extractionIssues?: () => unknown;
  readonly extractionRequirements?: () => unknown;
  readonly extractions?: () => unknown;
  readonly finalReadiness?: () => unknown;
  readonly matrix?: () => MockResponse<unknown>;
  readonly packageHistory?: () => unknown;
  readonly riskAnalyses?: () => unknown;
  readonly riskFindings?: () => unknown;
  readonly tenderSummary?: () => unknown;
  readonly workspace: () => unknown;
};

let fixture: BrowserFixture;
let authenticatedCookies: Awaited<
  ReturnType<BrowserContext["cookies"]>
> | null = null;

test.beforeAll(async () => {
  fixture = await seedFixture();
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("reconciles source-processing progress in the open workspace without reload", async ({
  page,
}) => {
  await preparePage(page, 250);
  let supportPhase = 0;

  await installWorkspaceApiMock(page, fixture.organisationId, {
    currentAssessment: () =>
      notFound("NO_CURRENT_ELIGIBILITY", "No current eligibility assessment."),
    currentChecklist: () =>
      notFound("NO_CURRENT_CHECKLIST", "No current checklist."),
    currentRisk: () =>
      supportPhase >= 2
        ? ok(currentRiskRun())
        : notFound("NO_CURRENT_RISK", "No current risk run."),
    decisions: () => ok([]),
    draftRuns: () => [],
    drafts: () => [],
    extractionFields: () => [],
    extractionIssues: () => [],
    extractionRequirements: () => [],
    extractions: () => {
      supportPhase += 1;
      return supportPhase >= 2 ? [completeExtractionRun()] : [];
    },
    finalReadiness: () => ({ items: [], next_cursor: null }),
    packageHistory: () => ({ items: [], next_cursor: null }),
    riskAnalyses: () => (supportPhase >= 2 ? [currentRiskRun()] : []),
    riskFindings: () => [],
    tenderSummary: () => [
      tenderSummary({
        workflowState:
          supportPhase >= 2
            ? reviewReadyWorkflowState()
            : extractingWorkflowState(),
      }),
    ],
    workspace: () => ({
      ...workspaceEnvelope(),
      workflowState:
        supportPhase >= 2
          ? reviewReadyWorkflowState()
          : extractingWorkflowState(),
    }),
  });

  await page.goto(`/tenders/${fixture.organisationId}/${MOCK_TENDER_ID}`);

  await expect(
    page.getByRole("button", { name: "View source processing" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Record pursue decision" }),
  ).toBeVisible();
});

test("moves the open workspace into current eligibility after Continue without reload", async ({
  page,
}) => {
  await preparePage(page, 250);
  let decisionRecorded = false;
  let assessmentPolls = 0;

  await installWorkspaceApiMock(page, fixture.organisationId, {
    assessmentRuns: () => {
      if (!decisionRecorded) return [];
      assessmentPolls += 1;
      return assessmentPolls >= 2 ? [completeAssessmentRun()] : [];
    },
    currentAssessment: () => {
      if (!decisionRecorded || assessmentPolls < 2) {
        return notFound(
          "NO_CURRENT_ELIGIBILITY",
          "No current eligibility assessment.",
        );
      }
      return ok(completeAssessmentRun());
    },
    currentChecklist: () =>
      notFound("NO_CURRENT_CHECKLIST", "No current checklist."),
    currentRisk: () => ok(currentRiskRun()),
    decisions: (method, body) => {
      if (method === "POST") {
        decisionRecorded = true;
        const parsed = asRecord(body);
        expect(parsed?.decision).toBe("CONTINUE");
        return ok({
          acknowledgedLimitations: true,
          createdAt: "2026-08-24T10:45:00.000Z",
          decision: "CONTINUE",
          id: "decision-live-flow",
          rationale: String(parsed?.rationale ?? ""),
          riskAnalysisRunId: MOCK_RISK_ID,
          supersededAt: null,
          tenderVersionId: MOCK_VERSION_ID,
        });
      }
      return ok(
        decisionRecorded
          ? [
              {
                acknowledgedLimitations: true,
                createdAt: "2026-08-24T10:45:00.000Z",
                decision: "CONTINUE",
                id: "decision-live-flow",
                rationale:
                  "Proceed after reviewing the cited extraction and risk summary.",
                riskAnalysisRunId: MOCK_RISK_ID,
                supersededAt: null,
                tenderVersionId: MOCK_VERSION_ID,
              },
            ]
          : [],
      );
    },
    draftRuns: () => [],
    drafts: () => [],
    extractionFields: () => [],
    extractionIssues: () => [],
    extractionRequirements: () => [
      {
        category: "DELIVERY",
        citations: [],
        confidence: "HIGH",
        findingState: "SUPPORTED",
        id: "requirement-source-1",
        normalizedStatement: "Complete the work within 90 days.",
        obligation: "MANDATORY",
        reviewState: "UNREVIEWED",
        sourceWording: "Complete the work within 90 days.",
        title: "Delivery timeline",
      },
    ],
    extractions: () => [completeExtractionRun()],
    finalReadiness: () => ({ items: [], next_cursor: null }),
    matrix: () =>
      ok({
        counts: [{ _count: 1, currentState: "HUMAN_REVIEW_REQUIRED" }],
        items: [assessmentMatrixItem()],
        total: 1,
      }),
    packageHistory: () => ({ items: [], next_cursor: null }),
    riskAnalyses: () => [currentRiskRun()],
    riskFindings: () => [],
    tenderSummary: () => [
      tenderSummary({ workflowState: reviewReadyWorkflowState() }),
    ],
    workspace: () => ({
      ...workspaceEnvelope(),
      workflowState: decisionRecorded
        ? comparingEligibilityWorkflowState()
        : reviewReadyWorkflowState(),
    }),
  });

  await page.goto(`/tenders/${fixture.organisationId}/${MOCK_TENDER_ID}`);

  await page.getByLabel("Decision").selectOption("CONTINUE");
  await page
    .getByLabel("Rationale")
    .fill(
      "Proceed after reviewing the cited extraction and risk summary for the current source.",
    );
  await page
    .getByRole("checkbox", {
      name: "I understand the unresolved findings and source limits still need human judgment.",
    })
    .check();
  await page.getByRole("button", { name: "Save decision" }).click();
  await expect.poll(() => decisionRecorded).toBe(true);
  await expect(page.getByText("Human pursue decision recorded.")).toBeVisible();

  await page
    .getByRole("navigation", { name: "Tender workspace primary" })
    .getByRole("button", { exact: true, name: "Requirements" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Requirements" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Delivery timeline" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review requirement" }),
  ).toBeVisible();
});

test("makes the draft surface available automatically once prerequisites become current", async ({
  page,
}) => {
  await preparePage(page, 25);
  let assessmentPolls = 0;

  await installWorkspaceApiMock(page, fixture.organisationId, {
    assessmentRuns: () => {
      assessmentPolls += 1;
      return assessmentPolls >= 2 ? [completeAssessmentRun()] : [];
    },
    currentAssessment: () =>
      assessmentPolls >= 2
        ? ok(completeAssessmentRun())
        : notFound(
            "NO_CURRENT_ELIGIBILITY",
            "No current eligibility assessment.",
          ),
    currentChecklist: () =>
      notFound("NO_CURRENT_CHECKLIST", "No current checklist."),
    currentRisk: () => ok(currentRiskRun()),
    decisions: () =>
      ok([
        {
          acknowledgedLimitations: true,
          createdAt: "2026-08-24T10:45:00.000Z",
          decision: "CONTINUE",
          id: "decision-live-flow",
          rationale:
            "Continue after reviewing the latest cited extraction and risk summary.",
          riskAnalysisRunId: MOCK_RISK_ID,
          supersededAt: null,
          tenderVersionId: MOCK_VERSION_ID,
        },
      ]),
    draftRuns: () => [],
    draftTemplates: () => [],
    drafts: () => [],
    extractionFields: () => [],
    extractionIssues: () => [],
    extractionRequirements: () => [],
    extractions: () => [completeExtractionRun()],
    finalReadiness: () => ({ items: [], next_cursor: null }),
    matrix: () => ok({ counts: [], items: [], total: 0 }),
    packageHistory: () => ({ items: [], next_cursor: null }),
    riskAnalyses: () => [currentRiskRun()],
    riskFindings: () => [],
    tenderSummary: () => [
      tenderSummary({ workflowState: comparingEligibilityWorkflowState() }),
    ],
    workspace: () => ({
      ...workspaceEnvelope(),
      workflowState:
        assessmentPolls >= 2
          ? readyForDraftWorkflowState()
          : comparingEligibilityWorkflowState(),
    }),
  });

  await page.goto(
    `/tenders/${fixture.organisationId}/${MOCK_TENDER_ID}?stage=draft`,
  );

  await expect(page.getByText("Drafting is currently blocked")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Set up draft" }),
  ).toBeVisible();
});

test("keeps rationale typing stable while eligibility and checklist polling stay active", async ({
  page,
}) => {
  await preparePage(page, 25);
  const savedBodies: Record<string, unknown>[] = [];
  let currentStatus = "OPEN";

  await installWorkspaceApiMock(page, fixture.organisationId, {
    assessmentRuns: () => [completeAssessmentRun()],
    checklistItems: (method, body) => {
      if (method === "PATCH") {
        currentStatus = "IN_PROGRESS";
        const parsed = asRecord(body) ?? {};
        savedBodies.push(parsed);
        return ok({ ok: true });
      }
      return ok({
        items: [
          {
            assessmentLinks: [],
            completionCriteria:
              "An authorised reviewer records the cited tender interpretation.",
            currentDueDate: null,
            currentPriority: "HIGH",
            currentTitle: "Review ambiguous requirement",
            dateIsOfficial: false,
            evidenceNeedCategory: "LEGAL_INTERPRETATION",
            id: "checklist-item-1",
            itemType: "REVIEW_ACTION",
            proposedExplanation:
              "Record the current human review rationale against the cited tender clause.",
            requirementLinks: [],
            status: currentStatus,
          },
        ],
        priority_counts: [{ _count: 1, currentPriority: "HIGH" }],
        status_counts: [{ _count: 1, status: currentStatus }],
        total: 1,
      });
    },
    checklistRuns: () => [currentChecklistRun()],
    currentAssessment: () => ok(completeAssessmentRun()),
    currentChecklist: () => ok(currentChecklistRun()),
    currentRisk: () => ok(currentRiskRun()),
    decisions: () =>
      ok([
        {
          acknowledgedLimitations: true,
          createdAt: "2026-08-24T10:45:00.000Z",
          decision: "CONTINUE",
          id: "decision-live-flow",
          rationale:
            "Continue after reviewing the latest cited extraction and risk summary.",
          riskAnalysisRunId: MOCK_RISK_ID,
          supersededAt: null,
          tenderVersionId: MOCK_VERSION_ID,
        },
      ]),
    draftRuns: () => [],
    drafts: () => [],
    extractionFields: () => [],
    extractionIssues: () => [],
    extractionRequirements: () => [],
    extractions: () => [completeExtractionRun()],
    finalReadiness: () => ({ items: [], next_cursor: null }),
    matrix: () =>
      ok({
        counts: [{ _count: 1, currentState: "HUMAN_REVIEW_REQUIRED" }],
        items: [assessmentMatrixItem()],
        total: 1,
      }),
    packageHistory: () => ({ items: [], next_cursor: null }),
    riskAnalyses: () => [currentRiskRun()],
    riskFindings: () => [],
    tenderSummary: () => [
      tenderSummary({ workflowState: readyForDraftWorkflowState() }),
    ],
    workspace: () => ({
      ...workspaceEnvelope(),
      workflowState: readyForDraftWorkflowState(),
    }),
  });

  await page.goto(
    `/tenders/${fixture.organisationId}/${MOCK_TENDER_ID}?stage=eligibility`,
  );

  await page
    .getByRole("button", { name: "Review ambiguous requirement" })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Review ambiguous requirement",
  });
  const rationale = dialog.getByRole("textbox", { name: "Rationale" });
  const sentence = "Reviewed against the cited tender clause";

  await expect(dialog).toBeVisible();
  await rationale.click();
  await rationale.type(sentence, { delay: 10 });

  await expect(rationale).toHaveValue(sentence);
  await expect(rationale).toBeFocused();
  await expect(dialog).toBeVisible();
  expect(savedBodies).toHaveLength(0);

  await dialog.getByRole("button", { name: "Save update" }).click();

  await expect
    .poll(() => savedBodies.length, { timeout: REQUEST_TIMEOUT_MS })
    .toBe(1);
  expect(savedBodies[0]).toMatchObject({
    rationale: sentence,
    status: "IN_PROGRESS",
  });
});

function ok<T>(data: T): MockResponse<T> {
  return { data, status: 200 };
}

function notFound(code: string, message: string): MockResponse<never> {
  return { code, message, status: 404 };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

async function installWorkspaceApiMock(
  page: Page,
  organisationId: string,
  handlers: WorkspaceMockHandlers,
): Promise<void> {
  const prefix = new RegExp(
    `^${escapeRegExp(apiBaseUrl)}/organisations/${organisationId}/tenders(?:$|/|\\?)`,
  );
  await page.route(prefix, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const bodyText = request.postData();
    const body = bodyText === null ? null : JSON.parse(bodyText);
    const pathname = url.pathname;

    if (pathname === `/organisations/${organisationId}/tenders`) {
      await fulfillData(route, handlers.tenderSummary?.() ?? []);
      return;
    }
    if (
      pathname === `/organisations/${organisationId}/tenders/${MOCK_TENDER_ID}`
    ) {
      await fulfillData(route, handlers.workspace());
      return;
    }
    if (
      pathname ===
      `/organisations/${organisationId}/tenders/${MOCK_TENDER_ID}/versions/${MOCK_VERSION_ID}/extractions`
    ) {
      await fulfillData(route, handlers.extractions?.() ?? []);
      return;
    }
    if (
      pathname ===
      `/organisations/${organisationId}/tenders/${MOCK_TENDER_ID}/extractions/${MOCK_EXTRACTION_ID}/requirements`
    ) {
      await fulfillData(route, handlers.extractionRequirements?.() ?? []);
      return;
    }
    if (
      pathname ===
      `/organisations/${organisationId}/tenders/${MOCK_TENDER_ID}/extractions/${MOCK_EXTRACTION_ID}/fields`
    ) {
      await fulfillData(route, handlers.extractionFields?.() ?? []);
      return;
    }
    if (
      pathname ===
      `/organisations/${organisationId}/tenders/${MOCK_TENDER_ID}/extractions/${MOCK_EXTRACTION_ID}/issues`
    ) {
      await fulfillData(route, handlers.extractionIssues?.() ?? []);
      return;
    }
    if (
      pathname ===
      `/organisations/${organisationId}/tenders/${MOCK_TENDER_ID}/versions/${MOCK_VERSION_ID}/risk-analyses`
    ) {
      await fulfillData(route, handlers.riskAnalyses?.() ?? []);
      return;
    }
    if (
      pathname ===
      `/organisations/${organisationId}/tenders/${MOCK_TENDER_ID}/versions/${MOCK_VERSION_ID}/risk-analyses/current`
    ) {
      await fulfillMockResponse(
        route,
        handlers.currentRisk?.() ??
          notFound("NO_CURRENT_RISK", "No current risk run."),
      );
      return;
    }
    if (
      pathname ===
      `/organisations/${organisationId}/tenders/${MOCK_TENDER_ID}/risk-analyses/${MOCK_RISK_ID}/findings`
    ) {
      await fulfillData(route, handlers.riskFindings?.() ?? []);
      return;
    }
    if (
      pathname ===
      `/organisations/${organisationId}/tenders/${MOCK_TENDER_ID}/risk-analyses/${MOCK_RISK_ID}/decisions`
    ) {
      await fulfillMockResponse(
        route,
        handlers.decisions?.(method, body) ?? ok([]),
      );
      return;
    }
    if (
      pathname ===
      `/organisations/${organisationId}/tenders/${MOCK_TENDER_ID}/versions/${MOCK_VERSION_ID}/eligibility-assessments`
    ) {
      await fulfillData(route, handlers.assessmentRuns?.() ?? []);
      return;
    }
    if (
      pathname ===
      `/organisations/${organisationId}/tenders/${MOCK_TENDER_ID}/versions/${MOCK_VERSION_ID}/eligibility-assessments/current`
    ) {
      await fulfillMockResponse(
        route,
        handlers.currentAssessment?.() ??
          notFound(
            "NO_CURRENT_ELIGIBILITY",
            "No current eligibility assessment.",
          ),
      );
      return;
    }
    if (
      pathname ===
      `/organisations/${organisationId}/tenders/${MOCK_TENDER_ID}/eligibility-assessments/${MOCK_ASSESSMENT_ID}/matrix`
    ) {
      await fulfillMockResponse(
        route,
        handlers.matrix?.() ?? ok({ counts: [], items: [], total: 0 }),
      );
      return;
    }
    if (
      pathname ===
      `/organisations/${organisationId}/tenders/${MOCK_TENDER_ID}/versions/${MOCK_VERSION_ID}/checklists`
    ) {
      await fulfillData(route, handlers.checklistRuns?.() ?? []);
      return;
    }
    if (
      pathname ===
      `/organisations/${organisationId}/tenders/${MOCK_TENDER_ID}/versions/${MOCK_VERSION_ID}/checklists/current`
    ) {
      await fulfillMockResponse(
        route,
        handlers.currentChecklist?.() ??
          notFound("NO_CURRENT_CHECKLIST", "No current checklist."),
      );
      return;
    }
    if (
      pathname ===
        `/organisations/${organisationId}/tenders/${MOCK_TENDER_ID}/checklists/${MOCK_CHECKLIST_ID}/items` ||
      pathname.startsWith(
        `/organisations/${organisationId}/tenders/${MOCK_TENDER_ID}/checklists/${MOCK_CHECKLIST_ID}/items/`,
      )
    ) {
      await fulfillMockResponse(
        route,
        handlers.checklistItems?.(method, body) ??
          ok({
            items: [],
            priority_counts: [],
            status_counts: [],
            total: 0,
          }),
      );
      return;
    }
    if (
      pathname ===
      `/organisations/${organisationId}/tenders/${MOCK_TENDER_ID}/draft-templates`
    ) {
      await fulfillData(route, handlers.draftTemplates?.() ?? []);
      return;
    }
    if (
      pathname ===
      `/organisations/${organisationId}/tenders/${MOCK_TENDER_ID}/draft-generation-runs`
    ) {
      await fulfillData(route, handlers.draftRuns?.() ?? []);
      return;
    }
    if (
      pathname ===
      `/organisations/${organisationId}/tenders/${MOCK_TENDER_ID}/drafts`
    ) {
      await fulfillData(route, handlers.drafts?.() ?? []);
      return;
    }
    if (
      pathname ===
      `/organisations/${organisationId}/tenders/${MOCK_TENDER_ID}/versions/${MOCK_VERSION_ID}/final-readiness`
    ) {
      await fulfillData(
        route,
        handlers.finalReadiness?.() ?? { items: [], next_cursor: null },
      );
      return;
    }
    if (
      pathname ===
      `/organisations/${organisationId}/tenders/${MOCK_TENDER_ID}/versions/${MOCK_VERSION_ID}/controlled-review-packages`
    ) {
      await fulfillData(
        route,
        handlers.packageHistory?.() ?? { items: [], next_cursor: null },
      );
      return;
    }

    await route.continue();
  });
}

async function fulfillMockResponse(
  route: Route,
  response: MockResponse<unknown>,
): Promise<void> {
  if ("data" in response) {
    await fulfillData(route, response.data, response.status ?? 200);
    return;
  }
  await route.fulfill({
    body: JSON.stringify({
      error: {
        code: response.code,
        message: response.message,
      },
      request_id: "mock-request-id",
    }),
    contentType: "application/json",
    status: response.status,
  });
}

async function fulfillData(
  route: Route,
  data: unknown,
  status = 200,
): Promise<void> {
  await route.fulfill({
    body: JSON.stringify({ data }),
    contentType: "application/json",
    status,
  });
}

function workspaceEnvelope(): Record<string, unknown> {
  return {
    buyer: "Mock Buyer Department",
    corrigenda: [],
    id: MOCK_TENDER_ID,
    lifecycleStatus: "SOURCE_READY",
    processingJobs: [],
    sources: [],
    title: "Mock live reconciliation tender",
    versions: [
      {
        documents: [
          {
            createdAt: "2026-08-24T09:00:00.000Z",
            displayFilename: "mock-tender.pdf",
            id: "tender-document-1",
            role: "PRIMARY",
            sha256:
              "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            sizeBytes: "4096",
            status: "READY",
            uploadSessionExpiresAt: "2026-08-24T12:00:00.000Z",
          },
        ],
        id: MOCK_VERSION_ID,
        reason: "Initial mock tender source",
        versionNumber: 1,
      },
    ],
    workspace: { processingProgress: 100, sourceSectionStatus: "READY" },
  };
}

function tenderSummary(options: {
  readonly workflowState: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    buyer: "Mock Buyer Department",
    id: MOCK_TENDER_ID,
    isDemonstration: false,
    lifecycleStatus: "SOURCE_READY",
    sourceTenderNumber: "MOCK-001",
    submissionDeadline: "2026-09-30T10:00:00.000Z",
    title: "Mock live reconciliation tender",
    workflowState: options.workflowState,
    workspace: {
      processingProgress: 100,
      status: "SOURCE_READY",
    },
  };
}

function extractingWorkflowState(): Record<string, unknown> {
  return {
    actionLabel: "Open",
    code: "EXTRACTING",
    detail: "Reading the current tender source.",
    isCompleted: false,
    isDraft: false,
    isInProgress: true,
    needsAttention: false,
    onHold: false,
    statusLabel: "Reading tender...",
    tone: "info",
  };
}

function reviewReadyWorkflowState(): Record<string, unknown> {
  return {
    actionLabel: "Open",
    code: "REVIEW_READY",
    detail:
      "Source processing is complete. Review the tender and decide whether to Continue.",
    isCompleted: false,
    isDraft: false,
    isInProgress: false,
    needsAttention: true,
    onHold: false,
    statusLabel: "Ready for review",
    tone: "warning",
  };
}

function comparingEligibilityWorkflowState(): Record<string, unknown> {
  return {
    actionLabel: "Open",
    code: "COMPARING_ELIGIBILITY",
    detail: "Eligibility is updating against the latest Continue decision.",
    isCompleted: false,
    isDraft: false,
    isInProgress: true,
    needsAttention: false,
    onHold: false,
    statusLabel: "Eligibility in progress",
    tone: "info",
  };
}

function readyForDraftWorkflowState(): Record<string, unknown> {
  return {
    actionLabel: "Open",
    code: "DRAFTING",
    detail: "Current evidence is ready and drafting can begin.",
    isCompleted: false,
    isDraft: true,
    isInProgress: false,
    needsAttention: false,
    onHold: false,
    statusLabel: "Draft available",
    tone: "accent",
  };
}

function completeExtractionRun(): Record<string, unknown> {
  return {
    current_stage: "COMPLETE",
    id: MOCK_EXTRACTION_ID,
    parser_policy_version: "mock-parser-v1",
    progress_percentage: 100,
    public_message: "Extraction complete",
    quality_summary: {},
    source_fingerprint: "mock-source-fingerprint",
    status: "COMPLETE",
  };
}

function currentRiskRun(): Record<string, unknown> {
  return {
    created_at: "2026-08-24T10:30:00.000Z",
    id: MOCK_RISK_ID,
    is_current: true,
    safeFailureMessage: null,
    status: "COMPLETE",
  };
}

function completeAssessmentRun(): Record<string, unknown> {
  return {
    id: MOCK_ASSESSMENT_ID,
    invalidatedAt: null,
    progressPercentage: 100,
    publicMessage: "Comparison complete",
    snapshot: { capturedAt: "2026-08-24T11:00:00.000Z" },
    status: "COMPLETE",
  };
}

function currentChecklistRun(): Record<string, unknown> {
  return {
    assessmentRunId: MOCK_ASSESSMENT_ID,
    checklistPolicyVersion: "mock-checklist-policy-v1",
    completedAt: "2026-08-24T11:30:00.000Z",
    evidenceSnapshotId: "mock-snapshot-1",
    id: MOCK_CHECKLIST_ID,
    invalidatedAt: null,
    progressPercentage: 100,
    publicMessage: "Checklist complete",
    status: "COMPLETE",
  };
}

function assessmentMatrixItem(): Record<string, unknown> {
  return {
    currentState: "HUMAN_REVIEW_REQUIRED",
    evidenceLinks: [],
    id: "assessment-item-1",
    proposedConfidence: "MEDIUM",
    proposedRationale: "A reviewer must confirm the interpretation.",
    proposedState: "HUMAN_REVIEW_REQUIRED",
    requirementCategory: "DELIVERY",
    requirementObligation: "MANDATORY",
    reviewState: "UNREVIEWED",
    structuredRequirement: {
      id: "structured-requirement-1",
      normalizedStatement: "Complete the work within 90 days.",
      title: "Delivery timeline",
    },
    tenderCitation: {
      boundedExcerpt: "Complete the work within 90 days.",
      documentName: "mock-tender.pdf",
      pageNumber: 1,
      tenderDocumentId: "tender-document-1",
    },
    uncertainty: "Needs a reviewer decision.",
  };
}

async function preparePage(page: Page, intervalMs: number): Promise<void> {
  await accelerateIntervals(page, intervalMs);
  if (authenticatedCookies !== null) {
    await page.context().addCookies(authenticatedCookies);
    await page.goto("/dashboard");
    await page.waitForURL("**/dashboard", { timeout: REQUEST_TIMEOUT_MS });
    return;
  }
  await loginAs(page, fixture.user.email);
  authenticatedCookies = await page.context().cookies();
}

async function accelerateIntervals(
  page: Page,
  intervalMs: number,
): Promise<void> {
  await page.addInitScript((interval: number) => {
    const originalSetInterval = window.setInterval.bind(window);
    window.setInterval = ((handler: TimerHandler, timeout?: number, ...args) =>
      originalSetInterval(
        handler,
        typeof timeout === "number" && timeout >= 5_000
          ? interval
          : (timeout ?? 0),
        ...args,
      )) as typeof window.setInterval;
  }, intervalMs);
}

function captureBrowserQuality(page: Page): {
  readonly errors: string[];
  readonly failedRequests: string[];
} {
  const errors: string[] = [];
  const failedRequests: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (
      /favicon|next start does not work with output: standalone/iu.test(text) ||
      text ===
        "Failed to load resource: the server responded with a status of 404 (Not Found)"
    )
      return;
    errors.push(text);
  });
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  page.on("requestfailed", (request) => {
    const url = request.url();
    if (/favicon.ico$/u.test(url)) return;
    failedRequests.push(`${request.method()} ${url}`);
  });
  return { errors, failedRequests };
}

async function loginAs(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.locator("#auth-password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard", { timeout: REQUEST_TIMEOUT_MS });
}

async function seedFixture(): Promise<BrowserFixture> {
  const tag = Date.now().toString(36);
  const passwordHash = await hashPassword(PASSWORD);
  const user = await prisma.user.create({
    data: {
      displayName: `Workspace Browser ${tag}`,
      email: `workspace-browser-${tag}@example.test`,
      passwordHash,
    },
  });
  const organisation = await prisma.organisation.create({
    data: {
      createdByUserId: user.id,
      name: `Workspace Browser ${tag}`,
      type: "MSME",
    },
  });
  await prisma.organisationMembership.create({
    data: {
      organisationId: organisation.id,
      role: "OWNER",
      userId: user.id,
    },
  });
  return {
    organisationId: organisation.id,
    user: {
      displayName: user.displayName,
      email: user.email,
    },
  };
}

function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(16);
    scryptCallback(
      password,
      salt,
      32,
      { N: 2 ** 17, maxmem: 256 * 1024 * 1024, p: 1, r: 8 },
      (error, derivedKey) => {
        if (error !== null) {
          reject(error);
          return;
        }
        resolve(
          [
            "scrypt",
            "ln=17,r=8,p=1",
            salt.toString("base64url"),
            derivedKey.toString("base64url"),
          ].join("$"),
        );
      },
    );
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
