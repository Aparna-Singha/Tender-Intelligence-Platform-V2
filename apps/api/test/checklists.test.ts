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
