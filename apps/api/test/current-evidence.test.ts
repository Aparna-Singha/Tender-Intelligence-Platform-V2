import { describe, expect, it } from "vitest";
import {
  currentEvidenceFor,
  type CurrentEvidenceLink,
  type CurrentEvidenceVerdict,
} from "../src/eligibility/current-evidence.js";

const checkedAt = new Date("2026-11-07T18:29:59.999Z");
const link: CurrentEvidenceLink = {
  linkType: "DIRECT_SUPPORT",
  evidenceCitation: {
    documentChecksum: "checksum",
    documentId: "document",
    documentVersionId: "version",
    evidenceFactVersionId: "fact-version",
    invalidatedAt: null,
    organisationId: "org",
    validationStatus: "VALID",
  },
  evidenceFactVersion: {
    id: "fact-version",
    documentVersionId: "version",
    reviewState: "ACCEPTED",
    validUntil: null,
    evidenceFact: {
      organisationId: "org",
      currentVersionId: "fact-version",
      documentId: "document",
      invalidatedAt: null,
      document: {
        organisationId: "org",
        tenderScopeId: null,
        currentVersionId: "version",
        currentVersion: { sha256: "checksum" },
        deletedAt: null,
        expiryDate: new Date("2026-11-07T00:00:00Z"),
        status: "READY",
      },
    },
  },
};
function verdict(
  overrides: Record<string, unknown> = {},
  links: readonly CurrentEvidenceLink[] = [link],
): CurrentEvidenceVerdict | null {
  return currentEvidenceFor({
    assessmentInvalidatedAt: null,
    checkedAt,
    currentState: "VERIFIED",
    links,
    organisationId: "org",
    reviewState: "FINALISED",
    runInvalidatedAt: null,
    runStatus: "COMPLETE",
    tenderCitationStatus: "VALID",
    tenderId: "tender",
    ...overrides,
  });
}
describe("read-time evidence verdict", () => {
  it("recognises current exact accepted support", () => {
    expect(verdict()).toEqual({
      status: "CURRENT",
      checkedAt: checkedAt.toISOString(),
      reasonCodes: [],
    });
  });
  it("expires exactly at the next Asia/Kolkata midnight", () => {
    expect(
      verdict({ checkedAt: new Date("2026-11-07T18:30:00Z") })?.reasonCodes,
    ).toContain("DOCUMENT_EXPIRED");
  });
  it("does not produce a verdict for unverified rows", () => {
    expect(verdict({ currentState: "MISSING" })).toBeNull();
  });
  it("fails closed on invalidated runs and absent direct support", () => {
    expect(verdict({ runInvalidatedAt: checkedAt }, [])?.reasonCodes).toEqual([
      "DIRECT_SUPPORT_MISSING",
      "RUN_INVALIDATED",
    ]);
  });
  it("rejects invalid citations and cross-tenant sources", () => {
    expect(
      verdict({}, [
        {
          ...link,
          evidenceCitation: {
            ...link.evidenceCitation!,
            validationStatus: "INVALID",
          },
        },
      ])?.reasonCodes,
    ).toContain("CITATION_INVALID");
    expect(
      verdict({}, [
        {
          ...link,
          evidenceFactVersion: {
            ...link.evidenceFactVersion!,
            evidenceFact: {
              ...link.evidenceFactVersion!.evidenceFact,
              organisationId: "other",
            },
          },
        },
      ])?.reasonCodes,
    ).toContain("SOURCE_MISSING");
  });
});
