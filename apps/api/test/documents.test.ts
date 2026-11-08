const { getSignedUrlMock } = vi.hoisted(() => ({
  getSignedUrlMock: vi
    .fn()
    .mockResolvedValue(
      "https://signed.example/upload?X-Amz-SignedHeaders=host%3Bx-amz-meta-sha256",
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
  NotFoundException,
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { DocumentsService } from "../src/documents/documents.service.js";

const environment = {
  DOCUMENT_DOWNLOAD_TTL_SECONDS: 60,
  DOCUMENT_UPLOAD_TTL_SECONDS: 300,
  S3_BUCKET: "private-test",
} as never;

describe("company document direct upload", () => {
  const checksum = "a".repeat(64);
  const input = {
    category: "GST",
    checksum_sha256: checksum,
    filename: "company.pdf",
    mime_type: "application/pdf",
    size_bytes: 100,
  } as const;

  it("recovers a committed upload after queue insertion failed without another version or transaction", async () => {
    const session = {
      id: "session-a",
      organisationId: "organisation-a",
      status: "COMPLETED",
      expiresAt: new Date(0),
      documentVersionId: "version-a",
      documentVersion: {
        id: "version-a",
        documentId: "document-a",
        versionNumber: 1,
        sha256: checksum,
        document: { status: "UPLOADED", tenderScopeId: null },
      },
    };
    const database = {
      uploadSession: { findFirst: vi.fn().mockResolvedValue(session) },
      documentVersion: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      $transaction: vi.fn(),
    };
    const jobs = {
      add: vi
        .fn()
        .mockRejectedValueOnce(new Error("queue unavailable"))
        .mockResolvedValue(undefined),
    };
    const storage = { send: vi.fn() };
    const service = new DocumentsService(
      database as never,
      storage as never,
      jobs as never,
      environment,
    );
    const complete = (): Promise<unknown> =>
      service.completeUpload(
        "organisation-a",
        "session-a",
        "user-a",
        { checksum_sha256: checksum },
        "request-a",
      );
    await expect(complete()).rejects.toThrow("queue unavailable");
    await expect(complete()).resolves.toEqual({
      document_id: "document-a",
      status: "UPLOADED",
    });
    expect(jobs.add).toHaveBeenCalledTimes(2);
    expect(jobs.add).toHaveBeenCalledWith(
      "process-company-document",
      expect.objectContaining({ documentVersionId: "version-a" }),
      expect.objectContaining({ jobId: "version-a" }),
    );
    expect(database.$transaction).not.toHaveBeenCalled();
    expect(storage.send).not.toHaveBeenCalled();
    expect(database.documentVersion.findFirst).toHaveBeenCalledWith({
      select: { id: true },
      where: {
        approvedObjectKey: { not: null },
        documentId: "document-a",
        versionNumber: { gt: 1 },
      },
    });
  });

  it("does not retry a superseded completed version", async () => {
    const database = {
      uploadSession: {
        findFirst: vi.fn().mockResolvedValue({
          id: "old-session",
          status: "COMPLETED",
          expiresAt: new Date(0),
          documentVersionId: "version-1",
          documentVersion: {
            id: "version-1",
            documentId: "document-a",
            versionNumber: 1,
            sha256: checksum,
            document: { status: "UPLOADED", tenderScopeId: null },
          },
        }),
      },
      documentVersion: {
        findFirst: vi.fn().mockResolvedValue({ id: "version-3" }),
      },
    };
    const jobs = { add: vi.fn() };
    const service = new DocumentsService(
      database as never,
      {} as never,
      jobs as never,
      environment,
    );
    await expect(
      service.completeUpload(
        "organisation-a",
        "old-session",
        "user-a",
        { checksum_sha256: checksum },
        "request-a",
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(jobs.add).not.toHaveBeenCalled();
  });

  it("queues a completed V2 even while the document still reports ready V1", async () => {
    const database = {
      uploadSession: {
        findFirst: vi.fn().mockResolvedValue({
          id: "session-2",
          status: "COMPLETED",
          expiresAt: new Date(0),
          documentVersionId: "version-2",
          documentVersion: {
            id: "version-2",
            documentId: "document-a",
            versionNumber: 2,
            approvedObjectKey: null,
            extraction: null,
            sha256: checksum,
            document: {
              status: "READY",
              tenderScopeId: null,
              currentVersionId: "version-1",
            },
          },
        }),
      },
      documentVersion: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const jobs = { add: vi.fn().mockResolvedValue(undefined) };
    const service = new DocumentsService(
      database as never,
      {} as never,
      jobs as never,
      environment,
    );
    await expect(
      service.completeUpload(
        "organisation-a",
        "session-2",
        "user-a",
        { checksum_sha256: checksum },
        "request-a",
      ),
    ).resolves.toEqual({ document_id: "document-a", status: "UPLOADED" });
    expect(jobs.add).toHaveBeenCalledWith(
      "process-company-document",
      expect.objectContaining({ documentVersionId: "version-2" }),
      expect.objectContaining({ jobId: "version-2" }),
    );
  });

  it("commits completion once, then retries the same scan job after an insertion failure", async () => {
    const version = {
      id: "version-a",
      documentId: "document-a",
      versionNumber: 1,
      sha256: checksum,
      sizeBytes: 100n,
      declaredMimeType: "application/pdf",
      quarantineObjectKey: "quarantine/a",
      document: { status: "UPLOADING", tenderScopeId: null },
    };
    const session = {
      id: "session-a",
      status: "PENDING",
      expiresAt: new Date(Date.now() + 60_000),
      documentVersionId: "version-a",
      documentVersion: version,
    };
    const database = {
      uploadSession: {
        findFirst: vi.fn().mockImplementation(() => Promise.resolve(session)),
        update: vi.fn(),
      },
      documentVersion: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      document: { update: vi.fn() },
      auditEvent: { create: vi.fn() },
      $transaction: vi.fn().mockResolvedValue([]),
    };
    const storage = {
      send: vi.fn().mockResolvedValue({
        ContentLength: 100,
        ContentType: "application/pdf",
        Metadata: { sha256: checksum },
      }),
    };
    const jobs = {
      add: vi
        .fn()
        .mockRejectedValueOnce(new Error("queue unavailable"))
        .mockResolvedValue(undefined),
    };
    const service = new DocumentsService(
      database as never,
      storage as never,
      jobs as never,
      environment,
    );
    await expect(
      service.completeUpload(
        "organisation-a",
        "session-a",
        "user-a",
        { checksum_sha256: checksum },
        "request-a",
      ),
    ).rejects.toThrow("queue unavailable");
    session.status = "COMPLETED";
    version.document.status = "UPLOADED";
    await expect(
      service.completeUpload(
        "organisation-a",
        "session-a",
        "user-a",
        { checksum_sha256: checksum },
        "request-a",
      ),
    ).resolves.toMatchObject({ document_id: "document-a" });
    expect(database.$transaction).toHaveBeenCalledTimes(1);
    expect(jobs.add).toHaveBeenCalledTimes(2);
    expect(
      jobs.add.mock.calls.map(
        (call: unknown[]) => (call[2] as { jobId: string }).jobId,
      ),
    ).toEqual(["version-a", "version-a"]);
  });

  it("recovers completed V1 after a V2 session is created but remains pending", async () => {
    const v1 = {
      id: "version-1",
      documentId: "document-a",
      versionNumber: 1,
      sha256: checksum,
      sizeBytes: 100n,
      declaredMimeType: "application/pdf",
      quarantineObjectKey: "quarantine/version-1",
      document: { status: "UPLOADING", tenderScopeId: null },
    };
    const session = {
      id: "session-1",
      status: "PENDING",
      expiresAt: new Date(Date.now() + 60_000),
      documentVersionId: "version-1",
      documentVersion: v1,
    };
    const transaction = {
      uploadSession: {
        updateMany: vi.fn().mockImplementation(() => {
          if (session.status !== "PENDING")
            return Promise.resolve({ count: 0 });
          session.status = "COMPLETED";
          return Promise.resolve({ count: 1 });
        }),
        create: vi.fn().mockResolvedValue({ id: "session-2" }),
      },
      document: {
        update: vi.fn().mockImplementation(() => {
          v1.document.status = "UPLOADED";
          return Promise.resolve(undefined);
        }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "document-a" }),
      },
      documentVersion: {
        count: vi.fn().mockResolvedValue(1),
        create: vi.fn().mockResolvedValue({ id: "version-2" }),
      },
      auditEvent: { create: vi.fn().mockResolvedValue(undefined) },
    };
    const database = {
      uploadSession: { findFirst: vi.fn().mockResolvedValue(session) },
      documentVersion: { findFirst: vi.fn().mockResolvedValue(null) },
      document: {
        count: vi.fn().mockResolvedValue(1),
        findFirst: vi.fn().mockResolvedValue({ id: "document-a" }),
      },
      $transaction: vi.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    };
    const storage = {
      send: vi.fn().mockResolvedValue({
        ContentLength: 100,
        ContentType: "application/pdf",
        Metadata: { sha256: checksum },
      }),
    };
    const jobs = {
      add: vi
        .fn()
        .mockRejectedValueOnce(new Error("queue unavailable"))
        .mockResolvedValue(undefined),
    };
    const service = new DocumentsService(
      database as never,
      storage as never,
      jobs as never,
      environment,
    );
    const completeV1 = (): Promise<unknown> =>
      service.completeUpload(
        "organisation-a",
        "session-1",
        "user-a",
        { checksum_sha256: checksum },
        "request-a",
      );
    await expect(completeV1()).rejects.toThrow("queue unavailable");
    const v2 = (await service.createUploadSession(
      "organisation-a",
      "user-a",
      {
        ...input,
        document_id: "document-a",
        checksum_sha256: "b".repeat(64),
      },
      "request-b",
    )) as { upload_session_id: string; version_id: string };
    expect(v2).toMatchObject({
      upload_session_id: "session-2",
      version_id: "version-2",
    });
    expect(session.status).toBe("COMPLETED");
    await expect(completeV1()).resolves.toEqual({
      document_id: "document-a",
      status: "UPLOADED",
    });
    expect(jobs.add).toHaveBeenCalledTimes(2);
    expect(
      jobs.add.mock.calls.map(
        (call: unknown[]) => (call[2] as { jobId: string }).jobId,
      ),
    ).toEqual(["version-1", "version-1"]);
    expect(transaction.uploadSession.updateMany).toHaveBeenCalledOnce();
  });

  it("atomically claims a general upload once under concurrent completion", async () => {
    let pending = true;
    const session = {
      id: "session-a",
      status: "PENDING",
      expiresAt: new Date(Date.now() + 60_000),
      documentVersionId: "version-a",
      documentVersion: {
        id: "version-a",
        documentId: "document-a",
        versionNumber: 1,
        sha256: checksum,
        sizeBytes: 100n,
        declaredMimeType: "application/pdf",
        quarantineObjectKey: "quarantine/a",
        document: { tenderScopeId: null },
      },
    };
    const transaction = {
      uploadSession: {
        updateMany: vi.fn().mockImplementation(() => {
          if (!pending) return Promise.resolve({ count: 0 });
          pending = false;
          return Promise.resolve({ count: 1 });
        }),
      },
      document: { update: vi.fn().mockResolvedValue(undefined) },
      auditEvent: { create: vi.fn().mockResolvedValue(undefined) },
    };
    const database = {
      uploadSession: { findFirst: vi.fn().mockResolvedValue(session) },
      documentVersion: { findFirst: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    };
    const storage = {
      send: vi.fn().mockResolvedValue({
        ContentLength: 100,
        ContentType: "application/pdf",
        Metadata: { sha256: checksum },
      }),
    };
    const jobs = { add: vi.fn().mockResolvedValue(undefined) };
    const service = new DocumentsService(
      database as never,
      storage as never,
      jobs as never,
      environment,
    );
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        service.completeUpload(
          "organisation-a",
          "session-a",
          "user-a",
          { checksum_sha256: checksum },
          "request-a",
        ),
      ),
    );
    expect(results.map((result) => result.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect(transaction.document.update).toHaveBeenCalledOnce();
    expect(transaction.auditEvent.create).toHaveBeenCalledOnce();
    expect(jobs.add).toHaveBeenCalledOnce();
    expect(jobs.add).toHaveBeenCalledWith(
      "process-company-document",
      expect.anything(),
      expect.objectContaining({ jobId: "version-a" }),
    );
  });

  it("requires the SHA-256 metadata as a signed upload header", async () => {
    const transaction = {
      auditEvent: { create: vi.fn().mockResolvedValue(undefined) },
      document: { create: vi.fn().mockResolvedValue({ id: "document-a" }) },
      documentVersion: {
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockResolvedValue({ id: "version-a" }),
      },
      uploadSession: { create: vi.fn().mockResolvedValue({ id: "session-a" }) },
    };
    const database = {
      $transaction: vi.fn(
        async (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
      document: { count: vi.fn().mockResolvedValue(0) },
      documentVersion: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const service = new DocumentsService(
      database as never,
      {} as never,
      {} as never,
      environment,
    );

    const result = (await service.createUploadSession(
      "organisation-a",
      "user-a",
      input,
      "request-a",
    )) as { upload_url: string };

    expect(
      new URL(result.upload_url).searchParams.get("X-Amz-SignedHeaders"),
    ).toContain("x-amz-meta-sha256");
    expect(
      new URL(result.upload_url).searchParams.has("x-amz-meta-sha256"),
    ).toBe(false);
    expect(getSignedUrlMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(PutObjectCommand),
      { expiresIn: 300, unhoistableHeaders: new Set(["x-amz-meta-sha256"]) },
    );
    expect(
      (getSignedUrlMock.mock.calls.at(-1)?.[1] as PutObjectCommand).input,
    ).toMatchObject({
      ContentLength: 100,
      ContentType: "application/pdf",
      Metadata: { sha256: checksum },
    });
  });

  it("creates no upload records when signing fails", async () => {
    getSignedUrlMock.mockRejectedValueOnce(new Error("signing unavailable"));
    const database = {
      document: { count: vi.fn().mockResolvedValue(0) },
      documentVersion: { findFirst: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(),
    };
    const service = new DocumentsService(
      database as never,
      {} as never,
      {} as never,
      environment,
    );
    await expect(
      service.createUploadSession(
        "organisation-a",
        "user-a",
        input,
        "request-a",
      ),
    ).rejects.toThrow("signing unavailable");
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["matching", { sha256: checksum }, true],
    ["missing", undefined, false],
    ["tampered", { sha256: "b".repeat(64) }, false],
  ])(
    "handles %s HeadObject SHA-256 metadata",
    async (_case, metadata, accepted) => {
      const session = {
        documentVersion: {
          declaredMimeType: "application/pdf",
          documentId: "document-a",
          id: "version-a",
          versionNumber: 1,
          quarantineObjectKey: "quarantine/organisation-a/version-a",
          sha256: checksum,
          sizeBytes: 100n,
        },
        expiresAt: new Date(Date.now() + 60_000),
        id: "session-a",
      };
      const database = {
        $transaction: vi.fn().mockResolvedValue([]),
        auditEvent: { create: vi.fn().mockResolvedValue(undefined) },
        document: { update: vi.fn().mockResolvedValue(undefined) },
        documentVersion: { findFirst: vi.fn().mockResolvedValue(null) },
        uploadSession: {
          findFirst: vi.fn().mockResolvedValue(session),
          update: vi.fn().mockResolvedValue(undefined),
        },
      };
      const storage = {
        send: vi.fn().mockResolvedValue({
          ContentLength: 100,
          ContentType: "application/pdf",
          Metadata: metadata,
        }),
      };
      const jobs = { add: vi.fn().mockResolvedValue(undefined) };
      const service = new DocumentsService(
        database as never,
        storage as never,
        jobs as never,
        environment,
      );
      const action = service.completeUpload(
        "organisation-a",
        "session-a",
        "user-a",
        { checksum_sha256: checksum },
        "request-a",
      );
      if (accepted) {
        await expect(action).resolves.toEqual({
          document_id: "document-a",
          status: "UPLOADED",
        });
        expect(jobs.add).toHaveBeenCalledOnce();
      } else {
        await expect(action).rejects.toBeInstanceOf(BadRequestException);
        expect(database.$transaction).not.toHaveBeenCalled();
        expect(jobs.add).not.toHaveBeenCalled();
      }
      expect(storage.send).toHaveBeenCalledWith(expect.any(HeadObjectCommand));
      expect(database.uploadSession.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: "session-a",
            organisationId: "organisation-a",
            status: { in: ["PENDING", "COMPLETED"] },
          },
        }),
      );
    },
  );
});

describe("document vault authorisation", () => {
  it("rejects an exact duplicate with a bounded public conflict", async () => {
    const database = {
      document: { count: vi.fn().mockResolvedValue(1) },
      documentVersion: {
        findFirst: vi.fn().mockResolvedValue({ id: "version-a" }),
      },
    };
    const service = new DocumentsService(
      database as never,
      {} as never,
      {} as never,
      environment,
    );

    await expect(
      service.createUploadSession(
        "organisation-a",
        "user-a",
        {
          category: "GST",
          checksum_sha256: "a".repeat(64),
          filename: "duplicate.pdf",
          mime_type: "application/pdf",
          size_bytes: 100,
        },
        "request-a",
      ),
    ).rejects.toMatchObject({
      publicCode: "DOCUMENT_DUPLICATE",
    });
  });

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
  it.each([
    ["pending", 60_000, "CANCELLED"],
    ["expired", -60_000, "EXPIRED"],
  ])(
    "retains a historically attached %s version",
    async (_label, offset, status) => {
      const tx = {
        uploadSession: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          delete: vi.fn(),
        },
        requirementEvidenceAttachment: { count: vi.fn().mockResolvedValue(1) },
        companyEvidenceFactVersion: { count: vi.fn().mockResolvedValue(0) },
        companyEvidenceCitation: { count: vi.fn().mockResolvedValue(0) },
        eligibilitySnapshotDocument: { count: vi.fn().mockResolvedValue(0) },
        documentVersion: { delete: vi.fn() },
        document: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          delete: vi.fn(),
        },
        auditEvent: { create: vi.fn() },
      };
      const database = {
        $transaction: vi.fn(
          (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
        ),
        uploadSession: {
          findFirst: vi.fn().mockResolvedValue({
            id: "session-a",
            status: "PENDING",
            completedAt: null,
            expiresAt: new Date(Date.now() + offset),
            documentVersionId: "version-a",
            documentVersion: {
              documentId: "document-a",
              quarantineObjectKey: "quarantine/org/version-a",
              document: { id: "document-a", currentVersionId: null },
            },
          }),
        },
      };
      const storage = { send: vi.fn() };
      const service = new DocumentsService(
        database as never,
        storage as never,
        { add: vi.fn() } as never,
        environment,
      );
      await expect(
        service.abandonUploadSession("org", "session-a", "user-a", "request-a"),
      ).resolves.toEqual({ removed: true });
      expect(tx.uploadSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status } }),
      );
      expect(tx.uploadSession.delete).not.toHaveBeenCalled();
      expect(tx.documentVersion.delete).not.toHaveBeenCalled();
      expect(tx.document.delete).not.toHaveBeenCalled();
      expect(tx.document.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: "FAILED" } }),
      );
      expect(storage.send).not.toHaveBeenCalled();
    },
  );
  it("does not delete a version when completion claims the session first", async () => {
    const transaction = {
      uploadSession: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        delete: vi.fn(),
      },
      documentVersion: { delete: vi.fn() },
      document: { delete: vi.fn() },
      auditEvent: { create: vi.fn() },
    };
    const database = {
      $transaction: vi.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
      documentVersion: { count: vi.fn().mockResolvedValue(1) },
      uploadSession: {
        findFirst: vi.fn().mockResolvedValue({
          completedAt: null,
          documentVersion: {
            document: { currentVersionId: null, id: "document-a" },
            documentId: "document-a",
            quarantineObjectKey: "quarantine/document-a",
          },
          documentVersionId: "version-a",
          id: "session-a",
          status: "PENDING",
        }),
      },
    };
    const storage = { send: vi.fn() };
    const service = new DocumentsService(
      database as never,
      storage as never,
      { add: vi.fn() } as never,
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
    expect(transaction.uploadSession.delete).not.toHaveBeenCalled();
    expect(transaction.documentVersion.delete).not.toHaveBeenCalled();
    expect(transaction.document.delete).not.toHaveBeenCalled();
    expect(storage.send).not.toHaveBeenCalled();
  });

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
        count: vi.fn().mockResolvedValue(1),
        delete: vi.fn().mockResolvedValue(undefined),
      },
      requirementEvidenceAttachment: { count: vi.fn().mockResolvedValue(0) },
      companyEvidenceFactVersion: { count: vi.fn().mockResolvedValue(0) },
      companyEvidenceCitation: { count: vi.fn().mockResolvedValue(0) },
      eligibilitySnapshotDocument: { count: vi.fn().mockResolvedValue(0) },
      uploadSession: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
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
                tenderScopeId: true,
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
    expect(transaction.uploadSession.updateMany).toHaveBeenCalledWith({
      data: { status: "CANCELLED" },
      where: { completedAt: null, id: "session-a", status: "PENDING" },
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
        count: vi.fn().mockResolvedValue(1),
        delete: vi.fn().mockResolvedValue(undefined),
      },
      requirementEvidenceAttachment: { count: vi.fn().mockResolvedValue(0) },
      companyEvidenceFactVersion: { count: vi.fn().mockResolvedValue(0) },
      companyEvidenceCitation: { count: vi.fn().mockResolvedValue(0) },
      eligibilitySnapshotDocument: { count: vi.fn().mockResolvedValue(0) },
      uploadSession: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
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
