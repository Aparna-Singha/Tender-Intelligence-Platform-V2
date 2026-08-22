import { describe, expect, it } from "vitest";
import { describeTender, type TenderSummary } from "./tender-presentation";

function createTender(
  overrides: Partial<TenderSummary> = {},
): TenderSummary {
  return {
    buyer: "Buyer department",
    id: "tender-1",
    isDemonstration: false,
    lifecycleStatus: "SOURCE_READY",
    sourceTenderNumber: "T-001",
    submissionDeadline: "2026-08-29T11:30:00.000Z",
    title: "School Furniture - Ajmer",
    workspace: {
      processingProgress: 100,
      status: "READY",
    },
    ...overrides,
  };
}

describe("describeTender status truth", () => {
  it("does not map SOURCE_READY to likely eligible in the fallback path", () => {
    const presentation = describeTender(
      createTender({
        lifecycleStatus: "SOURCE_READY",
        workspace: {
          processingProgress: 100,
          status: "SOURCE_READY",
        },
      }),
    );

    expect(presentation.statusLabel).toBe("Source ready");
    expect(presentation.statusLabel).not.toBe("Likely eligible");
  });

  it("does not map generic READY to likely eligible in the fallback path", () => {
    const presentation = describeTender(
      createTender({
        lifecycleStatus: "READY",
        workspace: {
          processingProgress: 100,
          status: "READY",
        },
      }),
    );

    expect(presentation.statusLabel).toBe("Ready");
    expect(presentation.statusLabel).not.toBe("Likely eligible");
    expect(presentation.isCompleted).toBe(false);
  });

  it("does not treat generic COMPLETE or APPROVED fallback states as tender completion", () => {
    const complete = describeTender(
      createTender({
        lifecycleStatus: "COMPLETE",
        workspace: {
          processingProgress: 100,
          status: "COMPLETE",
        },
      }),
    );
    const approved = describeTender(
      createTender({
        lifecycleStatus: "APPROVED",
        workspace: {
          processingProgress: 100,
          status: "APPROVED",
        },
      }),
    );

    expect(complete.statusLabel).toBe("Complete");
    expect(approved.statusLabel).toBe("Approved");
    expect(complete.isCompleted).toBe(false);
    expect(approved.isCompleted).toBe(false);
  });

  it("prefers authoritative workflowState over fallback presentation", () => {
    const presentation = describeTender(
      createTender({
        lifecycleStatus: "READY",
        workflowState: {
          actionLabel: "Review",
          code: "AWAITING_EARLY_DECISION",
          detail: "Tender analysis is ready for human review.",
          isCompleted: false,
          isDraft: false,
          isInProgress: false,
          needsAttention: true,
          onHold: false,
          statusLabel: "Review tender",
          tone: "warning",
        },
      }),
    );

    expect(presentation.statusLabel).toBe("Review tender");
    expect(presentation.isCompleted).toBe(false);
    expect(presentation.supportingLabel).toBe(
      "Tender analysis is ready for human review.",
    );
  });

  it("keeps failure and review fallback states fail-closed", () => {
    const failed = describeTender(
      createTender({
        lifecycleStatus: "FAILED",
        workspace: {
          processingProgress: 100,
          status: "FAILED",
        },
      }),
    );
    const review = describeTender(
      createTender({
        lifecycleStatus: "HUMAN_REVIEW_REQUIRED",
        workspace: {
          processingProgress: 100,
          status: "HUMAN_REVIEW_REQUIRED",
        },
      }),
    );

    expect(failed.statusLabel).toBe("Needs attention");
    expect(review.statusLabel).toBe("Needs review");
    expect(failed.statusLabel).not.toBe("Likely eligible");
    expect(review.statusLabel).not.toBe("Likely eligible");
  });
});
