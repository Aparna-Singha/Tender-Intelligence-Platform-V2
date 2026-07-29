import { describe, expect, it } from "vitest";
import { createUploadSessionSchema } from "./documents.js";

const valid = {
  category: "PAN",
  checksum_sha256: "a".repeat(64),
  filename: "pan-card.pdf",
  mime_type: "application/pdf",
  size_bytes: 1024,
};

describe("document upload contract", () => {
  it.each(["../secret.pdf", "folder/secret.pdf", "folder\\secret.pdf"])(
    "rejects unsafe filename %s",
    (filename) => {
      expect(
        createUploadSessionSchema.safeParse({ ...valid, filename }).success,
      ).toBe(false);
    },
  );

  it("rejects oversized files", () => {
    expect(
      createUploadSessionSchema.safeParse({
        ...valid,
        size_bytes: 25 * 1024 * 1024 + 1,
      }).success,
    ).toBe(false);
  });
});
