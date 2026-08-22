import { describe, expect, it } from "vitest";
import { deriveTenderWorkflowState } from "../src/tenders/tender-user-facing.js";

const readyPrimaryDocument = {
  role: "PRIMARY",
  status: "READY",
  uploadSessionExpiresAt: new Date("2026-08-22T23:59:59.000Z"),
} as const;

describe("tender workflow truthfulness", () => {
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
