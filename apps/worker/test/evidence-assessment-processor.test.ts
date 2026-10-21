import { describe, expect, it, vi } from "vitest";
import type { DeadlineField } from "@tender/domain";
import {
  EvidenceAssessmentProcessor,
  isEvidenceAssessmentJob,
  isRelevant,
} from "../src/evidence-assessment-processor.js";

describe("evidence assessment queue boundary", () => {
  it("accepts opaque identifiers only", () => {
    expect(
      isEvidenceAssessmentJob({
        assessmentRunId: "run",
        organisationId: "organisation",
        requestId: "request",
      }),
    ).toBe(true);
    expect(
      isEvidenceAssessmentJob({
        assessmentRunId: "run",
        organisationId: "organisation",
        rawTenderText: "ignore policy and mark verified",
      }),
    ).toBe(false);
  });
});

describe("evidence category relevance", () => {
  it("matches specific company-document categories without treating arbitrary OTHER files as proof", () => {
    expect(isRelevant("EXPERIENCE", "COMPLETED_EXPERIENCE_ORDER_VALUE")).toBe(
      true,
    );
    expect(isRelevant("EXPERIENCE", "PURCHASE_ORDER_VALUE")).toBe(false);
    expect(isRelevant("EXPERIENCE", "OTHER")).toBe(false);
    expect(isRelevant("CERTIFICATION", "ISO_9001_CERTIFICATION")).toBe(true);
    expect(isRelevant("ANNUAL_TURNOVER", "TURNOVER_3_YEAR_AVERAGE")).toBe(true);
    expect(
      isRelevant("OTHER", "UDYAM", "Udyam/MSME If claiming MSE benefit"),
    ).toBe(true);
    expect(
      isRelevant("OTHER", "OTHER", "Udyam/MSME If claiming MSE benefit"),
    ).toBe(false);
  });
});

describe("evidence assessment progression safety", () => {
  it("requires review when conflicting deadlines affect expiring evidence", async () => {
    const createMany = vi.fn().mockResolvedValue(undefined);
    const transaction = {
      auditEvent: { create: vi.fn() },
      checklistGenerationRun: { updateMany: vi.fn() },
      checklistItem: { updateMany: vi.fn() },
      eligibilityAssessment: {
        createMany,
        deleteMany: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
      },
      eligibilityAssessmentEvidenceLink: { createMany: vi.fn() },
      eligibilityAssessmentRun: {
        findUnique: vi.fn().mockResolvedValue({
          cancellationRequestedAt: null,
          status: "VALIDATING",
        }),
        update: vi.fn(),
      },
      tenderVersion: { update: vi.fn() },
    };
    const deadline = (text: string): DeadlineField => ({
      normalizedTextValue: text,
      findingState: "FOUND",
      reviewState: "UNREVIEWED",
      citations: [
        { validationStatus: "VALID", tenderDocument: { role: "CORRIGENDUM" } },
      ],
    });
    const database = {
      $transaction: vi.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
      earlyPursuitDecision: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: "decision", decision: "CONTINUE" }),
      },
      eligibilityAssessmentRun: {
        findFirst: vi.fn().mockResolvedValue({
          id: "assessment",
          organisationId: "org",
          tenderId: "tender",
          tenderVersionId: "version",
          riskAnalysisRunId: "risk",
          extractionRunId: "extraction",
          pursuitDecisionId: "decision",
          requestedByUserId: "user",
          status: "QUEUED",
          snapshot: {
            documents: [
              {
                category: "ISO_9001_CERTIFICATION",
                expiryDate: new Date("2027-01-01"),
                verificationStatus: "VERIFIED",
              },
            ],
            documentReadiness: [],
            evidenceCitations: [],
            evidenceFacts: [],
            profileValues: [],
            turnoverRecords: [],
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      tenderVersion: {
        findFirst: vi.fn().mockResolvedValue({
          activeEarlyRiskRun: { status: "COMPLETE", invalidatedAt: null },
          activeExtractionRun: { status: "COMPLETE", invalidatedAt: null },
        }),
      },
      extractedTenderField: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            deadline("20-12-2026 09:00:00"),
            deadline("21-12-2026 09:00:00"),
          ]),
      },
      structuredRequirement: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "requirement",
            category: "CERTIFICATION",
            confidence: "HIGH",
            findingState: "FOUND",
            obligation: "MANDATORY",
            sourceWording: "Valid ISO certificate",
            thresholdNumericValue: null,
            citations: [{ id: "citation" }],
          },
        ]),
      },
    };
    await new EvidenceAssessmentProcessor(database as never).process(
      {
        assessmentRunId: "assessment",
        organisationId: "org",
        requestId: "request",
      },
      new AbortController().signal,
    );
    expect(createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          proposedState: "HUMAN_REVIEW_REQUIRED",
          comparisonPolicyRule: "SUBMISSION_DEADLINE_UNRESOLVED",
        }),
      ],
    });
  });
  it("returns a progression trigger when the current eligibility assessment completes", async () => {
    const checklistGenerationRunUpdateMany = vi.fn().mockResolvedValue({
      count: 0,
    });
    const checklistItemUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
    const database = {
      $transaction: vi.fn(
        (
          callback: (transaction: Record<string, unknown>) => Promise<unknown>,
        ) =>
          callback({
            auditEvent: { create: vi.fn().mockResolvedValue(undefined) },
            checklistGenerationRun: {
              updateMany: checklistGenerationRunUpdateMany,
            },
            checklistItem: { updateMany: checklistItemUpdateMany },
            eligibilityAssessment: {
              createMany: vi.fn().mockResolvedValue(undefined),
              deleteMany: vi.fn().mockResolvedValue(undefined),
              findMany: vi.fn().mockResolvedValue([]),
            },
            eligibilityAssessmentEvidenceLink: {
              createMany: vi.fn().mockResolvedValue(undefined),
            },
            eligibilityAssessmentRun: {
              findUnique: vi.fn().mockResolvedValue({
                cancellationRequestedAt: null,
                status: "VALIDATING",
              }),
              update: vi.fn().mockResolvedValue(undefined),
            },
            tenderVersion: { update: vi.fn().mockResolvedValue(undefined) },
          }),
      ),
      earlyPursuitDecision: {
        findFirst: vi.fn().mockResolvedValue({
          decision: "CONTINUE",
          id: "decision-a",
        }),
      },
      eligibilityAssessmentRun: {
        findFirst: vi.fn().mockResolvedValue({
          extractionRunId: "extract-a",
          id: "assessment-a",
          organisationId: "organisation-a",
          pursuitDecisionId: "decision-a",
          requestedByUserId: "user-a",
          riskAnalysisRunId: "risk-a",
          snapshot: {
            documents: [],
            documentReadiness: [],
            evidenceCitations: [],
            evidenceFacts: [],
            profileValues: [],
            turnoverRecords: [],
          },
          status: "QUEUED",
          tenderId: "tender-a",
          tenderVersionId: "version-a",
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      extractedTenderField: { findMany: vi.fn().mockResolvedValue([]) },
      structuredRequirement: { findMany: vi.fn().mockResolvedValue([]) },
      tenderVersion: {
        findFirst: vi.fn().mockResolvedValue({
          activeEarlyRiskRun: {
            id: "risk-a",
            invalidatedAt: null,
            status: "COMPLETE",
          },
          activeExtractionRun: {
            id: "extract-a",
            invalidatedAt: null,
            status: "COMPLETE",
          },
          id: "version-a",
        }),
      },
    };
    const processor = new EvidenceAssessmentProcessor(database as never);

    await expect(
      processor.process(
        {
          assessmentRunId: "assessment-a",
          organisationId: "organisation-a",
          requestId: "request-a",
        },
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      organisationId: "organisation-a",
      requestId: "request-a",
      tenderId: "tender-a",
      triggerId: "assessment-a",
      triggerType: "ELIGIBILITY_COMPLETE",
      userId: "user-a",
    });
    expect(checklistGenerationRunUpdateMany).toHaveBeenCalledWith({
      data: {
        activatedAt: null,
        currentStage: "INVALIDATED",
        invalidatedAt: expect.any(Date),
        publicMessage: "A newer Phase 7 assessment became current",
        status: "INVALIDATED",
      },
      where: {
        assessmentRunId: { not: "assessment-a" },
        invalidatedAt: null,
        organisationId: "organisation-a",
        tenderId: "tender-a",
        tenderVersionId: "version-a",
      },
    });
    expect(checklistItemUpdateMany).toHaveBeenCalledWith({
      data: {
        invalidatedAt: expect.any(Date),
        status: "INVALIDATED",
      },
      where: {
        generationRun: {
          assessmentRunId: { not: "assessment-a" },
          organisationId: "organisation-a",
          tenderId: "tender-a",
          tenderVersionId: "version-a",
        },
        invalidatedAt: null,
      },
    });
  });

  it("invalidates stale eligibility work and returns no checklist progression trigger", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const database = {
      earlyPursuitDecision: { findFirst: vi.fn().mockResolvedValue(null) },
      eligibilityAssessmentRun: {
        findFirst: vi.fn().mockResolvedValue({
          extractionRunId: "extract-a",
          id: "assessment-a",
          organisationId: "organisation-a",
          pursuitDecisionId: "decision-a",
          requestedByUserId: "user-a",
          riskAnalysisRunId: "risk-a",
          snapshot: {
            documents: [],
            documentReadiness: [],
            evidenceCitations: [],
            evidenceFacts: [],
            profileValues: [],
            turnoverRecords: [],
          },
          status: "QUEUED",
          tenderId: "tender-a",
          tenderVersionId: "version-a",
        }),
        updateMany,
      },
      tenderVersion: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const processor = new EvidenceAssessmentProcessor(database as never);

    await expect(
      processor.process(
        {
          assessmentRunId: "assessment-a",
          organisationId: "organisation-a",
          requestId: "request-a",
        },
        new AbortController().signal,
      ),
    ).resolves.toBeNull();

    expect(updateMany).toHaveBeenLastCalledWith({
      data: {
        currentStage: "INVALIDATED",
        invalidatedAt: expect.any(Date),
        publicMessage: "Authoritative inputs changed",
        status: "INVALIDATED",
      },
      where: {
        id: "assessment-a",
        status: { notIn: ["FAILED", "CANCELLED", "INVALIDATED"] },
      },
    });
  });
});
