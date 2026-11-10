import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import { DocumentProcessor } from "../src/document-processor.js";

const job = {
  documentVersionId: "version-a",
  keys: ["quarantine/org-a/version-a"],
  organisationId: "org-a",
  requestId: "request-a",
};

describe("company upload cleanup", () => {
  it.each([null, { id: "version-a" }])(
    "deletes only when the version is absent (%s)",
    async (retained) => {
      const database = {
        documentVersion: { findUnique: vi.fn().mockResolvedValue(retained) },
      };
      const storage = { send: vi.fn().mockResolvedValue({}) };
      const processor = new DocumentProcessor(
        database as never,
        storage as never,
        "private-test",
        {} as never,
      );
      await processor.cleanupUploadObjects(job);
      expect(database.documentVersion.findUnique).toHaveBeenCalledWith({
        select: { id: true },
        where: { id: "version-a" },
      });
      if (retained === null)
        expect(storage.send).toHaveBeenCalledWith(
          expect.any(DeleteObjectCommand),
        );
      else expect(storage.send).not.toHaveBeenCalled();
    },
  );

  it("rejects a cleanup key outside the exact upload version", async () => {
    const storage = { send: vi.fn() };
    const processor = new DocumentProcessor(
      {} as never,
      storage as never,
      "private-test",
      {} as never,
    );
    await expect(
      processor.cleanupUploadObjects({
        ...job,
        keys: ["quarantine/org-b/version-a"],
      }),
    ).rejects.toThrow("COMPANY_UPLOAD_CLEANUP_KEY_MISMATCH");
    expect(storage.send).not.toHaveBeenCalled();
  });
});
