import { describe, expect, it } from "vitest";
import {
  canTransitionChecklistItem,
  hasPermission,
  proposeChecklistItem,
  type ChecklistAssessmentInput,
} from "../src/index.js";

const base: ChecklistAssessmentInput = {
  assessmentId: "a",
  currentState: "MISSING",
  proposedState: "MISSING",
  policyRule: "UNSUPPORTED_REQUIREMENT",
  requirementCategory: "GST",
  requirementId: "r",
  obligation: "MANDATORY",
  sourceCoverageComplete: true,
  tenderCitationId: "c",
  hasDirectEvidence: false,
  hasDocumentMetadata: false,
  hasUnverifiedEvidence: false,
  hasExpiredEvidence: false,
};

describe("Phase 8 checklist policy", () => {
  it("distinguishes missing structured evidence from a missing document", () => {
    expect(proposeChecklistItem(base)).toMatchObject({
      itemType: "CAPTURE_EVIDENCE_FACT",
      priority: "BLOCKING",
    });
  });

  it("uses review rather than a false missing claim when coverage is incomplete", () => {
    expect(
      proposeChecklistItem({ ...base, sourceCoverageComplete: false }),
    ).toMatchObject({ itemType: "REVIEW_DOCUMENT_CONTENT" });
  });

  it("creates controlled conflict and expiry actions", () => {
    expect(
      proposeChecklistItem({ ...base, currentState: "CONFLICT" }),
    ).toMatchObject({ itemType: "RESOLVE_EVIDENCE_CONFLICT" });
    expect(
      proposeChecklistItem({ ...base, hasExpiredEvidence: true }),
    ).toMatchObject({ itemType: "RENEW_DOCUMENT" });
  });

  it("does not create missing work for verified or not-applicable assessments", () => {
    expect(
      proposeChecklistItem({ ...base, currentState: "VERIFIED" }),
    ).toBeUndefined();
    expect(
      proposeChecklistItem({ ...base, currentState: "NOT_APPLICABLE" }),
    ).toBeUndefined();
  });

  it("requires rationale and Phase 7 resolution provenance", () => {
    expect(
      canTransitionChecklistItem("OPEN", "BLOCKED", { blockedReason: "short" }),
    ).toBe(false);
    expect(
      canTransitionChecklistItem("READY_FOR_REASSESSMENT", "RESOLVED", {
        resolutionProvenance: false,
      }),
    ).toBe(false);
    expect(
      canTransitionChecklistItem("READY_FOR_REASSESSMENT", "RESOLVED", {
        resolutionProvenance: true,
      }),
    ).toBe(true);
  });

  it("keeps different financial years and manufacturers separate", () => {
    const one = proposeChecklistItem({
      ...base,
      financialYear: "2024-25",
      manufacturer: "OEM A",
      requirementCategory: "TURNOVER",
    });
    const two = proposeChecklistItem({
      ...base,
      financialYear: "2023-24",
      manufacturer: "OEM B",
      requirementCategory: "TURNOVER",
    });
    expect(one?.deduplicationKey).not.toBe(two?.deduplicationKey);
  });

  it("separates routine edits from high-stakes resolution permissions", () => {
    expect(hasPermission("TENDER_EXECUTIVE", "CHECKLIST_ITEM_EDIT")).toBe(true);
    expect(hasPermission("TENDER_EXECUTIVE", "CHECKLIST_ITEM_RESOLVE")).toBe(
      false,
    );
    expect(hasPermission("REVIEWER", "CHECKLIST_ITEM_RESOLVE")).toBe(true);
  });
});
