import { describe, expect, it } from "vitest";
import { createTenderSchema, createTenderUploadSchema } from "./tenders.js";

describe("tender ingestion contracts", () => {
  it("rejects invalid chronology", () => {
    expect(
      createTenderSchema.safeParse({
        buyer: "Buyer",
        publication_date: "2026-08-02",
        submission_deadline: "2026-08-01T12:00:00+05:30",
        title: "Tender",
      }).success,
    ).toBe(false);
  });

  it.each(["../tender.pdf", "/tmp/tender.pdf", "a\\tender.pdf"])(
    "rejects unsafe filename %s",
    (filename) => {
      expect(
        createTenderUploadSchema.safeParse({
          checksum_sha256: "a".repeat(64),
          filename,
          mime_type: "application/pdf",
          role: "PRIMARY",
          size_bytes: 100,
        }).success,
      ).toBe(false);
    },
  );

  it("rejects oversized files and executable MIME types", () => {
    expect(
      createTenderUploadSchema.safeParse({
        checksum_sha256: "a".repeat(64),
        filename: "tender.exe",
        mime_type: "application/octet-stream",
        role: "PRIMARY",
        size_bytes: 26 * 1024 * 1024,
      }).success,
    ).toBe(false);
  });
});
