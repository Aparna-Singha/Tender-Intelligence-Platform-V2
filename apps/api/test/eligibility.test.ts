import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { EligibilityService } from "../src/eligibility/eligibility.service.js";

describe("Phase 6 gate and tenant boundary", () => {
  it("does not reveal another organisation's assessment run", async () => {
    const database = {
      eligibilityAssessmentRun: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const service = new EligibilityService(database as never, {} as never);
    await expect(
      service.getRun("organisation-b", "tender-a", "run-a"),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(database.eligibilityAssessmentRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "run-a",
          organisationId: "organisation-b",
          tenderId: "tender-a",
        },
      }),
    );
  });

  it("blocks start without the exact current Phase 5 extraction and Phase 6 risk run", async () => {
    const database = {
      tenderVersion: {
        findFirst: vi.fn().mockResolvedValue({
          activeEarlyRiskRun: null,
          activeExtractionRun: null,
        }),
      },
    };
    const jobs = { add: vi.fn() };
    const service = new EligibilityService(database as never, jobs as never);
    await expect(
      service.start(
        "organisation-a",
        "tender-a",
        "version-a",
        "user-a",
        "idempotency-a",
        "request-a",
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(jobs.add).not.toHaveBeenCalled();
  });

  it.each(["HOLD", "STOP", undefined])(
    "blocks start for a %s pursuit decision",
    async (decision) => {
      const database = {
        earlyPursuitDecision: {
          findFirst: vi
            .fn()
            .mockResolvedValue(decision === undefined ? null : { decision }),
        },
        tenderVersion: {
          findFirst: vi.fn().mockResolvedValue({
            activeEarlyRiskRun: {
              extractionRunId: "extraction-a",
              id: "risk-a",
              invalidatedAt: null,
              status: "COMPLETE",
            },
            activeExtractionRun: {
              id: "extraction-a",
              invalidatedAt: null,
              status: "COMPLETE",
            },
          }),
        },
      };
      const jobs = { add: vi.fn() };
      const service = new EligibilityService(database as never, jobs as never);
      await expect(
        service.start(
          "organisation-a",
          "tender-a",
          "version-a",
          "user-a",
          "idempotency-a",
          "request-a",
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(jobs.add).not.toHaveBeenCalled();
      expect(database.earlyPursuitDecision.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organisationId: "organisation-a",
            riskAnalysisRunId: "risk-a",
            supersededAt: null,
            tenderVersionId: "version-a",
          }),
        }),
      );
    },
  );

  it("reuses an existing current run when the authoritative fingerprint matches across different client keys", async () => {
    const existingRun = {
      id: "assessment-run-existing",
      idempotencyKey:
        "organisation-a:system-auto-eligibility:fingerprint-existing",
      sourceFingerprint:
        "2f91d6d2bd9d0d93a0b7d8d44d18f4e510fdfdb4e4b2d55e4f8a7d7966f8f9f1",
      status: "COMPLETE",
    };
    const database = {
      checklistGenerationRun: { updateMany: vi.fn() },
      checklistItem: { updateMany: vi.fn() },
      companyEvidenceFact: { findMany: vi.fn().mockResolvedValue([]) },
      companyProfileValue: { findMany: vi.fn().mockResolvedValue([]) },
      document: { findMany: vi.fn().mockResolvedValue([]) },
      documentReadiness: { findMany: vi.fn().mockResolvedValue([]) },
      earlyPursuitDecision: {
        findFirst: vi.fn().mockResolvedValue({
          decision: "CONTINUE",
          id: "decision-a",
        }),
      },
      eligibilityAssessment: { updateMany: vi.fn() },
      eligibilityAssessmentRun: {
        findFirst: vi.fn().mockResolvedValue(existingRun),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      tenderVersion: {
        findFirst: vi.fn().mockResolvedValue({
          activeEarlyRiskRun: {
            extractionRunId: "extraction-a",
            id: "risk-a",
            invalidatedAt: null,
            status: "COMPLETE",
          },
          activeExtractionRun: {
            id: "extraction-a",
            invalidatedAt: null,
            status: "COMPLETE",
          },
        }),
      },
      companyTurnover: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn(),
    };
    const jobs = { add: vi.fn() };
    const service = new EligibilityService(database as never, jobs as never);

    await expect(
      service.start(
        "organisation-a",
        "tender-a",
        "version-a",
        "user-a",
        "release-evidence-synthetic",
        "request-a",
      ),
    ).resolves.toBe(existingRun);

    expect(database.eligibilityAssessmentRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          invalidatedAt: null,
          organisationId: "organisation-a",
          status: {
            in: [
              "QUEUED",
              "SNAPSHOTTING",
              "MATCHING",
              "VALIDATING",
              "COMPLETE",
            ],
          },
          tenderId: "tender-a",
          tenderVersionId: "version-a",
        }),
      }),
    );
    expect(jobs.add).not.toHaveBeenCalled();
    expect(database.$transaction).not.toHaveBeenCalled();
  });
});

describe("company evidence source boundary", () => {
  it("refuses a rejected, quarantined, deleted or cross-tenant document", async () => {
    const database = {
      document: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const service = new EligibilityService(database as never, {} as never);
    await expect(
      service.createFact(
        "organisation-a",
        {
          document_id: "4c99417e-e20b-4b9f-a4d7-f948423972dc",
          document_version_id: "60ed3b2a-e3bb-46ae-b8ab-c11473426b56",
          fact_type: "OEM_AUTHORISATION",
          value: {
            text_value: "Bounded human-captured fact",
            value_type: "TEXT",
          },
        },
        "user-a",
        "request-a",
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(database.document.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
          organisationId: "organisation-a",
          status: "READY",
        }),
      }),
    );
  });

  it("invalidates in-flight eligibility and checklist work when company evidence is accepted", async () => {
    const eligibilityAssessmentRunUpdateMany = vi
      .fn()
      .mockResolvedValue({ count: 1 });
    const eligibilityAssessmentUpdateMany = vi
      .fn()
      .mockResolvedValue({ count: 0 });
    const checklistGenerationRunUpdateMany = vi
      .fn()
      .mockResolvedValue({ count: 0 });
    const checklistItemUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
    interface MockCompanyEvidenceTransaction {
      readonly auditEvent: { readonly create: ReturnType<typeof vi.fn> };
      readonly companyEvidenceCitation: {
        readonly updateMany: ReturnType<typeof vi.fn>;
      };
      readonly companyEvidenceFact: {
        readonly update: ReturnType<typeof vi.fn>;
      };
      readonly companyEvidenceFactVersion: {
        readonly update: ReturnType<typeof vi.fn>;
      };
      readonly companyEvidenceReview: {
        readonly aggregate: ReturnType<typeof vi.fn>;
        readonly create: ReturnType<typeof vi.fn>;
      };
    }
    const transaction: MockCompanyEvidenceTransaction = {
      auditEvent: { create: vi.fn().mockResolvedValue(undefined) },
      companyEvidenceCitation: { updateMany: vi.fn().mockResolvedValue({}) },
      companyEvidenceFact: { update: vi.fn().mockResolvedValue(undefined) },
      companyEvidenceFactVersion: {
        update: vi.fn().mockResolvedValue(undefined),
      },
      companyEvidenceReview: {
        aggregate: vi.fn().mockResolvedValue({ _max: { reviewVersion: 1 } }),
        create: vi.fn().mockResolvedValue({ id: "review-a" }),
      },
    };
    type MockTransactionInput =
      | ((transaction: MockCompanyEvidenceTransaction) => Promise<unknown>)
      | readonly Promise<unknown>[];
    const database = {
      $transaction: vi.fn((input: MockTransactionInput) => {
        if (typeof input === "function") {
          return input(transaction);
        }
        return Promise.all(input);
      }),
      checklistGenerationRun: { updateMany: checklistGenerationRunUpdateMany },
      checklistItem: { updateMany: checklistItemUpdateMany },
      companyEvidenceFact: {
        findFirst: vi.fn().mockResolvedValue({
          currentVersion: {
            citations: [{ id: "citation-a" }],
            id: "fact-version-a",
            reviewState: "PENDING",
          },
          id: "fact-a",
        }),
      },
      eligibilityAssessment: { updateMany: eligibilityAssessmentUpdateMany },
      eligibilityAssessmentRun: {
        updateMany: eligibilityAssessmentRunUpdateMany,
      },
    };
    const service = new EligibilityService(database as never, {} as never);

    await expect(
      service.reviewFact(
        "organisation-a",
        "fact-a",
        {
          action: "ACCEPT",
          rationale: "Accepted company evidence with current citation.",
        },
        "user-a",
        "request-a",
      ),
    ).resolves.toEqual({ id: "review-a" });

    expect(eligibilityAssessmentRunUpdateMany).toHaveBeenCalledWith({
      data: {
        currentStage: "INVALIDATED",
        invalidatedAt: expect.any(Date),
        publicMessage: "Authoritative company evidence changed",
        status: "INVALIDATED",
      },
      where: {
        organisationId: "organisation-a",
        status: { notIn: ["FAILED", "CANCELLED", "INVALIDATED"] },
      },
    });
    expect(checklistGenerationRunUpdateMany).toHaveBeenCalledWith({
      data: {
        activatedAt: null,
        currentStage: "INVALIDATED",
        invalidatedAt: expect.any(Date),
        publicMessage: "Authoritative company evidence changed",
        status: "INVALIDATED",
      },
      where: { invalidatedAt: null, organisationId: "organisation-a" },
    });
    expect(checklistItemUpdateMany).toHaveBeenCalledWith({
      data: { invalidatedAt: expect.any(Date), status: "INVALIDATED" },
      where: { invalidatedAt: null, organisationId: "organisation-a" },
    });
  });
});
