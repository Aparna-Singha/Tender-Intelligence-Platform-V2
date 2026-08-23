const { getSignedUrlMock } = vi.hoisted(() => ({
  getSignedUrlMock: vi
    .fn()
    .mockResolvedValue(
      "https://signed.example/upload?X-Amz-SignedHeaders=content-length%3Bhost&x-amz-meta-sha256=expected-checksum",
    ),
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: getSignedUrlMock,
}));

import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import {
  BadRequestException,
  ConflictException,
  GoneException,
  NotFoundException,
} from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TendersService } from "../src/tenders/tenders.service.js";

const environment = {
  DOCUMENT_DOWNLOAD_TTL_SECONDS: 60,
  DOCUMENT_UPLOAD_TTL_SECONDS: 300,
  S3_BUCKET: "private-test",
} as never;
const fixedTestTime = new Date("2026-08-22T12:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(fixedTestTime);
  vi.clearAllMocks();
  getSignedUrlMock.mockResolvedValue(
    "https://signed.example/upload?X-Amz-SignedHeaders=content-length%3Bhost&x-amz-meta-sha256=expected-checksum",
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("tender workspace tenant isolation", () => {
  it("does not reveal a cross-tenant tender", async () => {
    const database = {
      tender: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const service = new TendersService(
      database as never,
      {} as never,
      {} as never,
      environment,
    );
    await expect(
      service.get("organisation-b", "tender-a", "user-a", "request-a"),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(database.tender.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deletedAt: null,
          id: "tender-a",
          organisationId: "organisation-b",
        },
      }),
    );
  });

  it("reads the persisted tender state without starting workflow orchestration", async () => {
    const workflowStartWrite = vi.fn();
    const database = {
      auditEvent: { create: vi.fn() },
      checklistGenerationRun: { create: workflowStartWrite },
      draft: { findMany: vi.fn().mockResolvedValue([]) },
      draftVersion: { findMany: vi.fn().mockResolvedValue([]) },
      draftGenerationRun: { findMany: vi.fn().mockResolvedValue([]) },
      earlyPursuitDecision: { findMany: vi.fn().mockResolvedValue([]) },
      eligibilityAssessmentRun: { create: workflowStartWrite },
      extractedTenderField: { findMany: vi.fn().mockResolvedValue([]) },
      extractionRun: { create: workflowStartWrite },
      processingJob: {
        create: workflowStartWrite,
        findMany: vi.fn().mockResolvedValue([]),
      },
      ragIndexRun: { create: workflowStartWrite },
      riskAnalysisRun: { create: workflowStartWrite },
      tender: {
        findFirst: vi.fn().mockResolvedValue({
          buyer: "Buyer department",
          corrigenda: [],
          currentVersion: {
            activeEarlyRiskRun: null,
            activeEligibilityAssessmentRun: null,
            activeExtractionRun: null,
            documents: [
              {
                role: "PRIMARY",
                status: "READY",
                uploadSessionExpiresAt: new Date("2026-08-22T23:59:59.000Z"),
              },
            ],
            id: "version-current",
          },
          currentVersionId: "version-current",
          id: "tender-a",
          isDemonstration: false,
          lifecycleStatus: "SOURCE_READY",
          sources: [],
          submissionDeadline: null,
          title: "Overload relay and its accessories",
          versions: [
            {
              documents: [],
              id: "version-current",
              reason: "Original tender source",
              versionNumber: 1,
            },
          ],
          workspace: {
            id: "workspace-a",
            processingProgress: 100,
            sourceSectionStatus: "READY",
          },
        }),
      },
    };
    const service = new TendersService(
      database as never,
      {} as never,
      {} as never,
      environment,
    );

    const result = (await service.get(
      "organisation-a",
      "tender-a",
      "reader-user",
      "request-a",
    )) as {
      readonly id: string;
      readonly workflowState: { readonly code: string };
    };

    expect(result.id).toBe("tender-a");
    expect(result.workflowState.code).toBe("FAILED_RECOVERABLE");
    expect(workflowStartWrite).not.toHaveBeenCalled();
    expect(database.auditEvent.create).not.toHaveBeenCalled();
  });

  it("does not sign quarantined or cross-tenant source files", async () => {
    const database = {
      tenderDocument: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const storage = { send: vi.fn() };
    const service = new TendersService(
      database as never,
      storage as never,
      {} as never,
      environment,
    );
    await expect(
      service.download(
        "organisation-b",
        "tender-a",
        "document-a",
        "user-a",
        "request-a",
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(database.tenderDocument.findFirst).toHaveBeenCalledWith({
      where: {
        approvedObjectKey: { not: null },
        id: "document-a",
        organisationId: "organisation-b",
        status: "READY",
        tenderVersion: { tenderId: "tender-a" },
      },
    });
    expect(storage.send).not.toHaveBeenCalled();
  });

  it("removes only an expired abandoned upload", async () => {
    const jobs = { add: vi.fn().mockResolvedValue(undefined) };
    const storage = { send: vi.fn().mockResolvedValue(undefined) };
    const database = {
      $transaction: vi.fn(async (operations: readonly Promise<unknown>[]) =>
        Promise.all(operations),
      ),
      auditEvent: { create: vi.fn().mockResolvedValue(undefined) },
      tenderDocument: {
        delete: vi.fn().mockResolvedValue(undefined),
        findFirst: vi.fn().mockResolvedValue({
          id: "document-a",
          quarantineObjectKey: "quarantine/object-key",
          role: "PRIMARY",
          sha256:
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          status: "UPLOADING",
          uploadSessionExpiresAt: new Date("2026-08-20T09:35:00.000Z"),
        }),
      },
    };
    const service = new TendersService(
      database as never,
      storage as never,
      jobs as never,
      environment,
    );

    await expect(
      service.abandonUpload(
        "organisation-a",
        "tender-a",
        "document-a",
        "user-a",
        "request-a",
      ),
    ).resolves.toEqual({ removed: true });

    expect(database.tenderDocument.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deletedAt: null,
          id: "document-a",
          organisationId: "organisation-a",
          tenderVersion: { tenderId: "tender-a" },
        },
      }),
    );
    expect(database.tenderDocument.delete).toHaveBeenCalledWith({
      where: { id: "document-a" },
    });
    expect(database.auditEvent.create).toHaveBeenCalledWith({
      data: {
        actorUserId: "user-a",
        eventType: "TENDER_UPLOAD_ABANDONED",
        metadata: {
          document_id: "document-a",
          pre_completion_cleanup: false,
          role: "PRIMARY",
        },
        organisationId: "organisation-a",
        outcome: "SUCCESS",
        requestId: "request-a",
        subjectId: "tender-a",
        subjectType: "tender",
      },
    });
    expect(storage.send).toHaveBeenCalledWith(expect.any(DeleteObjectCommand));
    expect(jobs.add).not.toHaveBeenCalled();
  });

  it("allows the uploader to abandon a current in-progress upload before expiry", async () => {
    const jobs = { add: vi.fn().mockResolvedValue(undefined) };
    const storage = { send: vi.fn().mockResolvedValue(undefined) };
    const database = {
      $transaction: vi.fn(async (operations: readonly Promise<unknown>[]) =>
        Promise.all(operations),
      ),
      auditEvent: { create: vi.fn().mockResolvedValue(undefined) },
      tenderDocument: {
        delete: vi.fn().mockResolvedValue(undefined),
        findFirst: vi.fn().mockResolvedValue({
          id: "document-a",
          quarantineObjectKey: "quarantine/object-key",
          role: "PRIMARY",
          sha256:
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          status: "UPLOADING",
          uploadSessionExpiresAt: new Date("2026-08-22T23:59:59.000Z"),
          uploadedByUserId: "user-a",
        }),
      },
    };
    const service = new TendersService(
      database as never,
      storage as never,
      jobs as never,
      environment,
    );

    await expect(
      service.abandonUpload(
        "organisation-a",
        "tender-a",
        "document-a",
        "user-a",
        "request-a",
      ),
    ).resolves.toEqual({ removed: true });

    expect(database.tenderDocument.delete).toHaveBeenCalledWith({
      where: { id: "document-a" },
    });
    expect(database.auditEvent.create).toHaveBeenCalledWith({
      data: {
        actorUserId: "user-a",
        eventType: "TENDER_UPLOAD_ABANDONED",
        metadata: {
          document_id: "document-a",
          pre_completion_cleanup: true,
          role: "PRIMARY",
        },
        organisationId: "organisation-a",
        outcome: "SUCCESS",
        requestId: "request-a",
        subjectId: "tender-a",
        subjectType: "tender",
      },
    });
  });

  it("treats a missing quarantine object as idempotent abandoned-upload cleanup success", async () => {
    const jobs = { add: vi.fn() };
    const storage = {
      send: vi.fn().mockRejectedValueOnce({
        $metadata: { httpStatusCode: 404 },
        name: "NoSuchKey",
      }),
    };
    const database = {
      $transaction: vi.fn(async (operations: readonly Promise<unknown>[]) =>
        Promise.all(operations),
      ),
      auditEvent: { create: vi.fn().mockResolvedValue(undefined) },
      tenderDocument: {
        delete: vi.fn().mockResolvedValue(undefined),
        findFirst: vi.fn().mockResolvedValue({
          id: "document-a",
          quarantineObjectKey: "quarantine/object-key",
          role: "PRIMARY",
          sha256:
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          status: "UPLOADING",
          uploadSessionExpiresAt: new Date("2026-08-20T09:35:00.000Z"),
        }),
      },
    };
    const service = new TendersService(
      database as never,
      storage as never,
      jobs as never,
      environment,
    );

    await expect(
      service.abandonUpload(
        "organisation-a",
        "tender-a",
        "document-a",
        "user-a",
        "request-a",
      ),
    ).resolves.toEqual({ removed: true });

    expect(jobs.add).not.toHaveBeenCalled();
  });

  it("queues exact-key cleanup when abandoned-upload storage deletion fails immediately", async () => {
    const jobs = { add: vi.fn().mockResolvedValue(undefined) };
    const storage = {
      send: vi.fn().mockRejectedValueOnce(new Error("S3 unavailable")),
    };
    const database = {
      $transaction: vi.fn(async (operations: readonly Promise<unknown>[]) =>
        Promise.all(operations),
      ),
      auditEvent: { create: vi.fn().mockResolvedValue(undefined) },
      tenderDocument: {
        delete: vi.fn().mockResolvedValue(undefined),
        findFirst: vi.fn().mockResolvedValue({
          id: "document-a",
          quarantineObjectKey: "quarantine/object-key",
          role: "PRIMARY",
          sha256:
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          status: "UPLOADING",
          uploadSessionExpiresAt: new Date("2026-08-20T09:35:00.000Z"),
        }),
      },
    };
    const service = new TendersService(
      database as never,
      storage as never,
      jobs as never,
      environment,
    );

    await expect(
      service.abandonUpload(
        "organisation-a",
        "tender-a",
        "document-a",
        "user-a",
        "request-a",
      ),
    ).resolves.toEqual({ removed: true });

    expect(jobs.add).toHaveBeenCalledWith(
      "cleanup-tender-document-storage",
      {
        documentId: "document-a",
        keys: ["quarantine/object-key"],
        organisationId: "organisation-a",
        requestId: "request-a",
        tenderId: "tender-a",
      },
      expect.objectContaining({
        attempts: 10,
        jobId: "cleanup-tender-document-ABANDONED_UPLOAD-document-a",
      }),
    );
  });

  it("refuses to remove a non-expired or already-processed upload", async () => {
    const database = {
      tenderDocument: {
        delete: vi.fn(),
        findFirst: vi.fn().mockResolvedValue({
          id: "document-a",
          role: "PRIMARY",
          sha256:
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          status: "FAILED",
          uploadSessionExpiresAt: new Date("2026-08-22T23:59:59.000Z"),
        }),
      },
    };
    const service = new TendersService(
      database as never,
      {} as never,
      {} as never,
      environment,
    );

    await expect(
      service.abandonUpload(
        "organisation-a",
        "tender-a",
        "document-a",
        "user-a",
        "request-a",
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(database.tenderDocument.delete).not.toHaveBeenCalled();
  });

  it("does not allow another user to abandon someone else's active upload before expiry", async () => {
    const database = {
      tenderDocument: {
        delete: vi.fn(),
        findFirst: vi.fn().mockResolvedValue({
          id: "document-a",
          role: "PRIMARY",
          sha256:
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          status: "UPLOADING",
          uploadSessionExpiresAt: new Date("2026-08-22T23:59:59.000Z"),
          uploadedByUserId: "user-a",
        }),
      },
    };
    const service = new TendersService(
      database as never,
      {} as never,
      {} as never,
      environment,
    );

    await expect(
      service.abandonUpload(
        "organisation-a",
        "tender-a",
        "document-a",
        "user-b",
        "request-a",
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(database.tenderDocument.delete).not.toHaveBeenCalled();
  });

  it("removes a current single-source ready document by creating a new empty version and invalidating the current source set", async () => {
    const storage = { send: vi.fn().mockResolvedValue(undefined) };
    const jobs = { add: vi.fn().mockResolvedValue(undefined) };
    const database = {
      $transaction: vi.fn(
        async (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
      auditEvent: { create: vi.fn().mockResolvedValue(undefined) },
      tenderDocument: {
        count: vi.fn().mockResolvedValue(1),
        findFirst: vi.fn().mockResolvedValue({
          approvedObjectKey: "approved/object-key",
          createdAt: new Date("2026-08-20T09:30:00.000Z"),
          declaredMimeType: "application/pdf",
          detectedMimeType: "application/pdf",
          displayFilename: "GeM-Bidding-9646270.pdf",
          extension: ".pdf",
          id: "document-a",
          originalFilename: "GeM-Bidding-9646270.pdf",
          provenance: "Direct upload",
          quarantineObjectKey: "quarantine/object-key",
          role: "PRIMARY",
          sha256:
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          sizeBytes: BigInt(1024),
          status: "READY",
          tenderVersionId: "version-a",
          uploadSessionExpiresAt: new Date("2026-08-22T23:59:59.000Z"),
          uploadedByUserId: "user-a",
          tenderVersion: {
            createdByUserId: "user-a",
            previousVersionId: null,
            reason: "Original tender source",
            sourceFingerprint: "fingerprint-a",
            sourceProvenance: "Manual upload",
            sourceSnapshot: { buyer: "Buyer" },
            tender: { currentVersionId: "version-a" },
            versionNumber: 1,
          },
        }),
      },
      tenderVersion: {
        create: vi.fn().mockResolvedValue({ id: "version-b" }),
      },
      tender: {
        update: vi.fn().mockResolvedValue(undefined),
      },
      tenderWorkspace: {
        update: vi.fn().mockResolvedValue(undefined),
      },
    };
    const transaction = {
      auditEvent: { create: vi.fn().mockResolvedValue(undefined) },
      tender: { update: vi.fn().mockResolvedValue(undefined) },
      tenderDocument: { update: vi.fn().mockResolvedValue(undefined) },
      tenderVersion: {
        create: vi.fn().mockResolvedValue({ id: "version-b" }),
      },
      tenderWorkspace: { update: vi.fn().mockResolvedValue(undefined) },
    };

    const service = new TendersService(
      database as never,
      storage as never,
      jobs as never,
      environment,
    );

    await expect(
      service.abandonUpload(
        "organisation-a",
        "tender-a",
        "document-a",
        "user-a",
        "request-a",
      ),
    ).resolves.toEqual({ removed: true });

    expect(database.tenderDocument.count).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        organisationId: "organisation-a",
        tenderVersionId: "version-a",
      },
    });
    expect(transaction.tenderVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        createdByUserId: "user-a",
        previousVersionId: "version-a",
        reason: "Removed tender file GeM-Bidding-9646270.pdf",
        tenderId: "tender-a",
        versionNumber: 2,
      }),
    });
    expect(transaction.tenderDocument.update).toHaveBeenCalledWith({
      data: { deletedAt: expect.any(Date) },
      where: { id: "document-a" },
    });
    expect(transaction.tender.update).toHaveBeenCalledWith({
      data: { currentVersionId: "version-b", lifecycleStatus: "DRAFT" },
      where: { id: "tender-a" },
    });
    expect(transaction.tenderWorkspace.update).toHaveBeenCalledWith({
      data: {
        processingProgress: 0,
        sourceSectionStatus: "NOT_STARTED",
        status: "DRAFT",
      },
      where: { tenderId: "tender-a" },
    });
    expect(transaction.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "user-a",
        eventType: "TENDER_UPDATED",
        organisationId: "organisation-a",
        outcome: "SUCCESS",
        requestId: "request-a",
        subjectId: "tender-a",
        subjectType: "tender",
      }),
    });
    expect(storage.send).toHaveBeenCalledTimes(2);
    expect(storage.send).toHaveBeenNthCalledWith(
      1,
      expect.any(DeleteObjectCommand),
    );
    expect(storage.send).toHaveBeenNthCalledWith(
      2,
      expect.any(DeleteObjectCommand),
    );
    expect(jobs.add).not.toHaveBeenCalled();
  });

  it("keeps the authoritative ready-source removal after an immediate storage failure and queues cleanup retries", async () => {
    const storage = {
      send: vi.fn().mockRejectedValueOnce(new Error("temporary MinIO failure")),
    };
    const jobs = { add: vi.fn().mockResolvedValue(undefined) };
    const database = {
      $transaction: vi.fn(
        async (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
      tenderDocument: {
        count: vi.fn().mockResolvedValue(1),
        findFirst: vi.fn().mockResolvedValue({
          approvedObjectKey: "approved/object-key",
          createdAt: new Date("2026-08-20T09:30:00.000Z"),
          declaredMimeType: "application/pdf",
          detectedMimeType: "application/pdf",
          displayFilename: "GeM-Bidding-9646270.pdf",
          extension: ".pdf",
          id: "document-a",
          originalFilename: "GeM-Bidding-9646270.pdf",
          provenance: "Direct upload",
          quarantineObjectKey: "quarantine/object-key",
          role: "PRIMARY",
          sha256:
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          sizeBytes: BigInt(1024),
          status: "READY",
          tenderVersionId: "version-a",
          uploadSessionExpiresAt: new Date("2026-08-22T23:59:59.000Z"),
          uploadedByUserId: "user-a",
          tenderVersion: {
            createdByUserId: "user-a",
            previousVersionId: null,
            reason: "Original tender source",
            sourceFingerprint: "fingerprint-a",
            sourceProvenance: "Manual upload",
            sourceSnapshot: { buyer: "Buyer" },
            tender: { currentVersionId: "version-a" },
            versionNumber: 1,
          },
        }),
      },
    };
    const transaction = {
      auditEvent: { create: vi.fn().mockResolvedValue(undefined) },
      tender: { update: vi.fn().mockResolvedValue(undefined) },
      tenderDocument: { update: vi.fn().mockResolvedValue(undefined) },
      tenderVersion: {
        create: vi.fn().mockResolvedValue({ id: "version-b" }),
      },
      tenderWorkspace: { update: vi.fn().mockResolvedValue(undefined) },
    };
    const service = new TendersService(
      database as never,
      storage as never,
      jobs as never,
      environment,
    );

    await expect(
      service.abandonUpload(
        "organisation-a",
        "tender-a",
        "document-a",
        "user-a",
        "request-a",
      ),
    ).resolves.toEqual({ removed: true });

    expect(transaction.tender.update).toHaveBeenCalledWith({
      data: { currentVersionId: "version-b", lifecycleStatus: "DRAFT" },
      where: { id: "tender-a" },
    });
    expect(jobs.add).toHaveBeenCalledWith(
      "cleanup-tender-document-storage",
      {
        documentId: "document-a",
        keys: ["approved/object-key", "quarantine/object-key"],
        organisationId: "organisation-a",
        requestId: "request-a",
        tenderId: "tender-a",
      },
      expect.objectContaining({
        attempts: 10,
        jobId: "cleanup-tender-document-READY_SOURCE_REMOVED-document-a",
      }),
    );
  });

  it("refuses to remove a ready document when the current source set contains multiple documents", async () => {
    const database = {
      tenderDocument: {
        count: vi.fn().mockResolvedValue(2),
        findFirst: vi.fn().mockResolvedValue({
          approvedObjectKey: "approved/object-key",
          createdAt: new Date("2026-08-20T09:30:00.000Z"),
          declaredMimeType: "application/pdf",
          detectedMimeType: "application/pdf",
          displayFilename: "GeM-Bidding-9646270.pdf",
          extension: ".pdf",
          id: "document-a",
          originalFilename: "GeM-Bidding-9646270.pdf",
          provenance: "Direct upload",
          quarantineObjectKey: "quarantine/object-key",
          role: "PRIMARY",
          sha256:
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          sizeBytes: BigInt(1024),
          status: "READY",
          tenderVersionId: "version-a",
          uploadSessionExpiresAt: new Date("2026-08-22T23:59:59.000Z"),
          uploadedByUserId: "user-a",
          tenderVersion: {
            createdByUserId: "user-a",
            previousVersionId: null,
            reason: "Original tender source",
            sourceFingerprint: "fingerprint-a",
            sourceProvenance: "Manual upload",
            sourceSnapshot: { buyer: "Buyer" },
            tender: { currentVersionId: "version-a" },
            versionNumber: 1,
          },
        }),
      },
    };

    const service = new TendersService(
      database as never,
      {} as never,
      {} as never,
      environment,
    );

    await expect(
      service.abandonUpload(
        "organisation-a",
        "tender-a",
        "document-a",
        "user-a",
        "request-a",
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("returns only processing jobs for the current tender version", async () => {
    const database = {
      draft: { findMany: vi.fn().mockResolvedValue([]) },
      draftVersion: { findMany: vi.fn().mockResolvedValue([]) },
      draftGenerationRun: { findMany: vi.fn().mockResolvedValue([]) },
      earlyPursuitDecision: { findMany: vi.fn().mockResolvedValue([]) },
      extractedTenderField: { findMany: vi.fn().mockResolvedValue([]) },
      processingJob: {
        findMany: vi.fn().mockResolvedValue([
          {
            currentStage: "COMPLETE",
            id: "job-current",
            progressPercentage: 100,
            publicMessage: "Tender source is ready",
            state: "COMPLETE",
          },
        ]),
      },
      tender: {
        findFirst: vi.fn().mockResolvedValue({
          buyer: "Buyer department",
          corrigenda: [],
          currentVersionId: "version-current",
          currentVersion: {
            activeEarlyRiskRun: null,
            activeEligibilityAssessmentRun: null,
            activeExtractionRun: null,
            documents: [],
            id: "version-current",
          },
          id: "tender-a",
          isDemonstration: false,
          lifecycleStatus: "SOURCE_READY",
          sources: [],
          submissionDeadline: null,
          title: "Overload relay and its accessories",
          versions: [
            {
              documents: [],
              id: "version-current",
              reason: "Removed tender file GeM-Bidding-9646270.pdf",
              versionNumber: 2,
            },
            {
              documents: [],
              id: "version-previous",
              reason: "Original tender source",
              versionNumber: 1,
            },
          ],
          workspace: {
            id: "workspace-a",
            processingProgress: 100,
            sourceSectionStatus: "READY",
          },
        }),
      },
    };
    const service = new TendersService(
      database as never,
      {} as never,
      {} as never,
      environment,
    );

    const result = (await service.get(
      "organisation-a",
      "tender-a",
      "user-a",
      "request-a",
    )) as {
      processingJobs: readonly { readonly id: string }[];
    };

    expect(database.processingJob.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
      select: {
        completedAt: true,
        createdAt: true,
        currentStage: true,
        eventSequence: true,
        failureCategory: true,
        id: true,
        progressPercentage: true,
        publicMessage: true,
        state: true,
        updatedAt: true,
      },
      take: 20,
      where: {
        organisationId: "organisation-a",
        tenderId: "tender-a",
        tenderVersionId: "version-current",
      },
    });
    expect(result.processingJobs).toEqual([
      expect.objectContaining({ id: "job-current" }),
    ]);
  });

  it("treats a current active draft version on the current tender version as review-ready", async () => {
    const database = {
      draft: {
        findMany: vi.fn().mockResolvedValue([
          {
            currentVersionId: "draft-version-current",
            tenderId: "tender-a",
          },
        ]),
      },
      draftGenerationRun: { findMany: vi.fn().mockResolvedValue([]) },
      draftVersion: {
        findMany: vi.fn().mockResolvedValue([
          {
            tenderId: "tender-a",
            tenderVersionId: "version-current",
          },
        ]),
      },
      earlyPursuitDecision: {
        findMany: vi.fn().mockResolvedValue([
          {
            decision: "CONTINUE",
            riskAnalysisRunId: "risk-current",
          },
        ]),
      },
      extractedTenderField: { findMany: vi.fn().mockResolvedValue([]) },
      processingJob: { findMany: vi.fn().mockResolvedValue([]) },
      tender: {
        findFirst: vi.fn().mockResolvedValue({
          buyer: "Buyer department",
          corrigenda: [],
          currentVersion: {
            activeEarlyRiskRun: {
              id: "risk-current",
              invalidatedAt: null,
              publicMessage: "Early cited risk analysis complete",
              safeFailureMessage: null,
              status: "COMPLETE",
            },
            activeEligibilityAssessmentRun: {
              invalidatedAt: null,
              publicMessage: "Eligibility comparison complete",
              safeFailureMessage: null,
              status: "COMPLETE",
            },
            activeExtractionRun: {
              id: "extract-current",
              invalidatedAt: null,
              publicMessage: "Extraction complete",
              safeFailureMessage: null,
              status: "COMPLETE",
            },
            documents: [
              {
                role: "PRIMARY",
                status: "READY",
                uploadSessionExpiresAt: new Date("2026-08-22T23:59:59.000Z"),
              },
            ],
            id: "version-current",
          },
          currentVersionId: "version-current",
          id: "tender-a",
          isDemonstration: false,
          lifecycleStatus: "SOURCE_READY",
          sources: [],
          submissionDeadline: null,
          title: "Overload relay and its accessories",
          versions: [
            {
              documents: [],
              id: "version-current",
              reason: "Original tender source",
              versionNumber: 1,
            },
          ],
          workspace: {
            id: "workspace-a",
            processingProgress: 100,
            sourceSectionStatus: "READY",
          },
        }),
      },
    };
    const service = new TendersService(
      database as never,
      {} as never,
      {} as never,
      environment,
    );

    const result = (await service.get(
      "organisation-a",
      "tender-a",
      "user-a",
      "request-a",
    )) as {
      workflowState: {
        readonly code: string;
        readonly isCompleted: boolean;
        readonly statusLabel: string;
      };
    };

    expect(database.draft.findMany).toHaveBeenCalledWith({
      select: {
        currentVersionId: true,
        tenderId: true,
      },
      where: {
        currentVersionId: { not: null },
        deletedAt: null,
        lifecycle: "ACTIVE",
        tenderId: { in: ["tender-a"] },
      },
    });
    expect(database.draftVersion.findMany).toHaveBeenCalledWith({
      select: {
        tenderId: true,
        tenderVersionId: true,
      },
      where: {
        id: { in: ["draft-version-current"] },
        invalidatedAt: null,
        tenderId: { in: ["tender-a"] },
        tenderVersionId: { in: ["version-current"] },
      },
    });
    expect(result.workflowState).toMatchObject({
      isCompleted: false,
      code: "REVIEW_READY",
      statusLabel: "Ready for review",
    });
  });

  it("does not count a current active draft version that belongs to an older tender version", async () => {
    const database = {
      draft: {
        findMany: vi.fn().mockResolvedValue([
          {
            currentVersionId: "draft-version-old",
            tenderId: "tender-a",
          },
        ]),
      },
      draftGenerationRun: { findMany: vi.fn().mockResolvedValue([]) },
      draftVersion: { findMany: vi.fn().mockResolvedValue([]) },
      earlyPursuitDecision: {
        findMany: vi.fn().mockResolvedValue([
          {
            decision: "CONTINUE",
            riskAnalysisRunId: "risk-current",
          },
        ]),
      },
      extractedTenderField: { findMany: vi.fn().mockResolvedValue([]) },
      processingJob: { findMany: vi.fn().mockResolvedValue([]) },
      tender: {
        findFirst: vi.fn().mockResolvedValue({
          buyer: "Buyer department",
          corrigenda: [],
          currentVersion: {
            activeEarlyRiskRun: {
              id: "risk-current",
              invalidatedAt: null,
              publicMessage: "Early cited risk analysis complete",
              safeFailureMessage: null,
              status: "COMPLETE",
            },
            activeEligibilityAssessmentRun: {
              invalidatedAt: null,
              publicMessage: "Eligibility comparison complete",
              safeFailureMessage: null,
              status: "COMPLETE",
            },
            activeExtractionRun: {
              id: "extract-current",
              invalidatedAt: null,
              publicMessage: "Extraction complete",
              safeFailureMessage: null,
              status: "COMPLETE",
            },
            documents: [
              {
                role: "PRIMARY",
                status: "READY",
                uploadSessionExpiresAt: new Date("2026-08-22T23:59:59.000Z"),
              },
            ],
            id: "version-current",
          },
          currentVersionId: "version-current",
          id: "tender-a",
          isDemonstration: false,
          lifecycleStatus: "SOURCE_READY",
          sources: [],
          submissionDeadline: null,
          title: "Overload relay and its accessories",
          versions: [
            {
              documents: [],
              id: "version-current",
              reason: "Corrigendum 1",
              versionNumber: 2,
            },
            {
              documents: [],
              id: "version-old",
              reason: "Original tender source",
              versionNumber: 1,
            },
          ],
          workspace: {
            id: "workspace-a",
            processingProgress: 100,
            sourceSectionStatus: "READY",
          },
        }),
      },
    };
    const service = new TendersService(
      database as never,
      {} as never,
      {} as never,
      environment,
    );

    const result = (await service.get(
      "organisation-a",
      "tender-a",
      "user-a",
      "request-a",
    )) as {
      workflowState: {
        readonly code: string;
        readonly isCompleted: boolean;
        readonly statusLabel: string;
      };
    };

    expect(database.draftVersion.findMany).toHaveBeenCalledWith({
      select: {
        tenderId: true,
        tenderVersionId: true,
      },
      where: {
        id: { in: ["draft-version-old"] },
        invalidatedAt: null,
        tenderId: { in: ["tender-a"] },
        tenderVersionId: { in: ["version-current"] },
      },
    });
    expect(result.workflowState).toMatchObject({
      code: "ANALYSIS_READY",
      isCompleted: false,
      statusLabel: "Analysis ready",
    });
  });

  it("does not report review-ready when no current draft exists", async () => {
    const database = {
      draft: { findMany: vi.fn().mockResolvedValue([]) },
      draftGenerationRun: { findMany: vi.fn().mockResolvedValue([]) },
      draftVersion: { findMany: vi.fn().mockResolvedValue([]) },
      earlyPursuitDecision: {
        findMany: vi.fn().mockResolvedValue([
          {
            decision: "CONTINUE",
            riskAnalysisRunId: "risk-current",
          },
        ]),
      },
      extractedTenderField: { findMany: vi.fn().mockResolvedValue([]) },
      processingJob: { findMany: vi.fn().mockResolvedValue([]) },
      tender: {
        findFirst: vi.fn().mockResolvedValue({
          buyer: "Buyer department",
          corrigenda: [],
          currentVersion: {
            activeEarlyRiskRun: {
              id: "risk-current",
              invalidatedAt: null,
              publicMessage: "Early cited risk analysis complete",
              safeFailureMessage: null,
              status: "COMPLETE",
            },
            activeEligibilityAssessmentRun: {
              invalidatedAt: null,
              publicMessage: "Eligibility comparison complete",
              safeFailureMessage: null,
              status: "COMPLETE",
            },
            activeExtractionRun: {
              id: "extract-current",
              invalidatedAt: null,
              publicMessage: "Extraction complete",
              safeFailureMessage: null,
              status: "COMPLETE",
            },
            documents: [
              {
                role: "PRIMARY",
                status: "READY",
                uploadSessionExpiresAt: new Date("2026-08-22T23:59:59.000Z"),
              },
            ],
            id: "version-current",
          },
          currentVersionId: "version-current",
          id: "tender-a",
          isDemonstration: false,
          lifecycleStatus: "SOURCE_READY",
          sources: [],
          submissionDeadline: null,
          title: "Overload relay and its accessories",
          versions: [
            {
              documents: [],
              id: "version-current",
              reason: "Original tender source",
              versionNumber: 1,
            },
          ],
          workspace: {
            id: "workspace-a",
            processingProgress: 100,
            sourceSectionStatus: "READY",
          },
        }),
      },
    };
    const service = new TendersService(
      database as never,
      {} as never,
      {} as never,
      environment,
    );

    const result = (await service.get(
      "organisation-a",
      "tender-a",
      "user-a",
      "request-a",
    )) as {
      workflowState: {
        readonly code: string;
        readonly isCompleted: boolean;
        readonly statusLabel: string;
      };
    };

    expect(database.draftVersion.findMany).not.toHaveBeenCalled();
    expect(result.workflowState).toMatchObject({
      code: "ANALYSIS_READY",
      isCompleted: false,
      statusLabel: "Analysis ready",
    });
  });

  it("does not mark failed workflow states as completed", async () => {
    const database = {
      draft: { findMany: vi.fn().mockResolvedValue([]) },
      draftGenerationRun: { findMany: vi.fn().mockResolvedValue([]) },
      draftVersion: { findMany: vi.fn().mockResolvedValue([]) },
      earlyPursuitDecision: { findMany: vi.fn().mockResolvedValue([]) },
      extractedTenderField: { findMany: vi.fn().mockResolvedValue([]) },
      processingJob: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { publicMessage: "Upload needs attention.", state: "FAILED" },
          ]),
      },
      tender: {
        findFirst: vi.fn().mockResolvedValue({
          buyer: "Buyer department",
          corrigenda: [],
          currentVersion: {
            activeEarlyRiskRun: null,
            activeEligibilityAssessmentRun: null,
            activeExtractionRun: null,
            documents: [
              {
                role: "PRIMARY",
                status: "READY",
                uploadSessionExpiresAt: new Date("2026-08-22T23:59:59.000Z"),
              },
            ],
            id: "version-current",
          },
          currentVersionId: "version-current",
          id: "tender-a",
          isDemonstration: false,
          lifecycleStatus: "SOURCE_READY",
          sources: [],
          submissionDeadline: null,
          title: "Overload relay and its accessories",
          versions: [
            {
              documents: [],
              id: "version-current",
              reason: "Original tender source",
              versionNumber: 1,
            },
          ],
          workspace: {
            id: "workspace-a",
            processingProgress: 100,
            sourceSectionStatus: "FAILED",
          },
        }),
      },
    };
    const service = new TendersService(
      database as never,
      {} as never,
      {} as never,
      environment,
    );

    const result = (await service.get(
      "organisation-a",
      "tender-a",
      "user-a",
      "request-a",
    )) as {
      workflowState: {
        readonly code: string;
        readonly isCompleted: boolean;
        readonly statusLabel: string;
      };
    };

    expect(result.workflowState).toMatchObject({
      code: "FAILED_RECOVERABLE",
      isCompleted: false,
      statusLabel: "Source processing failed",
    });
  });

  it("prefers the source-extracted deadline and exposes the shared workflow state", async () => {
    const database = {
      draft: { findMany: vi.fn().mockResolvedValue([]) },
      draftVersion: { findMany: vi.fn().mockResolvedValue([]) },
      draftGenerationRun: { findMany: vi.fn().mockResolvedValue([]) },
      earlyPursuitDecision: { findMany: vi.fn().mockResolvedValue([]) },
      extractedTenderField: {
        findMany: vi.fn().mockResolvedValue([
          {
            extractionRunId: "extract-current",
            normalizedTextValue: "21-08-2026 09:00:00",
          },
        ]),
      },
      processingJob: { findMany: vi.fn().mockResolvedValue([]) },
      tender: {
        findFirst: vi.fn().mockResolvedValue({
          buyer: "Buyer department",
          corrigenda: [],
          currentVersion: {
            activeEarlyRiskRun: {
              id: "risk-current",
              invalidatedAt: null,
              publicMessage: "Early cited risk analysis complete",
              safeFailureMessage: null,
              status: "COMPLETE",
            },
            activeEligibilityAssessmentRun: null,
            activeExtractionRun: {
              id: "extract-current",
              invalidatedAt: null,
              publicMessage: "Extraction complete",
              safeFailureMessage: null,
              status: "COMPLETE",
            },
            documents: [
              {
                role: "PRIMARY",
                status: "READY",
                uploadSessionExpiresAt: new Date("2026-08-22T23:59:59.000Z"),
              },
            ],
            id: "version-current",
          },
          currentVersionId: "version-current",
          id: "tender-a",
          isDemonstration: false,
          lifecycleStatus: "SOURCE_READY",
          sources: [],
          submissionDeadline: new Date("2026-08-20T03:30:00.000Z"),
          title: "Overload relay and its accessories",
          versions: [
            {
              documents: [],
              id: "version-current",
              reason: "Original tender source",
              versionNumber: 1,
            },
          ],
          workspace: {
            id: "workspace-a",
            processingProgress: 100,
            sourceSectionStatus: "READY",
          },
        }),
      },
    };
    const service = new TendersService(
      database as never,
      {} as never,
      {} as never,
      environment,
    );

    const result = (await service.get(
      "organisation-a",
      "tender-a",
      "user-a",
      "request-a",
    )) as {
      deadlineResolution: { readonly hasMismatch: boolean };
      submissionDeadline?: string;
      workflowState: { readonly code: string; readonly statusLabel: string };
    };

    expect(result.submissionDeadline).toBe("2026-08-21T03:30:00.000Z");
    expect(result.deadlineResolution.hasMismatch).toBe(true);
    expect(result.workflowState).toMatchObject({
      code: "AWAITING_EARLY_DECISION",
      statusLabel: "Review tender",
    });
  });
});

describe("tender direct upload contract", () => {
  it("presigns tender uploads with sha256 metadata in the URL-backed contract", async () => {
    const database = {
      auditEvent: { create: vi.fn().mockResolvedValue(undefined) },
      tenderDocument: {
        create: vi.fn().mockResolvedValue({ id: "document-a" }),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      tenderVersion: {
        findFirst: vi.fn().mockResolvedValue({ id: "version-a" }),
      },
    };
    const storage = { send: vi.fn() };
    const service = new TendersService(
      database as never,
      storage as never,
      {} as never,
      environment,
    );

    const result = (await service.createUpload(
      "organisation-a",
      "tender-a",
      "version-a",
      "user-a",
      {
        checksum_sha256:
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        filename: "Synthetic_GeM_Tender_Test.pdf",
        mime_type: "application/pdf",
        role: "PRIMARY",
        size_bytes: 1024,
      },
      "request-a",
    )) as { readonly upload_url: string };

    expect(result.upload_url).toContain("x-amz-meta-sha256=expected-checksum");
    expect(getSignedUrlMock).toHaveBeenCalledTimes(1);
    const command = getSignedUrlMock.mock.calls[0]?.[1];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect((command as PutObjectCommand).input).toMatchObject({
      Bucket: "private-test",
      ContentLength: 1024,
      ContentType: "application/pdf",
      Key: expect.stringContaining("tender-quarantine/organisation-a/"),
      Metadata: {
        sha256:
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    });
  });

  it("completes tender uploads only when HeadObject returns the expected sha256 metadata", async () => {
    const storage = {
      send: vi.fn().mockResolvedValue({
        ContentLength: 1024,
        ContentType: "application/pdf",
        Metadata: {
          sha256:
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      }),
    };
    const jobs = { add: vi.fn().mockResolvedValue(undefined) };
    const transaction = {
      auditEvent: { create: vi.fn().mockResolvedValue(undefined) },
      processingJob: {
        create: vi.fn().mockResolvedValue({ id: "job-a", state: "QUEUED" }),
      },
      tender: { update: vi.fn().mockResolvedValue(undefined) },
      tenderDocument: { update: vi.fn().mockResolvedValue(undefined) },
      tenderWorkspace: { update: vi.fn().mockResolvedValue(undefined) },
    };
    const database = {
      $transaction: vi.fn(
        async (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
      processingJob: { findUnique: vi.fn().mockResolvedValue(null) },
      tenderDocument: {
        findFirst: vi.fn().mockResolvedValue({
          declaredMimeType: "application/pdf",
          id: "document-a",
          organisationId: "organisation-a",
          quarantineObjectKey: "tender-quarantine/organisation-a/document-a",
          sha256:
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          sizeBytes: BigInt(1024),
          tenderId: "tender-a",
          tenderVersionId: "version-a",
          uploadSessionExpiresAt: new Date("2026-08-22T23:59:59.000Z"),
        }),
      },
    };
    const service = new TendersService(
      database as never,
      storage as never,
      jobs as never,
      environment,
    );

    const result = (await service.completeUpload(
      "organisation-a",
      "tender-a",
      "document-a",
      "user-a",
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "request-a",
    )) as { readonly job_id: string; readonly state: string };

    expect(result).toEqual({ job_id: "job-a", state: "QUEUED" });
    expect(storage.send).toHaveBeenCalledWith(expect.any(HeadObjectCommand));
    expect(jobs.add).toHaveBeenCalledWith(
      "process-tender-document",
      {
        documentId: "document-a",
        jobId: "job-a",
        organisationId: "organisation-a",
        requestId: "request-a",
      },
      { attempts: 3, jobId: "job-a", removeOnComplete: 100 },
    );
  });

  it("rejects tender upload completion when the stored object metadata sha256 does not match", async () => {
    const storage = {
      send: vi.fn().mockResolvedValue({
        ContentLength: 1024,
        ContentType: "application/pdf",
        Metadata: {
          sha256:
            "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
      }),
    };
    const jobs = { add: vi.fn() };
    const database = {
      processingJob: { findUnique: vi.fn().mockResolvedValue(null) },
      tenderDocument: {
        findFirst: vi.fn().mockResolvedValue({
          declaredMimeType: "application/pdf",
          id: "document-a",
          quarantineObjectKey: "tender-quarantine/organisation-a/document-a",
          sha256:
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          sizeBytes: BigInt(1024),
          tenderVersionId: "version-a",
          uploadSessionExpiresAt: new Date("2026-08-22T23:59:59.000Z"),
        }),
      },
    };
    const service = new TendersService(
      database as never,
      storage as never,
      jobs as never,
      environment,
    );

    await expect(
      service.completeUpload(
        "organisation-a",
        "tender-a",
        "document-a",
        "user-a",
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "request-a",
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(jobs.add).not.toHaveBeenCalled();
  });

  it("rejects tender upload completion when the upload session has expired", async () => {
    const storage = { send: vi.fn() };
    const jobs = { add: vi.fn() };
    const database = {
      processingJob: { findUnique: vi.fn().mockResolvedValue(null) },
      tenderDocument: {
        findFirst: vi.fn().mockResolvedValue({
          declaredMimeType: "application/pdf",
          id: "document-a",
          organisationId: "organisation-a",
          quarantineObjectKey: "tender-quarantine/organisation-a/document-a",
          sha256:
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          sizeBytes: BigInt(1024),
          tenderVersionId: "version-a",
          uploadSessionExpiresAt: new Date("2026-08-20T09:35:00.000Z"),
        }),
      },
    };
    const service = new TendersService(
      database as never,
      storage as never,
      jobs as never,
      environment,
    );

    await expect(
      service.completeUpload(
        "organisation-a",
        "tender-a",
        "document-a",
        "user-a",
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "request-a",
      ),
    ).rejects.toBeInstanceOf(GoneException);
    expect(storage.send).not.toHaveBeenCalled();
    expect(jobs.add).not.toHaveBeenCalled();
  });
});
