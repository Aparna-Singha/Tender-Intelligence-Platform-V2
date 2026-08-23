import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { DocumentsService } from "../src/documents/documents.service.js";

const environment = {
  DOCUMENT_DOWNLOAD_TTL_SECONDS: 60,
  DOCUMENT_UPLOAD_TTL_SECONDS: 300,
  S3_BUCKET: "private-test",
} as never;

describe("document vault authorisation", () => {
  it("does not sign a cross-tenant download", async () => {
    const database = {
      document: { findFirst: vi.fn().mockResolvedValue(null) },
      documentAccessEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const storage = { send: vi.fn() };
    const service = new DocumentsService(
      database as never,
      storage as never,
      {} as never,
      environment,
    );
    await expect(
      service.download("organisation-b", "document-a", "user-a", "request-a"),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(database.document.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "document-a",
          organisationId: "organisation-b",
        }),
      }),
    );
    expect(storage.send).not.toHaveBeenCalled();
  });

  it.each(["QUARANTINED", "SCANNING", "REJECTED"])(
    "does not sign a %s file",
    async (status) => {
      const database = {
        document: {
          findFirst: vi.fn().mockResolvedValue({
            currentVersion: { approvedObjectKey: null },
            id: "document-a",
            status,
          }),
        },
        documentAccessEvent: { create: vi.fn().mockResolvedValue({}) },
      };
      const storage = { send: vi.fn() };
      const service = new DocumentsService(
        database as never,
        storage as never,
        {} as never,
        environment,
      );
      await expect(
        service.download("organisation-a", "document-a", "user-a", "request-a"),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.send).not.toHaveBeenCalled();
    },
  );
});

describe("document upload abandonment", () => {
  it("removes only an incomplete upload session within the current organisation", async () => {
    const jobs = { add: vi.fn().mockResolvedValue(undefined) };
    const storage = { send: vi.fn().mockResolvedValue(undefined) };
    const database = {
      $transaction: vi.fn(
        async (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
      documentVersion: {
        count: vi.fn().mockResolvedValue(1),
      },
      uploadSession: {
        findFirst: vi.fn().mockResolvedValue({
          completedAt: null,
          documentVersion: {
            document: {
              currentVersionId: null,
              id: "document-a",
            },
            documentId: "document-a",
            documentVersionId: "version-a",
            quarantineObjectKey: "quarantine/document-a",
          },
          documentVersionId: "version-a",
          id: "session-a",
          status: "PENDING",
        }),
      },
    };
    const transaction = {
      auditEvent: { create: vi.fn().mockResolvedValue(undefined) },
      document: {
        delete: vi.fn().mockResolvedValue(undefined),
      },
      documentVersion: {
        delete: vi.fn().mockResolvedValue(undefined),
      },
      uploadSession: {
        delete: vi.fn().mockResolvedValue(undefined),
      },
    };
    const service = new DocumentsService(
      database as never,
      storage as never,
      jobs as never,
      environment,
    );

    await expect(
      service.abandonUploadSession(
        "organisation-a",
        "session-a",
        "user-a",
        "request-a",
      ),
    ).resolves.toEqual({ removed: true });

    expect(database.uploadSession.findFirst).toHaveBeenCalledWith({
      include: {
        documentVersion: {
          include: {
            document: {
              select: {
                currentVersionId: true,
                id: true,
              },
            },
          },
        },
      },
      where: { id: "session-a", organisationId: "organisation-a" },
    });
    expect(transaction.uploadSession.delete).toHaveBeenCalledWith({
      where: { id: "session-a" },
    });
    expect(transaction.documentVersion.delete).toHaveBeenCalledWith({
      where: { id: "version-a" },
    });
    expect(transaction.document.delete).toHaveBeenCalledWith({
      where: { id: "document-a" },
    });
    expect(transaction.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "user-a",
        eventType: "DOCUMENT_UPLOAD_ABANDONED",
        organisationId: "organisation-a",
        outcome: "SUCCESS",
        requestId: "request-a",
        subjectId: "document-a",
        subjectType: "document",
      }),
    });
    expect(storage.send).toHaveBeenCalledWith(expect.any(DeleteObjectCommand));
    expect(jobs.add).not.toHaveBeenCalled();
  });

  it("queues bounded storage cleanup retries when immediate company-upload cleanup fails", async () => {
    const jobs = { add: vi.fn().mockResolvedValue(undefined) };
    const storage = {
      send: vi.fn().mockRejectedValueOnce(new Error("temporary MinIO outage")),
    };
    const database = {
      $transaction: vi.fn(
        async (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
      documentVersion: {
        count: vi.fn().mockResolvedValue(1),
      },
      uploadSession: {
        findFirst: vi.fn().mockResolvedValue({
          completedAt: null,
          documentVersion: {
            document: {
              currentVersionId: null,
              id: "document-a",
            },
            documentId: "document-a",
            documentVersionId: "version-a",
            quarantineObjectKey: "quarantine/document-a",
          },
          documentVersionId: "version-a",
          id: "session-a",
          status: "PENDING",
        }),
      },
    };
    const transaction = {
      auditEvent: { create: vi.fn().mockResolvedValue(undefined) },
      document: {
        delete: vi.fn().mockResolvedValue(undefined),
      },
      documentVersion: {
        delete: vi.fn().mockResolvedValue(undefined),
      },
      uploadSession: {
        delete: vi.fn().mockResolvedValue(undefined),
      },
    };
    const service = new DocumentsService(
      database as never,
      storage as never,
      jobs as never,
      environment,
    );

    await expect(
      service.abandonUploadSession(
        "organisation-a",
        "session-a",
        "user-a",
        "request-a",
      ),
    ).resolves.toEqual({ removed: true });

    expect(jobs.add).toHaveBeenCalledWith(
      "cleanup-company-upload-storage",
      {
        documentVersionId: "version-a",
        keys: ["quarantine/document-a"],
        organisationId: "organisation-a",
        requestId: "request-a",
      },
      expect.objectContaining({
        attempts: 10,
        jobId: "cleanup-company-upload-version-a",
      }),
    );
  });

  it("refuses to abandon a completed upload session", async () => {
    const database = {
      uploadSession: {
        findFirst: vi.fn().mockResolvedValue({
          completedAt: new Date("2026-08-22T09:15:00.000Z"),
          id: "session-a",
          status: "COMPLETED",
        }),
      },
    };
    const service = new DocumentsService(
      database as never,
      {} as never,
      {} as never,
      environment,
    );

    await expect(
      service.abandonUploadSession(
        "organisation-a",
        "session-a",
        "user-a",
        "request-a",
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
