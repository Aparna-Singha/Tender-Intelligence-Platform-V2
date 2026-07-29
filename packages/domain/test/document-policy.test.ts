import { describe, expect, it } from "vitest";
import {
  canDownloadDocument,
  extensionFor,
  isAllowedMimeExtension,
} from "../src/document-policy.js";

describe("document policy", () => {
  it("requires MIME and extension to agree", () => {
    expect(isAllowedMimeExtension("application/pdf", ".pdf")).toBe(true);
    expect(isAllowedMimeExtension("application/pdf", ".png")).toBe(false);
  });

  it("normalises the final extension", () => {
    expect(extensionFor("certificate.PDF")).toBe(".pdf");
  });

  it("allows downloads only for ready files", () => {
    expect(canDownloadDocument("READY")).toBe(true);
    expect(canDownloadDocument("QUARANTINED")).toBe(false);
  });
});
