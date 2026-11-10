import { describe, expect, it, vi } from "vitest";
import { ConflictException } from "@nestjs/common";
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
    expect(jobs.add).toHaveBeenCalledExactlyOnceWith(
      "extract-tender-version",
      expect.objectContaining({ extractionRunId: "extract-a" }),
      expect.objectContaining({ jobId: "extract-a" }),
    );
  });

  it("re-enqueues a committed queued run after a queue insertion failure", async () => {
    const queuedRun = {
      completedAt: null,
      createdAt: new Date(),
      currentStage: "QUEUED",
      eventSequence: 1,
      failureCategory: null,
      id: "queued-run",
      parserPolicyVersion: "policy",
      progressPercentage: 0,
      publicMessage: "Queued",
      qualitySummary: {},
      safeFailureMessage: null,
      sourceFingerprint: "fingerprint",
      startedAt: null,
      status: "QUEUED",
      structuringPolicyVersion: "policy",
      tenderVersionId: "version-a",
      triggerType: "USER",
      updatedAt: new Date(),
    };
    const database = {
      extractionRun: { findUnique: vi.fn().mockResolvedValue(queuedRun) },
      tenderVersion: {
        findFirst: vi.fn().mockResolvedValue({
          documents: [
            {
              id: "document-a",
              sha256: "a".repeat(64),
              status: "READY",
              approvedObjectKey: "private-key",
            },
          ],
          tender: { lifecycleStatus: "SOURCE_READY" },
        }),
      },
    };
    const jobs = { add: vi.fn().mockResolvedValue(undefined) };
    const service = new ExtractionsService(database as never, jobs as never);
    await expect(
      service.start(
        "org-a",
        "tender-a",
        "version-a",
        "user-a",
        "key-a",
        "request-a",
      ),
    ).resolves.toMatchObject({ id: "queued-run" });
    expect(jobs.add).toHaveBeenCalledWith(
      "extract-tender-version",
      expect.objectContaining({ extractionRunId: "queued-run" }),
      expect.objectContaining({ jobId: "queued-run" }),
    );
  });

  it("returns an active retry run for another retry click without creating a run", async () => {
    const activeRun = {
      completedAt: null,
      createdAt: new Date(),
      currentStage: "PARSING",
      eventSequence: 2,
      failureCategory: null,
      id: "active-retry",
      parserPolicyVersion: "policy",
      progressPercentage: 10,
      publicMessage: "Parsing",
      qualitySummary: {},
      safeFailureMessage: null,
      sourceFingerprint: "fingerprint",
      startedAt: new Date(),
      status: "PARSING",
      structuringPolicyVersion: "policy",
      tenderVersionId: "version-a",
      triggerType: "RETRY",
      updatedAt: new Date(),
    };
    const database = {
      extractionRun: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(activeRun),
      },
      tenderVersion: {
        findFirst: vi.fn().mockResolvedValue({
          documents: [
            {
              id: "document-a",
              sha256: "a".repeat(64),
              status: "READY",
              approvedObjectKey: "private-key",
            },
          ],
          tender: { lifecycleStatus: "SOURCE_READY" },
        }),
      },
      $transaction: vi.fn(),
    };
    const jobs = { add: vi.fn() };
    const service = new ExtractionsService(database as never, jobs as never);
    await expect(
      service.start(
        "org-a",
        "tender-a",
        "version-a",
        "user-a",
        "new-key",
        "request-a",
        "RETRY",
      ),
    ).resolves.toMatchObject({ id: "active-retry", status: "PARSING" });
    expect(database.$transaction).not.toHaveBeenCalled();
    expect(jobs.add).not.toHaveBeenCalled();
  });

  it("rechecks an active run under the version lock before creating another", async () => {
    const activeRun = {
      completedAt: null,
      createdAt: new Date(),
      currentStage: "QUEUED",
      eventSequence: 1,
      failureCategory: null,
      id: "concurrent-run",
      parserPolicyVersion: "policy",
      progressPercentage: 0,
      publicMessage: "Queued",
      qualitySummary: {},
      safeFailureMessage: null,
      sourceFingerprint: "fingerprint",
      startedAt: null,
      status: "QUEUED",
      structuringPolicyVersion: "policy",
      tenderVersionId: "version-a",
      triggerType: "RETRY",
      updatedAt: new Date(),
    };
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      extractionRun: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(activeRun),
        create: vi.fn(),
      },
      auditEvent: { create: vi.fn() },
    };
    const database = {
      extractionRun: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      tenderVersion: {
        findFirst: vi.fn().mockResolvedValue({
          documents: [
            {
              id: "document-a",
              sha256: "a".repeat(64),
              status: "READY",
              approvedObjectKey: "private-key",
            },
          ],
          tender: { lifecycleStatus: "SOURCE_READY" },
        }),
      },
      $transaction: vi.fn(
        async (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    };
    const jobs = { add: vi.fn() };
    const service = new ExtractionsService(database as never, jobs as never);
    await expect(
      service.start(
        "org-a",
        "tender-a",
        "version-a",
        "user-a",
        "second-key",
        "request-a",
        "RETRY",
      ),
    ).resolves.toMatchObject({ id: "concurrent-run" });
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
    expect(transaction.extractionRun.create).not.toHaveBeenCalled();
    expect(transaction.auditEvent.create).not.toHaveBeenCalled();
    expect(jobs.add).toHaveBeenCalledWith(
      "extract-tender-version",
      expect.objectContaining({ extractionRunId: "concurrent-run" }),
      expect.objectContaining({ jobId: "concurrent-run" }),
    );
  });

  it("replays the same retry key under the version lock after the first run fails", async () => {
    const failedRun = {
      id: "first-retry",
      status: "FAILED",
      tenderVersionId: "version-a",
    };
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      extractionRun: {
        findUnique: vi.fn().mockResolvedValue(failedRun),
        findFirst: vi.fn(),
        create: vi.fn(),
      },
      auditEvent: { create: vi.fn() },
    };
    const database = {
      extractionRun: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      tenderVersion: {
        findFirst: vi.fn().mockResolvedValue({
          documents: [
            {
              id: "document-a",
              sha256: "a".repeat(64),
              status: "READY",
              approvedObjectKey: "private-key",
            },
          ],
          tender: { lifecycleStatus: "SOURCE_READY" },
        }),
      },
      $transaction: vi.fn(
        async (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    };
    const jobs = { add: vi.fn() };
    const service = new ExtractionsService(database as never, jobs as never);
    await expect(
      service.start(
        "org-a",
        "tender-a",
        "version-a",
        "user-a",
        "same-key",
        "request-a",
        "RETRY",
      ),
    ).resolves.toMatchObject({ id: "first-retry", status: "FAILED" });
    expect(transaction.extractionRun.findFirst).not.toHaveBeenCalled();
    expect(transaction.extractionRun.create).not.toHaveBeenCalled();
    expect(transaction.auditEvent.create).not.toHaveBeenCalled();
    expect(jobs.add).not.toHaveBeenCalled();
  });

  it("refuses retry of a failed run from an older tender version", async () => {
    const database = {
      extractionRun: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ tenderVersionId: "old-version" }),
      },
      tender: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ currentVersionId: "current-version" }),
      },
    };
    const service = new ExtractionsService(database as never, {} as never);
    await expect(
      service.retry(
        "org-a",
        "tender-a",
        "failed-run",
        "user-a",
        "key-a",
        "request-a",
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
