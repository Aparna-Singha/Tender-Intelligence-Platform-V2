import {
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { RisksService } from "../src/risks/risks.service.js";

describe("early risk-analysis tenant and source boundary", () => {
  it("does not reveal a cross-tenant risk run", async () => {
    const database = {
      riskAnalysisRun: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const service = new RisksService(database as never, {} as never);
    await expect(
      service.getRun("organisation-b", "tender-a", "run-a"),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(database.riskAnalysisRun.findFirst).toHaveBeenCalledWith({
      where: {
        id: "run-a",
        organisationId: "organisation-b",
        tenderId: "tender-a",
      },
    });
  });

  it("refuses analysis without an active completed extraction", async () => {
    const database = {
      tenderVersion: {
        findFirst: vi.fn().mockResolvedValue({ activeExtractionRun: null }),
      },
    };
    const jobs = { add: vi.fn() };
    const service = new RisksService(database as never, jobs as never);
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
    expect(database.tenderVersion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "version-a",
          tender: {
            deletedAt: null,
            id: "tender-a",
            organisationId: "organisation-a",
          },
        },
      }),
    );
  });
});
