import { describe, expect, it, vi } from "vitest";
import { TenderAnalysisOrchestratorService } from "../src/tenders/tender-analysis-orchestrator.service.js";

describe("tender analysis orchestrator", () => {
  it("starts extraction, early risk analysis, and tender-only rag indexing when the current primary source set is ready", async () => {
    const database = {
      earlyPursuitDecision: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      tenderVersion: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            activeEarlyRiskRun: null,
            activeEligibilityAssessmentRun: null,
            activeExtractionRun: null,
            documents: [
              {
                approvedObjectKey: "approved/object-key",
                role: "PRIMARY",
                status: "READY",
              },
            ],
            id: "version-a",
          })
          .mockResolvedValueOnce({
            activeEarlyRiskRun: null,
            activeEligibilityAssessmentRun: null,
            activeExtractionRun: {
              id: "extract-a",
              invalidatedAt: null,
              status: "COMPLETE",
            },
            documents: [
              {
                approvedObjectKey: "approved/object-key",
                role: "PRIMARY",
                status: "READY",
              },
            ],
            id: "version-a",
          })
          .mockResolvedValueOnce({
            activeEarlyRiskRun: {
              id: "risk-a",
              invalidatedAt: null,
              status: "COMPLETE",
            },
            activeEligibilityAssessmentRun: null,
            activeExtractionRun: {
              id: "extract-a",
              invalidatedAt: null,
              status: "COMPLETE",
            },
            documents: [
              {
                approvedObjectKey: "approved/object-key",
                role: "PRIMARY",
                status: "READY",
              },
            ],
            id: "version-a",
          })
          .mockResolvedValueOnce({
            activeEarlyRiskRun: {
              id: "risk-a",
              invalidatedAt: null,
              status: "COMPLETE",
            },
            activeEligibilityAssessmentRun: {
              id: "assessment-a",
              invalidatedAt: null,
              snapshot: { capturedAt: new Date("2026-08-22T10:00:00.000Z") },
              status: "COMPLETE",
            },
            activeExtractionRun: {
              id: "extract-a",
              invalidatedAt: null,
              status: "COMPLETE",
            },
            documents: [
              {
                approvedObjectKey: "approved/object-key",
                role: "PRIMARY",
                status: "READY",
              },
            ],
            id: "version-a",
          })
          .mockResolvedValueOnce({
            activeEarlyRiskRun: {
              id: "risk-a",
              invalidatedAt: null,
              status: "COMPLETE",
            },
            activeEligibilityAssessmentRun: {
              id: "assessment-a",
              invalidatedAt: null,
              snapshot: { capturedAt: new Date("2026-08-22T10:00:00.000Z") },
              status: "COMPLETE",
            },
            activeExtractionRun: {
              id: "extract-a",
              invalidatedAt: null,
              status: "COMPLETE",
            },
            documents: [
              {
                approvedObjectKey: "approved/object-key",
                role: "PRIMARY",
                status: "READY",
              },
            ],
            id: "version-a",
          })
          .mockResolvedValue({
            activeEarlyRiskRun: {
              id: "risk-a",
              invalidatedAt: null,
              status: "COMPLETE",
            },
            activeEligibilityAssessmentRun: {
              id: "assessment-a",
              invalidatedAt: null,
              snapshot: { capturedAt: new Date("2026-08-22T10:00:00.000Z") },
              status: "COMPLETE",
            },
            activeExtractionRun: {
              id: "extract-a",
              invalidatedAt: null,
              status: "COMPLETE",
            },
            documents: [
              {
                approvedObjectKey: "approved/object-key",
                role: "PRIMARY",
                status: "READY",
              },
            ],
            id: "version-a",
          }),
      },
    };
    const extractions = { start: vi.fn().mockResolvedValue(undefined) };
    const risks = { start: vi.fn().mockResolvedValue(undefined) };
    const eligibility = { start: vi.fn().mockResolvedValue(undefined) };
    const checklists = { start: vi.fn().mockResolvedValue(undefined) };
    const rag = { startIndex: vi.fn().mockResolvedValue(undefined) };

    const service = new TenderAnalysisOrchestratorService(
      database as never,
      extractions as never,
      risks as never,
      eligibility as never,
      checklists as never,
      rag as never,
    );

    await service.ensureCurrentPipeline(
      "organisation-a",
      "tender-a",
      "user-a",
      "request-a",
    );

    expect(extractions.start).toHaveBeenCalledWith(
      "organisation-a",
      "tender-a",
      "version-a",
      "user-a",
      "system-auto-extraction",
      "request-a",
    );
    expect(risks.start).toHaveBeenCalledWith(
      "organisation-a",
      "tender-a",
      "version-a",
      "user-a",
      "system-auto-risk",
      "request-a",
    );
    expect(rag.startIndex).toHaveBeenCalledWith(
      "organisation-a",
      "tender-a",
      "version-a",
      "TENDER_ONLY",
      "system-auto-rag-tender-only",
      "user-a",
      "request-a",
    );
    expect(eligibility.start).not.toHaveBeenCalled();
    expect(checklists.start).not.toHaveBeenCalled();
  });

  it("starts eligibility only after a current CONTINUE decision exists", async () => {
    const database = {
      earlyPursuitDecision: {
        findFirst: vi.fn().mockResolvedValue({
          decision: "CONTINUE",
          id: "decision-a",
        }),
      },
      tenderVersion: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            activeEarlyRiskRun: {
              id: "risk-a",
              invalidatedAt: null,
              status: "COMPLETE",
            },
            activeEligibilityAssessmentRun: null,
            activeExtractionRun: {
              id: "extract-a",
              invalidatedAt: null,
              status: "COMPLETE",
            },
            documents: [
              {
                approvedObjectKey: "approved/object-key",
                role: "PRIMARY",
                status: "READY",
              },
            ],
            id: "version-a",
          })
          .mockResolvedValueOnce({
            activeEarlyRiskRun: {
              id: "risk-a",
              invalidatedAt: null,
              status: "COMPLETE",
            },
            activeEligibilityAssessmentRun: null,
            activeExtractionRun: {
              id: "extract-a",
              invalidatedAt: null,
              status: "COMPLETE",
            },
            documents: [
              {
                approvedObjectKey: "approved/object-key",
                role: "PRIMARY",
                status: "READY",
              },
            ],
            id: "version-a",
          })
          .mockResolvedValue({
            activeEarlyRiskRun: {
              id: "risk-a",
              invalidatedAt: null,
              status: "COMPLETE",
            },
            activeEligibilityAssessmentRun: null,
            activeExtractionRun: {
              id: "extract-a",
              invalidatedAt: null,
              status: "COMPLETE",
            },
            documents: [
              {
                approvedObjectKey: "approved/object-key",
                role: "PRIMARY",
                status: "READY",
              },
            ],
            id: "version-a",
          }),
      },
    };
    const extractions = { start: vi.fn().mockResolvedValue(undefined) };
    const risks = { start: vi.fn().mockResolvedValue(undefined) };
    const eligibility = { start: vi.fn().mockResolvedValue(undefined) };
    const checklists = { start: vi.fn().mockResolvedValue(undefined) };
    const rag = { startIndex: vi.fn().mockResolvedValue(undefined) };

    const service = new TenderAnalysisOrchestratorService(
      database as never,
      extractions as never,
      risks as never,
      eligibility as never,
      checklists as never,
      rag as never,
    );

    await service.ensureCurrentPipeline(
      "organisation-a",
      "tender-a",
      "user-a",
      "request-a",
    );

    expect(eligibility.start).toHaveBeenCalledWith(
      "organisation-a",
      "tender-a",
      "version-a",
      "user-a",
      "system-auto-eligibility",
      "request-a",
    );
    expect(checklists.start).not.toHaveBeenCalled();
  });

  it("starts checklist when a later pass sees a current completed eligibility assessment", async () => {
    const database = {
      earlyPursuitDecision: {
        findFirst: vi.fn().mockResolvedValue({
          decision: "CONTINUE",
          id: "decision-a",
        }),
      },
      tenderVersion: {
        findFirst: vi.fn().mockResolvedValue({
          activeEarlyRiskRun: {
            id: "risk-a",
            invalidatedAt: null,
            status: "COMPLETE",
          },
          activeEligibilityAssessmentRun: {
            id: "assessment-a",
            invalidatedAt: null,
            snapshot: { capturedAt: new Date("2026-08-22T10:00:00.000Z") },
            status: "COMPLETE",
          },
          activeExtractionRun: {
            id: "extract-a",
            invalidatedAt: null,
            status: "COMPLETE",
          },
          documents: [
            {
              approvedObjectKey: "approved/object-key",
              role: "PRIMARY",
              status: "READY",
            },
          ],
          id: "version-a",
        }),
      },
    };
    const extractions = { start: vi.fn().mockResolvedValue(undefined) };
    const risks = { start: vi.fn().mockResolvedValue(undefined) };
    const eligibility = { start: vi.fn().mockResolvedValue(undefined) };
    const checklists = { start: vi.fn().mockResolvedValue(undefined) };
    const rag = { startIndex: vi.fn().mockResolvedValue(undefined) };

    const service = new TenderAnalysisOrchestratorService(
      database as never,
      extractions as never,
      risks as never,
      eligibility as never,
      checklists as never,
      rag as never,
    );

    await service.ensureCurrentPipeline(
      "organisation-a",
      "tender-a",
      "user-a",
      "request-a",
    );

    expect(checklists.start).toHaveBeenCalledWith(
      "organisation-a",
      "tender-a",
      "version-a",
      "user-a",
      "system-auto-checklist",
      "request-a",
    );
  });
});
