import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  ControlledPackageRendererError,
  renderControlledPackagePdf,
  type ControlledPackageRenderInput,
} from "../src/controlled-package-renderer.js";

const fixture: ControlledPackageRenderInput = {
  canonicalRenderTimestamp: "2026-08-04T12:00:00.000Z",
  checklist: [
    {
      provenanceHandles: ["CHECKLIST:1"],
      text: "Confirm authorised pricing.",
      title: "Pricing review",
    },
  ],
  draftSections: [
    { heading: "Tender response", text: "Exact approved content — café." },
  ],
  finalReadinessFindings: [
    {
      provenanceHandles: ["READINESS:1"],
      text: "Human review remains required.",
      title: "Review finding",
    },
  ],
  finalRiskFindings: [
    {
      provenanceHandles: ["RISK:1"],
      text: "Accepted risk remains visible.",
      title: "Risk finding",
    },
  ],
  packageId: "00000000-0000-4000-8000-000000000001",
  packageTitle: "Controlled package",
  policyVersion: "controlled-review-package-deterministic-v1",
  provenanceHandles: ["DOC:1", "DRAFT:1"],
  rendererCompatibilityVersion:
    "controlled-review-package-renderer-compatibility-v1",
  tenderIdentifiers: ["TENDER-001"],
  warnings: [
    {
      provenanceHandles: ["DOC:1"],
      text: "Validate before any external action.",
      title: "Warning",
    },
  ],
};

describe("controlled package renderer", () => {
  it("renders byte-identically with fixed passive metadata", async () => {
    const first = await renderControlledPackagePdf(fixture);
    process.env.TZ = "Pacific/Auckland";
    process.env.UNRELATED_RENDER_SETTING = "changed";
    const second = await renderControlledPackagePdf(fixture);
    expect(first.bytes).toEqual(second.bytes);
    expect(first.sha256).toBe(
      createHash("sha256").update(first.bytes).digest("hex"),
    );
    const pdf = await PDFDocument.load(first.bytes);
    expect(pdf.getPageCount()).toBe(first.pageCount);
    expect(pdf.getTitle()).toBe("Controlled review package");
    expect(pdf.getCreationDate()?.toISOString()).toBe(
      fixture.canonicalRenderTimestamp,
    );
    expect(Buffer.from(first.bytes).toString("latin1")).not.toMatch(
      /\/JavaScript|\/JS\b|\/Launch|\/AcroForm|\/EmbeddedFiles|\/Filespec|\/URI\b/,
    );
  });

  it("fails closed for unsupported text and compatibility", async () => {
    await expect(
      renderControlledPackagePdf({ ...fixture, packageTitle: "निविदा" }),
    ).rejects.toMatchObject({ code: "RENDERER_UNSUPPORTED_TEXT" });
    await expect(
      renderControlledPackagePdf({
        ...fixture,
        rendererCompatibilityVersion:
          "wrong" as typeof fixture.rendererCompatibilityVersion,
      }),
    ).rejects.toEqual(
      new ControlledPackageRendererError("RENDERER_COMPATIBILITY_MISMATCH"),
    );
  });

  it("rejects missing approved content and bounded rows", async () => {
    await expect(
      renderControlledPackagePdf({ ...fixture, draftSections: [] }),
    ).rejects.toMatchObject({ code: "RENDERER_INPUT_INVALID" });
    await expect(
      renderControlledPackagePdf({
        ...fixture,
        provenanceHandles: Array.from(
          { length: 5_001 },
          (_, index) => `DOC:${index}`,
        ),
      }),
    ).rejects.toMatchObject({ code: "RENDERER_INPUT_INVALID" });
  });
});
