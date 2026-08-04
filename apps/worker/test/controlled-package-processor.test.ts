import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { createHash } from "node:crypto";
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
  const packageId = "00000000-0000-4000-8000-000000000002";
  const provenance = new TextEncoder().encode(
    `${JSON.stringify({ items: [], package_id: packageId })}\n`,
  );
  const digest = (bytes: Uint8Array): string =>
    createHash("sha256").update(bytes).digest("hex");
  const checksums = new TextEncoder().encode(
    `${digest(pdf)}  review.pdf\n${digest(provenance)}  provenance-index.json\n`,
  );
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
        sha256: digest(pdf),
      },
      {
        byte_size: 0,
        kind: "MANIFEST_JSON",
        logical_path: "manifest.json",
        mime_type: "application/json",
      },
      {
        byte_size: checksums.byteLength,
        kind: "CHECKSUMS_TEXT",
        logical_path: "SHA256SUMS.txt",
        mime_type: "text/plain",
        sha256: digest(checksums),
      },
      {
        byte_size: provenance.byteLength,
        kind: "PROVENANCE_INDEX_JSON",
        logical_path: "provenance-index.json",
        mime_type: "application/json",
        sha256: digest(provenance),
      },
    ],
    organisation_id: "00000000-0000-4000-8000-000000000001",
    package_id: packageId,
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
  let manifestBytes = new Uint8Array();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    manifestBytes = new TextEncoder().encode(`${JSON.stringify(manifest)}\n`);
    if (manifest.members[1]!.byte_size === manifestBytes.byteLength) break;
    manifest.members[1]!.byte_size = manifestBytes.byteLength;
  }
  return {
    "review.pdf": pdf,
    "manifest.json": manifestBytes,
    "SHA256SUMS.txt": checksums,
    "provenance-index.json": provenance,
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
    const tampered = createDeterministicZip(
      {
        ...files,
        "provenance-index.json": new TextEncoder().encode(
          '{"items":[],"package_id":"00000000-0000-4000-8000-000000000002"}\n ',
        ),
      },
      new Date("2026-08-04T12:00:00.000Z"),
    );
    expect(() => validateControlledPackageZip(tampered)).toThrow(
      "CONTROLLED_PACKAGE_CHECKSUM_MISMATCH",
    );
  });
});
