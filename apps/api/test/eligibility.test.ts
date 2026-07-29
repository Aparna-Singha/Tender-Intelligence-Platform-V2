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
});
