vi.mock("file-type", () => ({
  fileTypeFromBuffer: vi.fn().mockResolvedValue({ mime: "image/png" }),
}));

import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { DocumentProcessor } from "../src/document-processor.js";

describe("company scan version ordering", () => {
  it("keeps a newer clean V2 current when an older V1 scan finishes afterward", async () => {
    const content = Uint8Array.from([1, 2, 3, 4]);
    const version = {
      id: "version-1",
      documentId: "document-a",
      versionNumber: 1,
      approvedObjectKey: null,
      quarantineObjectKey: "quarantine/version-1",
      sha256: createHash("sha256").update(content).digest("hex"),
      sizeBytes: 4n,
      declaredMimeType: "image/png",
      extension: ".png",
      uploadedByUserId: "user-a",
      document: { organisationId: "org-a" },
    };
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: "document-a" }]),
      documentVersion: { update: vi.fn().mockResolvedValue(undefined) },
      documentExtraction: { upsert: vi.fn().mockResolvedValue(undefined) },
      document: {
        findUniqueOrThrow: vi
          .fn()
          .mockResolvedValue({ currentVersion: { versionNumber: 2 } }),
        update: vi.fn().mockResolvedValue(undefined),
      },
      companyEvidenceFact: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const database = {
      documentVersion: { findFirst: vi.fn().mockResolvedValue(version) },
      document: {
        findUnique: vi.fn().mockResolvedValue({ currentVersion: null }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: vi.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    };
    const storage = {
      send: vi
        .fn()
        .mockResolvedValueOnce({
          Body: { transformToByteArray: vi.fn().mockResolvedValue(content) },
          ContentLength: 4,
        })
        .mockResolvedValue(undefined),
    };
    const processor = new DocumentProcessor(
      database as never,
      storage as never,
      "private",
      { scan: vi.fn().mockResolvedValue({ status: "CLEAN" }) } as never,
    );
    (
      processor as unknown as { invalidateAssessments: () => Promise<void> }
    ).invalidateAssessments = vi.fn().mockResolvedValue(undefined);
    await processor.process("process-company-document", {
      documentVersionId: "version-1",
      organisationId: "org-a",
      requestId: "request",
    });
    expect(transaction.$queryRaw).toHaveBeenCalledOnce();
    expect(transaction.documentVersion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          approvedObjectKey: "approved/org-a/version-1",
        }),
      }),
    );
    expect(transaction.document.update).not.toHaveBeenCalled();
    expect(database.document.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { currentVersionId: null },
            { currentVersion: { versionNumber: { lte: 1 } } },
          ],
        }),
      }),
    );
  });

  it("does not mark a newer ready version failed for an older scan job", async () => {
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      document: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          currentVersion: { versionNumber: 2 },
          status: "SCANNING",
        }),
        update: vi.fn(),
      },
    };
    const database = {
      documentVersion: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ documentId: "document-a", versionNumber: 1 }),
      },
      $transaction: vi.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    };
    const processor = new DocumentProcessor(
      database as never,
      {} as never,
      "private",
      {} as never,
    );
    await processor.markFailed("version-1");
    expect(transaction.document.update).not.toHaveBeenCalled();
  });
});
