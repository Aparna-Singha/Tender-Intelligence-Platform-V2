import { describe, expect, it, vi } from "vitest";
import { ExtractionsService } from "../src/extractions/extractions.service.js";

describe("extraction orchestration safety", () => {
  it("replays an equivalent current extraction without enqueueing a duplicate job", async () => {
    const queuedRun = {
      completedAt: null,
      createdAt: new Date("2026-08-22T09:00:00.000Z"),
      currentStage: "QUEUED",
      eventSequence: 1,
      failureCategory: null,
      id: "extract-a",
      parserPolicyVersion: "parser-policy",
      progressPercentage: 0,
      publicMessage: "Queued",
      qualitySummary: null,
      safeFailureMessage: null,
      sourceFingerprint: "fingerprint-a",
      startedAt: null,
      status: "QUEUED",
      structuringPolicyVersion: "structuring-policy",
      tenderVersionId: "version-a",
      triggerType: "USER",
      updatedAt: new Date("2026-08-22T09:00:00.000Z"),
    };
    const database = {
      extractionRun: {
        findFirst: vi.fn().mockResolvedValue(queuedRun),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      tenderVersion: {
        findFirst: vi.fn().mockResolvedValue({
          documents: [
            {
              approvedObjectKey: "approved/object-key",
              id: "document-a",
              sha256:
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              status: "READY",
            },
          ],
          tender: { lifecycleStatus: "SOURCE_READY" },
        }),
      },
    };
    const jobs = { add: vi.fn() };
    const service = new ExtractionsService(database as never, jobs as never);

    await expect(
      service.start(
        "organisation-a",
        "tender-a",
        "version-a",
        "user-a",
        "idempotency-a",
        "request-a",
      ),
    ).resolves.toMatchObject({
      id: "extract-a",
      status: "QUEUED",
      tender_version_id: "version-a",
    });

    expect(database.extractionRun.findFirst).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
      where: expect.objectContaining({
        organisationId: "organisation-a",
        status: { in: ["QUEUED", "PARSING", "STRUCTURING", "COMPLETE"] },
        tenderVersionId: "version-a",
      }),
    });
    expect(jobs.add).not.toHaveBeenCalled();
  });
});
