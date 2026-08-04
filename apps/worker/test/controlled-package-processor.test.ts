import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  createDeterministicZip,
  isControlledPackageJob,
  validateControlledPackageZip,
} from "../src/controlled-package-processor.js";

async function members(): Promise<
  Record<
    "review.pdf" | "manifest.json" | "SHA256SUMS.txt" | "provenance-index.json",
    Uint8Array
  >
> {
  const document = await PDFDocument.create();
  const page = document.addPage();
  page.drawText("Review", {
    font: await document.embedFont(StandardFonts.Helvetica),
  });
  const pdf = await document.save({ useObjectStreams: false });
  const hash = "a".repeat(64);
  const manifest = {
    generated_at: "2026-08-04T12:00:00.000Z",
    generation_policy_version: "controlled-review-package-deterministic-v1",
    logical_content_fingerprint: hash,
    members: [
      {
        byte_size: pdf.byteLength,
        kind: "REVIEW_PDF",
        logical_path: "review.pdf",
        mime_type: "application/pdf",
        sha256: hash,
      },
      {
        byte_size: 0,
        kind: "MANIFEST_JSON",
        logical_path: "manifest.json",
        mime_type: "application/json",
      },
      {
        byte_size: 1,
        kind: "CHECKSUMS_TEXT",
        logical_path: "SHA256SUMS.txt",
        mime_type: "text/plain",
        sha256: hash,
      },
      {
        byte_size: 1,
        kind: "PROVENANCE_INDEX_JSON",
        logical_path: "provenance-index.json",
        mime_type: "application/json",
        sha256: hash,
      },
    ],
    organisation_id: "00000000-0000-4000-8000-000000000001",
    package_id: "00000000-0000-4000-8000-000000000002",
    phase_11_decision_id: "00000000-0000-4000-8000-000000000003",
    phase_11_readiness_run_id: "00000000-0000-4000-8000-000000000004",
    renderer_compatibility_version:
      "controlled-review-package-renderer-compatibility-v1",
    schema_version: "controlled-review-package-embedded-manifest-v1",
    template_version_id: "00000000-0000-4000-8000-000000000005",
    tender_id: "00000000-0000-4000-8000-000000000006",
    tender_version_id: "00000000-0000-4000-8000-000000000007",
    warnings: [],
  };
  return {
    "review.pdf": pdf,
    "manifest.json": new TextEncoder().encode(`${JSON.stringify(manifest)}\n`),
    "SHA256SUMS.txt": new TextEncoder().encode("checksums\n"),
    "provenance-index.json": new TextEncoder().encode(
      `${JSON.stringify({ items: [], package_id: manifest.package_id })}\n`,
    ),
  };
}

describe("controlled package worker primitives", () => {
  it("accepts only the opaque queue payload", () => {
    expect(
      isControlledPackageJob({
        controlledReviewPackageRunId: "run",
        organisationId: "org",
        requestId: "request",
      }),
    ).toBe(true);
    expect(
      isControlledPackageJob({
        controlledReviewPackageRunId: "run",
        organisationId: "org",
        requestId: "request",
        objectKey: "private",
      }),
    ).toBe(false);
  });

  it("creates byte-identical four-member archives", async () => {
    const files = await members();
    const timestamp = new Date("2026-08-04T12:00:00.000Z");
    const first = createDeterministicZip(files, timestamp);
    const second = createDeterministicZip(files, timestamp);
    expect(first).toEqual(second);
    validateControlledPackageZip(first);
    expect(Object.keys(unzipSync(first))).toEqual([
      "review.pdf",
      "manifest.json",
      "SHA256SUMS.txt",
      "provenance-index.json",
    ]);
  });

  it("rejects traversal and incomplete archives", async () => {
    const files = await members();
    const invalid = createDeterministicZip(
      { ...files, "review.pdf": new Uint8Array() },
      new Date("2026-08-04T12:00:00.000Z"),
    );
    expect(() => validateControlledPackageZip(invalid)).toThrow();
  });
});
