import {
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { Prisma } from "@tender/database";
import { describe, expect, it, vi } from "vitest";
import { RisksService } from "../src/risks/risks.service.js";

describe("early risk-analysis tenant and source boundary", () => {
  it("uses the same current-lineage idempotency key for auto and explicit starts", async () => {
    const extraction = {
      id: "extract-a",
      invalidatedAt: null,
      sourceFingerprint: "source-a",
      status: "COMPLETE",
    };
    const existing = { id: "risk-a" };
    const database = {
      riskAnalysisRun: {
        findFirst: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(existing),
      },
      tenderVersion: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ activeExtractionRun: extraction }),
      },
    };
    const service = new RisksService(
      database as never,
      { add: vi.fn() } as never,
      {} as never,
    );

    await expect(
      service.start(
        "organisation-a",
        "tender-a",
        "version-a",
        "user-a",
        "system-auto-risk",
        "request-a",
      ),
    ).resolves.toBe(existing);
    await expect(
      service.start(
        "organisation-a",
        "tender-a",
        "version-a",
        "user-a",
        "release-risk-a",
        "request-b",
      ),
    ).resolves.toBe(existing);

    const keys = database.riskAnalysisRun.findUnique.mock.calls.map(
      (call) =>
        (call[0] as { where: { idempotencyKey: string } }).where.idempotencyKey,
    );
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).toMatch(/^organisation-a:current:/u);
  });

  it("returns the concurrently created current-lineage run on P2002", async () => {
    const extraction = {
      id: "extract-a",
      invalidatedAt: null,
      sourceFingerprint: "source-a",
      status: "COMPLETE",
    };
    const concurrentRun = { id: "risk-concurrent" };
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(concurrentRun);
    const database = {
      $transaction: vi.fn().mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          clientVersion: "test",
          code: "P2002",
        }),
      ),
      riskAnalysisRun: {
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique,
      },
      tenderVersion: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ activeExtractionRun: extraction }),
      },
    };
    const jobs = { add: vi.fn() };
    const service = new RisksService(
      database as never,
      jobs as never,
      {} as never,
    );

    await expect(
      service.start(
        "organisation-a",
        "tender-a",
        "version-a",
        "user-a",
        "system-auto-risk",
        "request-a",
      ),
    ).resolves.toBe(concurrentRun);
    expect(jobs.add).not.toHaveBeenCalled();
    expect(findUnique).toHaveBeenNthCalledWith(1, {
      where: {
        idempotencyKey: expect.stringMatching(/^organisation-a:current:/u),
      },
    });
    expect(findUnique).toHaveBeenNthCalledWith(2, {
      where: {
        idempotencyKey: expect.stringMatching(/^organisation-a:current:/u),
      },
    });
  });

  it("does not reveal a cross-tenant risk run", async () => {
    const database = {
      riskAnalysisRun: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const service = new RisksService(
      database as never,
      {} as never,
      {} as never,
    );
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
    const service = new RisksService(
      database as never,
      jobs as never,
      {} as never,
    );
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

  it.each(["HOLD", "STOP"] as const)(
    "records %s without scheduling eligibility progression",
    async (decisionCode) => {
      const schedule = vi.fn();
      const database = {
        $transaction: vi.fn(
          (
            callback: (
              transaction: Record<string, unknown>,
            ) => Promise<unknown>,
          ) =>
            callback({
              auditEvent: { create: vi.fn().mockResolvedValue(undefined) },
              checklistGenerationRun: { updateMany: vi.fn() },
              checklistItem: { updateMany: vi.fn() },
              earlyPursuitDecision: {
                create: vi.fn().mockResolvedValue({
                  decision: decisionCode,
                  id: "decision-a",
                }),
                findFirst: vi.fn().mockResolvedValue(null),
              },
              eligibilityAssessment: { updateMany: vi.fn() },
              eligibilityAssessmentRun: { updateMany: vi.fn() },
              tenderVersion: { updateMany: vi.fn() },
            }),
        ),
        riskAnalysisRun: {
          findFirst: vi.fn().mockResolvedValue({
            id: "run-a",
            invalidatedAt: null,
            status: "COMPLETE",
            tenderId: "tender-a",
            tenderVersionId: "version-a",
          }),
        },
        riskFinding: { count: vi.fn().mockResolvedValue(0) },
      };
      const service = new RisksService(
        database as never,
        {} as never,
        { schedule } as never,
      );

      await service.decision(
        "organisation-a",
        "tender-a",
        "run-a",
        {
          acknowledged_limitations: true,
          decision: decisionCode,
          rationale: `${decisionCode} for now`,
        },
        "user-a",
        "request-a",
      );

      expect(schedule).not.toHaveBeenCalled();
    },
  );

  it("records CONTINUE and schedules authoritative eligibility progression", async () => {
    const schedule = vi.fn().mockResolvedValue(undefined);
    const database = {
      $transaction: vi.fn(
        (
          callback: (transaction: Record<string, unknown>) => Promise<unknown>,
        ) =>
          callback({
            auditEvent: { create: vi.fn().mockResolvedValue(undefined) },
            checklistGenerationRun: { updateMany: vi.fn() },
            checklistItem: { updateMany: vi.fn() },
            earlyPursuitDecision: {
              create: vi.fn().mockResolvedValue({
                decision: "CONTINUE",
                id: "decision-a",
              }),
              findFirst: vi.fn().mockResolvedValue(null),
            },
            eligibilityAssessment: { updateMany: vi.fn() },
            eligibilityAssessmentRun: { updateMany: vi.fn() },
            tenderVersion: { updateMany: vi.fn() },
          }),
      ),
      riskAnalysisRun: {
        findFirst: vi.fn().mockResolvedValue({
          id: "run-a",
          invalidatedAt: null,
          status: "COMPLETE",
          tenderId: "tender-a",
          tenderVersionId: "version-a",
        }),
      },
      riskFinding: { count: vi.fn().mockResolvedValue(2) },
    };
    const service = new RisksService(
      database as never,
      {} as never,
      { schedule } as never,
    );

    await service.decision(
      "organisation-a",
      "tender-a",
      "run-a",
      {
        acknowledged_limitations: true,
        decision: "CONTINUE",
        rationale: "Authorised to proceed",
      },
      "user-a",
      "request-a",
    );

    expect(schedule).toHaveBeenCalledWith({
      organisationId: "organisation-a",
      requestId: "request-a",
      tenderId: "tender-a",
      triggerId: "decision-a",
      triggerType: "CONTINUE_DECISION",
      userId: "user-a",
    });
  });
});
