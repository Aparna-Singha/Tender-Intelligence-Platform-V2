import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { TendersService } from "../src/tenders/tenders.service.js";

const environment = {
  DOCUMENT_DOWNLOAD_TTL_SECONDS: 60,
  DOCUMENT_UPLOAD_TTL_SECONDS: 300,
  S3_BUCKET: "private-test",
} as never;

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
      service.get("organisation-b", "tender-a"),
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
});
