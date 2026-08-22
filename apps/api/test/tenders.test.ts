import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TendersService } from "../src/tenders/tenders.service.js";

const environment = {
  DOCUMENT_DOWNLOAD_TTL_SECONDS: 60,
  DOCUMENT_UPLOAD_TTL_SECONDS: 300,
  S3_BUCKET: "private-test",
} as never;

const orchestrator = {
  ensureCurrentPipeline: vi.fn().mockResolvedValue(undefined),
} as never;

beforeEach(() => {
  vi.clearAllMocks();
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
      orchestrator,
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
      orchestrator,
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
    const database = {
      auditEvent: { create: vi.fn().mockResolvedValue(undefined) },
      tenderDocument: {
        delete: vi.fn().mockResolvedValue(undefined),
        findFirst: vi.fn().mockResolvedValue({
          id: "document-a",
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
      {} as never,
      {} as never,
      environment,
      orchestrator,
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
        metadata: { document_id: "document-a", role: "PRIMARY" },
        organisationId: "organisation-a",
        outcome: "SUCCESS",
        requestId: "request-a",
        subjectId: "tender-a",
        subjectType: "tender",
      },
    });
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
      orchestrator,
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

  it("removes a current single-source ready document by creating a new empty version and invalidating the current source set", async () => {
    const storage = { send: vi.fn().mockResolvedValue(undefined) };
    const database = {
      $transaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
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
      {} as never,
      environment,
      orchestrator,
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
      orchestrator,
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
      orchestrator,
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

  it("prefers the source-extracted deadline and exposes the shared workflow state", async () => {
    const database = {
      draft: { findMany: vi.fn().mockResolvedValue([]) },
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
      orchestrator,
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
