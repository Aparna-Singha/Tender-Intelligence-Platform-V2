import { describe, expect, it } from "vitest";
import { deriveTenderWorkflowState } from "../src/tenders/tender-user-facing.js";
import { TendersService } from "../src/tenders/tenders.service.js";

const readyPrimaryDocument = {
  role: "PRIMARY",
  status: "READY",
  uploadSessionExpiresAt: new Date("2026-08-22T23:59:59.000Z"),
} as const;

describe("tender workflow truthfulness", () => {
  it("projects the latest failed current-version attempt while retaining the completed active pointer", async () => {
    const database = {
      extractedTenderField: { findMany: () => Promise.resolve([]) },
      draft: { findMany: () => Promise.resolve([]) },
      draftGenerationRun: { findMany: () => Promise.resolve([]) },
    };
    const service = new TendersService(
      database as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const completed = {
      id: "completed-run",
      invalidatedAt: null,
      publicMessage: "Complete",
      safeFailureMessage: null,
      status: "COMPLETE",
    };
    const failed = {
      id: "failed-run",
      invalidatedAt: null,
      publicMessage: "Extraction failed safely",
      safeFailureMessage: "Extraction failed safely",
      status: "FAILED",
    };
    const tender = {
      buyer: "Synthetic buyer",
      currentVersion: {
        activeEarlyRiskRun: null,
        activeEligibilityAssessmentRun: null,
        activeExtractionRun: completed,
        extractionRuns: [failed],
        documents: [readyPrimaryDocument],
        id: "version-a",
      },
      id: "tender-a",
      isDemonstration: false,
      lifecycleStatus: "SOURCE_READY",
      sourceTenderNumber: null,
      submissionDeadline: null,
      title: "Synthetic tender",
      workspace: null,
    };
    const [result] = await (
      service as unknown as {
        decorateTenders: (
          tenders: readonly (typeof tender)[],
        ) => Promise<readonly { workflowState: { statusLabel: string } }[]>;
      }
    ).decorateTenders([tender]);
    expect(result?.workflowState.statusLabel).toBe("Extraction failed");
    expect(tender.currentVersion.activeExtractionRun.id).toBe("completed-run");
  });
  it.each([
    ["QUEUED", "Extraction queued"],
    ["PARSING", "Extracting documents"],
    ["STRUCTURING", "Structuring requirements"],
    ["FAILED", "Extraction failed"],
    ["CANCELLED", "Extraction cancelled"],
  ])(
    "shows the current-version %s extraction attempt",
    (status, statusLabel) => {
      const state = deriveTenderWorkflowState({
        assessment: null,
        currentDecision: null,
        currentDraftExists: false,
        currentDraftRunStatus: null,
        documents: [readyPrimaryDocument],
        extraction: {
          invalidatedAt: null,
          publicMessage: "Safe progress",
          safeFailureMessage: null,
          status,
        },
        processingJobs: [],
        risk: null,
      });
      expect(state.statusLabel).toBe(statusLabel);
    },
  );

  it("does not label a missing extraction run as actively reading", () => {
    const state = deriveTenderWorkflowState({
      assessment: null,
      currentDecision: null,
      currentDraftExists: false,
      currentDraftRunStatus: null,
      documents: [readyPrimaryDocument],
      extraction: null,
      processingJobs: [],
      risk: null,
    });

    expect(state).toMatchObject({
      code: "FAILED_RECOVERABLE",
      isInProgress: false,
      needsAttention: true,
      statusLabel: "Extraction not started",
    });
  });

  it("does not label a missing risk run as actively analysing", () => {
    const state = deriveTenderWorkflowState({
      assessment: null,
      currentDecision: null,
      currentDraftExists: false,
      currentDraftRunStatus: null,
      documents: [readyPrimaryDocument],
      extraction: {
        invalidatedAt: null,
        publicMessage: "Extraction complete",
        safeFailureMessage: null,
        status: "COMPLETE",
      },
      processingJobs: [],
      risk: null,
    });

    expect(state).toMatchObject({
      code: "FAILED_RECOVERABLE",
      isInProgress: false,
      needsAttention: true,
      statusLabel: "Risk analysis not started",
    });
  });

  it("does not label a missing eligibility run as actively checking", () => {
    const state = deriveTenderWorkflowState({
      assessment: null,
      currentDecision: { decision: "CONTINUE" },
      currentDraftExists: false,
      currentDraftRunStatus: null,
      documents: [readyPrimaryDocument],
      extraction: {
        invalidatedAt: null,
        publicMessage: "Extraction complete",
        safeFailureMessage: null,
        status: "COMPLETE",
      },
      processingJobs: [],
      risk: {
        invalidatedAt: null,
        publicMessage: "Risk complete",
        safeFailureMessage: null,
        status: "COMPLETE",
      },
    });

    expect(state).toMatchObject({
      code: "FAILED_RECOVERABLE",
      isInProgress: false,
      needsAttention: true,
      statusLabel: "Eligibility not started",
    });
  });
});
