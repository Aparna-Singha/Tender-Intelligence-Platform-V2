import { describe, expect, it } from "vitest";
import {
  needsSourceReview,
  requirementPresentation,
  type EligibilityViewRequirement,
} from "./eligibility-presentation";

function requirement(
  overrides: Partial<EligibilityViewRequirement> = {},
): EligibilityViewRequirement {
  return {
    assessmentId: "assessment-1",
    categoryLabel: "Experience",
    evidenceLinks: [],
    id: "requirement-1",
    reviewStateLabel: "Missing",
    sourceCitation: {
      boundedExcerpt: "The bidder must provide evidence of similar work.",
      documentName: "Tender.pdf",
      pageNumber: 4,
      tenderDocumentId: "document-1",
    },
    stateKey: "MISSING",
    statement: "The bidder must provide evidence of similar work.",
    statusLabel: "Missing",
    statusTone: "warning",
    structuredRequirementId: "structured-1",
    title: "Past experience",
    whatToDo: "Upload supporting evidence.",
    why: "No accepted evidence was found.",
    ...overrides,
  };
}

describe("eligibility presentation", () => {
  it("routes unreadable source text to source review instead of a missing-evidence claim", () => {
    const result = requirementPresentation(
      requirement({
        extractionConfidence: "LOW",
        statement: "\uFFFD\uFFFD\uFFFD",
      }),
    );

    expect(result.statusLabel).toBe("Source review needed");
    expect(result.actionLabel).toBe("Review source");
    expect(result.evidenceEmptyLabel).not.toContain("No supporting evidence");
  });

  it("keeps valid non-Latin source text readable", () => {
    expect(
      needsSourceReview("निविदाकर्ता को अनुभव प्रमाण प्रस्तुत करना होगा।"),
    ).toBe(false);
  });

  it("uses contextual evidence language for an assessed missing requirement", () => {
    const result = requirementPresentation(requirement());

    expect(result.statusLabel).toBe("Need evidence");
    expect(result.actionLabel).toBe("Add evidence");
  });

  it("does not present a machine LIKELY_MET proposal as satisfied", () => {
    const result = requirementPresentation(
      requirement({
        evidenceLinks: [
          {
            excerpt: "Accepted cited fact.",
            label: "Evidence.pdf",
            supportingText: "Direct support",
          },
        ],
        stateKey: "LIKELY_MET",
        statusLabel: "Likely met",
      }),
    );

    expect(result.statusLabel).toBe("Likely met — review required");
    expect(result.actionLabel).toBe("Review evidence");
    expect(result.filterKey).toBe("NEED_REVIEW");
  });
});
