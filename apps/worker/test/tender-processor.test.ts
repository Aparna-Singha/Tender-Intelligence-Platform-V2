import { createHash } from "node:crypto";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import {
  TenderProcessor,
  type TenderDocumentCleanupJob,
  type TenderDocumentJob,
} from "../src/tender-processor.js";

describe("tender storage cleanup", () => {
  it("treats missing tender objects as idempotent cleanup success", async () => {
    const storage = {
      send: vi
        .fn()
        .mockRejectedValueOnce({
          $metadata: { httpStatusCode: 404 },
          name: "NoSuchKey",
        })
        .mockResolvedValueOnce(undefined),
    };
    const processor = new TenderProcessor(
      {} as never,
      storage as never,
      "private-test",
      { scan: vi.fn() } as never,
    );
    const job: TenderDocumentCleanupJob = {
      documentId: "document-a",
      keys: ["approved/object-key", "quarantine/object-key"],
      organisationId: "organisation-a",
      requestId: "request-a",
      tenderId: "tender-a",
    };

    await expect(
      processor.cleanupRemovedDocument(job),
    ).resolves.toBeUndefined();
    expect(storage.send).toHaveBeenCalledTimes(2);
    expect(storage.send).toHaveBeenNthCalledWith(
      1,
      expect.any(DeleteObjectCommand),
    );
  });
});

describe("tender worker authority guard", () => {
  it("returns a progression trigger only for the current ready tender version", async () => {
    const content = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n");
    const sha256 = createHash("sha256").update(content).digest("hex");
    const storage = {
      send: vi
        .fn()
        .mockResolvedValueOnce({
          Body: { transformToByteArray: vi.fn().mockResolvedValue(content) },
          ContentLength: content.byteLength,
        })
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined),
    };
    const database = {
      $transaction: vi.fn().mockResolvedValue(undefined),
      processingJob: {
        findFirst: vi.fn().mockResolvedValue({ id: "job-a", state: "QUEUED" }),
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({
            cancellationRequestedAt: null,
            state: "SCANNING",
          })
          .mockResolvedValueOnce({
            cancellationRequestedAt: null,
            state: "PROCESSING",
          }),
        update: vi.fn().mockResolvedValue(undefined),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      tender: { update: vi.fn().mockResolvedValue(undefined) },
      tenderDocument: {
        findFirst: vi.fn().mockResolvedValue({
          declaredMimeType: "application/pdf",
          extension: ".pdf",
          id: "document-a",
          quarantineObjectKey: "quarantine/object-key",
          sha256,
          sizeBytes: BigInt(content.byteLength),
          tenderVersion: {
            tender: { currentVersionId: "version-current" },
            tenderId: "tender-a",
          },
          uploadedByUserId: "user-a",
        }),
        findUnique: vi.fn().mockResolvedValue({
          deletedAt: null,
          status: "SCANNING",
          tenderVersion: {
            tender: { currentVersionId: "version-current" },
            tenderId: "tender-a",
          },
          tenderVersionId: "version-current",
        }),
        update: vi.fn().mockResolvedValue(undefined),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      tenderWorkspace: { update: vi.fn().mockResolvedValue(undefined) },
    };
    const processor = new TenderProcessor(
      database as never,
      storage as never,
      "private-test",
      { scan: vi.fn().mockResolvedValue({ status: "CLEAN" }) } as never,
    );

    await expect(
      processor.process({
        documentId: "document-a",
        jobId: "job-a",
        organisationId: "organisation-a",
        requestId: "request-a",
      }),
    ).resolves.toEqual({
      organisationId: "organisation-a",
      requestId: "request-a",
      tenderId: "tender-a",
      triggerId: "version-current",
      triggerType: "SOURCE_READY",
      userId: "user-a",
    });
    expect(database.tender.update).toHaveBeenCalledWith({
      data: { lifecycleStatus: "SOURCE_READY" },
      where: { id: "tender-a" },
    });
    expect(database.tenderWorkspace.update).toHaveBeenCalledWith({
      data: {
        processingProgress: 100,
        sourceSectionStatus: "READY",
        status: "SOURCE_READY",
      },
      where: { tenderId: "tender-a" },
    });
  });

  it("does not restore tender lifecycle state when the processed version is no longer current", async () => {
    const content = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n");
    const sha256 = createHash("sha256").update(content).digest("hex");
    const storage = {
      send: vi
        .fn()
        .mockResolvedValueOnce({
          Body: { transformToByteArray: vi.fn().mockResolvedValue(content) },
          ContentLength: content.byteLength,
        })
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined),
    };
    const database = {
      $transaction: vi.fn().mockResolvedValue(undefined),
      processingJob: {
        findFirst: vi.fn().mockResolvedValue({ id: "job-a", state: "QUEUED" }),
        findUnique: vi.fn().mockResolvedValue({
          cancellationRequestedAt: null,
          state: "SCANNING",
        }),
        update: vi.fn().mockResolvedValue(undefined),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      tender: { update: vi.fn().mockResolvedValue(undefined) },
      tenderDocument: {
        findFirst: vi.fn().mockResolvedValue({
          declaredMimeType: "application/pdf",
          extension: ".pdf",
          id: "document-a",
          quarantineObjectKey: "quarantine/object-key",
          sha256,
          sizeBytes: BigInt(content.byteLength),
          tenderVersion: {
            tender: { currentVersionId: "version-old" },
            tenderId: "tender-a",
          },
        }),
        findUnique: vi.fn().mockResolvedValue({
          deletedAt: null,
          status: "SCANNING",
          tenderVersion: {
            tender: { currentVersionId: "version-current" },
            tenderId: "tender-a",
          },
          tenderVersionId: "version-old",
        }),
        update: vi.fn().mockResolvedValue(undefined),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      tenderWorkspace: { update: vi.fn().mockResolvedValue(undefined) },
    };
    const processor = new TenderProcessor(
      database as never,
      storage as never,
      "private-test",
      { scan: vi.fn().mockResolvedValue({ status: "CLEAN" }) } as never,
    );
    const job: TenderDocumentJob = {
      documentId: "document-a",
      jobId: "job-a",
      organisationId: "organisation-a",
      requestId: "request-a",
    };

    await expect(processor.process(job)).resolves.toBeNull();

    expect(database.tenderDocument.updateMany).toHaveBeenCalledWith({
      data: {
        approvedObjectKey: "tender-approved/organisation-a/document-a",
        detectedMimeType: "application/pdf",
        status: "READY",
      },
      where: {
        deletedAt: null,
        id: "document-a",
        status: { in: ["UPLOADED", "SCANNING"] },
      },
    });
    expect(database.tender.update).not.toHaveBeenCalled();
    expect(database.tenderWorkspace.update).not.toHaveBeenCalled();
  });
});
