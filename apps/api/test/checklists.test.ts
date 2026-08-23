import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ChecklistsService } from "../src/checklists/checklists.service.js";

describe("Phase 8 prerequisite and tenant boundary", () => {
  it("does not reveal another organisation's run or item", async () => {
    const database = {
      checklistGenerationRun: { findFirst: vi.fn().mockResolvedValue(null) },
      checklistItem: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const service = new ChecklistsService(database as never, {} as never);
    await expect(
      service.run("organisation-b", "tender-a", "run-a"),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.item("organisation-b", "tender-a", "run-a", "item-a"),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(database.checklistItem.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          generationRunId: "run-a",
          id: "item-a",
          organisationId: "organisation-b",
          tenderId: "tender-a",
        }),
      }),
    );
  });

  it("blocks generation without current extraction and risk inputs", async () => {
    const database = {
      tenderVersion: {
        findFirst: vi.fn().mockResolvedValue({
          activeEarlyRiskRun: null,
          activeEligibilityAssessmentRun: null,
          activeExtractionRun: null,
        }),
      },
    };
    const jobs = { add: vi.fn() };
    const service = new ChecklistsService(database as never, jobs as never);
    await expect(
      service.start("o", "t", "v", "u", "idempotency", "request"),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(jobs.add).not.toHaveBeenCalled();
  });

  it.each(["HOLD", "STOP", undefined])(
    "blocks a %s or missing current pursuit decision",
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
              extractionRunId: "extraction",
              id: "risk",
              invalidatedAt: null,
              status: "COMPLETE",
            },
            activeEligibilityAssessmentRun: null,
            activeExtractionRun: {
              id: "extraction",
              invalidatedAt: null,
              status: "COMPLETE",
            },
          }),
        },
      };
      const service = new ChecklistsService(database as never, {} as never);
      await expect(
        service.start("o", "t", "v", "u", "idempotency", "request"),
      ).rejects.toBeInstanceOf(ConflictException);
    },
  );

  it("reuses an existing current checklist run when the authoritative fingerprint matches across different client keys", async () => {
    const existingRun = {
      id: "checklist-run-existing",
      idempotencyKey:
        "organisation-a:current:9a9e9d2abf4c1f1bbf711a1d7df36658b2a24766fd7a8cd1e6487c0fb46f8f43",
      sourceFingerprint:
        "9a9e9d2abf4c1f1bbf711a1d7df36658b2a24766fd7a8cd1e6487c0fb46f8f43",
      status: "COMPLETE",
    };
    const database = {
      checklistGenerationRun: {
        findFirst: vi.fn().mockResolvedValue(existingRun),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      earlyPursuitDecision: {
        findFirst: vi.fn().mockResolvedValue({
          decision: "CONTINUE",
          id: "decision-a",
        }),
      },
      tenderVersion: {
        findFirst: vi.fn().mockResolvedValue({
          activeEarlyRiskRun: {
            extractionRunId: "extraction",
            id: "risk",
            invalidatedAt: null,
            status: "COMPLETE",
          },
          activeEligibilityAssessmentRun: {
            assessments: [
              {
                currentState: "VERIFIED",
                evidenceLinks: [{ id: "link-a" }],
                id: "assessment-a",
                reviewState: "FINALISED",
                reviews: [{ id: "review-a" }],
                updatedAt: new Date("2026-08-22T12:00:00.000Z"),
              },
            ],
            extractionRunId: "extraction",
            id: "eligibility-a",
            invalidatedAt: null,
            pursuitDecisionId: "decision-a",
            riskAnalysisRunId: "risk",
            snapshot: {
              fingerprint: "assessment-fingerprint-a",
            },
            snapshotId: "snapshot-a",
            sourceFingerprint: "assessment-fingerprint-a",
            status: "COMPLETE",
          },
          activeExtractionRun: {
            id: "extraction",
            invalidatedAt: null,
            status: "COMPLETE",
          },
        }),
      },
      $transaction: vi.fn(),
    };
    const jobs = { add: vi.fn() };
    const service = new ChecklistsService(database as never, jobs as never);

    await expect(
      service.start(
        "organisation-a",
        "tender-a",
        "version-a",
        "user-a",
        "manual-checklist-run",
        "request-a",
      ),
    ).resolves.toBe(existingRun);

    expect(database.checklistGenerationRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          invalidatedAt: null,
          organisationId: "organisation-a",
          tenderId: "tender-a",
          tenderVersionId: "version-a",
        }),
      }),
    );
    expect(jobs.add).not.toHaveBeenCalled();
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  it("rejects assignment to a user outside the organisation", async () => {
    const database = {
      checklistItem: {
        findFirst: vi.fn().mockResolvedValue({
          assigneeUserId: null,
          history: [],
          id: "item",
          invalidatedAt: null,
          currentPriority: "HIGH",
          status: "OPEN",
        }),
      },
      organisationMembership: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const service = new ChecklistsService(database as never, {} as never);
    await expect(
      service.update(
        "organisation-a",
        "tender-a",
        "run-a",
        "item",
        {
          assignee_id: "2c441070-5208-49f9-9382-a5ec6008123f",
          rationale: "Assign this action to an authorised member.",
        },
        "actor",
        "request",
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
