import { NotFoundException } from "@nestjs/common";
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
