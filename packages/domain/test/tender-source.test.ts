import { describe, expect, it } from "vitest";
import {
  AdminImportAdapter,
  CuratedDatasetAdapter,
  DEMONSTRATION_LABEL,
  ManualUploadAdapter,
  validateZipEntries,
} from "../src/tender-source.js";

const source = {
  provenance: "Supplied by authorised user",
  sourceName: "Manual",
};

describe("tender source adapters", () => {
  it("preserves manual and admin provenance", () => {
    expect(new ManualUploadAdapter().normalize(source).provenance).toBe(
      source.provenance,
    );
    expect(new AdminImportAdapter().normalize(source).importMethod).toBe(
      "CONTROLLED_ADMIN_IMPORT",
    );
  });

  it("always labels curated data as demonstration content", () => {
    expect(
      new CuratedDatasetAdapter().normalize(source).demonstrationLabel,
    ).toBe(DEMONSTRATION_LABEL);
  });
});

describe("ZIP policy", () => {
  it.each(["../secret.pdf", "/absolute.pdf", "nested/archive.zip"])(
    "rejects unsafe entry %s",
    (name) => {
      expect(() =>
        validateZipEntries([
          { compressedSize: 10, name, uncompressedSize: 20 },
        ]),
      ).toThrow();
    },
  );

  it("rejects compression bombs and excessive entries", () => {
    expect(() =>
      validateZipEntries([
        { compressedSize: 1, name: "safe.pdf", uncompressedSize: 1000 },
      ]),
    ).toThrow("ZIP_COMPRESSION_RATIO");
    expect(() =>
      validateZipEntries(
        Array.from({ length: 201 }, (_, index) => ({
          compressedSize: 10,
          name: `${index}.pdf`,
          uncompressedSize: 10,
        })),
      ),
    ).toThrow("ZIP_ENTRY_LIMIT");
  });
});
