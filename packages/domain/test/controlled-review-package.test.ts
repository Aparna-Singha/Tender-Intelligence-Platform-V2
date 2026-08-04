import { describe, expect, it } from "vitest";

import {
  canonicalControlledPackageInput,
  canCancelControlledPackage,
  canRegenerateControlledPackage,
  canRetryControlledPackage,
  canReviewControlledPackage,
  canTransitionControlledPackageGeneration,
  canTransitionControlledPackageReview,
  controlledPackageApprovalDenials,
  controlledPackageFreshnessEffect,
  controlledPackageIdempotencyResult,
  controlledPackageLimitViolations,
  evaluateControlledPackagePrerequisites,
  hasPermission,
  isControlledPackageCurrentPointerEligible,
  isControlledPackageDownloadEligible,
  type OrganisationRole,
  type Permission,
} from "../src/index.js";

describe("controlled review-package policy", () => {
  it("enforces the complete role-permission matrix", () => {
    const phase12Permissions = [
      "TENDER_CONTROLLED_PACKAGE_PREFLIGHT",
      "TENDER_CONTROLLED_PACKAGE_READ",
      "TENDER_CONTROLLED_PACKAGE_MANIFEST_READ",
      "TENDER_CONTROLLED_PACKAGE_START",
      "TENDER_CONTROLLED_PACKAGE_CANCEL",
      "TENDER_CONTROLLED_PACKAGE_RETRY",
      "TENDER_CONTROLLED_PACKAGE_REVIEW",
      "TENDER_CONTROLLED_PACKAGE_APPROVE",
      "TENDER_CONTROLLED_PACKAGE_DOWNLOAD",
      "TENDER_CONTROLLED_PACKAGE_REVOKE",
      "TENDER_CONTROLLED_PACKAGE_AUDIT_READ",
    ] as const satisfies readonly Permission[];
    const expected: Readonly<Record<OrganisationRole, readonly Permission[]>> =
      {
        OWNER: phase12Permissions,
        ADMIN: phase12Permissions,
        TENDER_EXECUTIVE: phase12Permissions.filter((permission) =>
          [
            "TENDER_CONTROLLED_PACKAGE_PREFLIGHT",
            "TENDER_CONTROLLED_PACKAGE_READ",
            "TENDER_CONTROLLED_PACKAGE_MANIFEST_READ",
            "TENDER_CONTROLLED_PACKAGE_START",
            "TENDER_CONTROLLED_PACKAGE_CANCEL",
            "TENDER_CONTROLLED_PACKAGE_RETRY",
            "TENDER_CONTROLLED_PACKAGE_DOWNLOAD",
            "TENDER_CONTROLLED_PACKAGE_AUDIT_READ",
          ].includes(permission),
        ),
        CONSULTANT: phase12Permissions.filter((permission) =>
          [
            "TENDER_CONTROLLED_PACKAGE_PREFLIGHT",
            "TENDER_CONTROLLED_PACKAGE_READ",
            "TENDER_CONTROLLED_PACKAGE_MANIFEST_READ",
            "TENDER_CONTROLLED_PACKAGE_START",
            "TENDER_CONTROLLED_PACKAGE_CANCEL",
            "TENDER_CONTROLLED_PACKAGE_RETRY",
            "TENDER_CONTROLLED_PACKAGE_AUDIT_READ",
          ].includes(permission),
        ),
        REVIEWER: phase12Permissions.filter((permission) =>
          [
            "TENDER_CONTROLLED_PACKAGE_PREFLIGHT",
            "TENDER_CONTROLLED_PACKAGE_READ",
            "TENDER_CONTROLLED_PACKAGE_MANIFEST_READ",
            "TENDER_CONTROLLED_PACKAGE_REVIEW",
            "TENDER_CONTROLLED_PACKAGE_APPROVE",
            "TENDER_CONTROLLED_PACKAGE_DOWNLOAD",
            "TENDER_CONTROLLED_PACKAGE_AUDIT_READ",
          ].includes(permission),
        ),
      };
    for (const role of Object.keys(expected) as OrganisationRole[])
      for (const permission of phase12Permissions)
        expect(hasPermission(role, permission), `${role}:${permission}`).toBe(
          expected[role].includes(permission),
        );
  });

  it("allows only locked generation and review transitions", () => {
    expect(
      canTransitionControlledPackageGeneration("QUEUED", "PROCESSING"),
    ).toBe(true);
    expect(
      canTransitionControlledPackageGeneration("PROCESSING", "GENERATED"),
    ).toBe(true);
    expect(
      canTransitionControlledPackageGeneration("GENERATED", "PROCESSING"),
    ).toBe(false);
    expect(
      canTransitionControlledPackageReview("NOT_REVIEWED", "IN_REVIEW"),
    ).toBe(true);
    expect(canTransitionControlledPackageReview("IN_REVIEW", "APPROVED")).toBe(
      true,
    );
    expect(canTransitionControlledPackageReview("REJECTED", "APPROVED")).toBe(
      false,
    );
    expect(canCancelControlledPackage("QUEUED")).toBe(true);
    expect(canCancelControlledPackage("GENERATED")).toBe(false);
    expect(canRetryControlledPackage("FAILED")).toBe(true);
    expect(canRetryControlledPackage("GENERATED")).toBe(false);
    expect(canRegenerateControlledPackage("GENERATED", "REJECTED")).toBe(true);
  });

  it("keeps review, current authority and download fail closed", () => {
    expect(
      canReviewControlledPackage("GENERATED", "CURRENT", "NOT_REVIEWED"),
    ).toBe(true);
    expect(
      canReviewControlledPackage("GENERATED", "STALE", "NOT_REVIEWED"),
    ).toBe(false);
    expect(
      isControlledPackageCurrentPointerEligible({
        generationStatus: "GENERATED",
        reviewStatus: "APPROVED",
        freshness: "CURRENT",
      }),
    ).toBe(true);
    for (const reviewStatus of ["REJECTED", "REVOKED", "SUPERSEDED"] as const)
      expect(
        isControlledPackageDownloadEligible({
          generationStatus: "GENERATED",
          reviewStatus,
          freshness: "CURRENT",
          artifactAvailable: true,
          checksumVerified: true,
          malwareCleared: true,
        }),
      ).toBe(false);
  });

  it("separates hard prerequisites from warnings and later blockers", () => {
    const result = evaluateControlledPackagePrerequisites({
      readinessRunCurrent: true,
      readinessRunComplete: true,
      readinessRunInvalidated: false,
      finalRiskRunCurrent: true,
      finalRiskRunComplete: true,
      proceedDecisionCurrent: true,
      proceedDecisionUnsuperseded: true,
      inputFingerprintCurrent: true,
      approvedDraftPinned: true,
      exportTemplateApproved: true,
      sourceHashesAvailable: true,
      activeRunExists: false,
      facts: [
        {
          code: "NEGATIVE_TENDER_FACT",
          satisfied: false,
          treatment: "PACKAGE_WARNING",
        },
        {
          code: "REVIEW_NEEDED",
          satisfied: false,
          treatment: "REVIEW_BLOCKER",
        },
        {
          code: "APPROVAL_NEEDED",
          satisfied: false,
          treatment: "DOWNLOAD_BLOCKER",
        },
      ],
    });
    expect(result.hardGenerationBlockers).toEqual([]);
    expect(result.packageWarnings).toEqual(["NEGATIVE_TENDER_FACT"]);
    expect(result.reviewBlockers).toEqual(["REVIEW_NEEDED"]);
    expect(result.downloadBlockers).toEqual(["APPROVAL_NEEDED"]);
  });

  it("requires active role evidence and independent approval", () => {
    expect(
      controlledPackageApprovalDenials({
        actorUserId: "requester",
        actorRoleAtAction: "TENDER_EXECUTIVE",
        activeMembership: true,
        requesterUserId: "requester",
        draftCreatorUserId: "creator",
        packageReviewable: true,
        reviewVersionCurrent: true,
        fingerprintCurrent: true,
      }),
    ).toEqual(["APPROVAL_PERMISSION_REQUIRED", "REQUESTER_CANNOT_APPROVE"]);
    expect(
      controlledPackageApprovalDenials({
        actorUserId: "reviewer",
        actorRoleAtAction: "REVIEWER",
        activeMembership: true,
        requesterUserId: "requester",
        draftCreatorUserId: "creator",
        packageReviewable: true,
        reviewVersionCurrent: true,
        fingerprintCurrent: true,
      }),
    ).toEqual([]);
  });

  it("maps authoritative changes to invalidation and stale effects", () => {
    expect(
      controlledPackageFreshnessEffect({
        changedComponents: ["FINAL_READINESS_DECISION"],
        generationStatus: "PROCESSING",
      }),
    ).toEqual({
      blockStart: true,
      invalidateRun: true,
      markStale: false,
      approvalEffective: false,
      downloadGrantAllowed: false,
    });
    expect(
      controlledPackageFreshnessEffect({
        changedComponents: ["EXPORT_TEMPLATE_VERSION"],
        generationStatus: "GENERATED",
      }).markStale,
    ).toBe(true);
  });

  it("distinguishes idempotent replay from changed input", () => {
    expect(
      controlledPackageIdempotencyResult({
        existingInputFingerprint: null,
        requestedInputFingerprint: "a",
      }),
    ).toBe("CREATE");
    expect(
      controlledPackageIdempotencyResult({
        existingInputFingerprint: "a",
        requestedInputFingerprint: "a",
      }),
    ).toBe("REPLAY_EQUIVALENT");
    expect(
      controlledPackageIdempotencyResult({
        existingInputFingerprint: "a",
        requestedInputFingerprint: "b",
      }),
    ).toBe("CONFLICT_CHANGED_INPUT");
  });

  it("canonicalizes authority deterministically and enforces locked limits", () => {
    expect(canonicalControlledPackageInput({ b: 2, a: { d: 4, c: 3 } })).toBe(
      canonicalControlledPackageInput({ a: { c: 3, d: 4 }, b: 2 }),
    );
    expect(
      controlledPackageLimitViolations({
        zipBytes: 100 * 1024 * 1024,
        memberBytes: [1, 1, 1, 50 * 1024 * 1024],
        pdfPages: 2_000,
        documentCount: 200,
        provenanceReferenceCount: 5_000,
        summaryRowCount: 2_000,
        draftSectionCount: 40,
        filenames: [
          "review.pdf",
          "manifest.json",
          "SHA256SUMS.txt",
          "provenance-index.json",
        ],
        containsNestedArchive: false,
      }),
    ).toEqual([]);
    expect(
      controlledPackageLimitViolations({
        zipBytes: 100 * 1024 * 1024 + 1,
        memberBytes: [1],
        pdfPages: 2_001,
        documentCount: 201,
        provenanceReferenceCount: 5_001,
        summaryRowCount: 2_001,
        draftSectionCount: 41,
        filenames: ["../unsafe.zip"],
        containsNestedArchive: true,
      }),
    ).toEqual(
      expect.arrayContaining([
        "ZIP_SIZE_LIMIT_EXCEEDED",
        "MEMBER_COUNT_INVALID",
        "PDF_PAGE_LIMIT_EXCEEDED",
        "DOCUMENT_LIMIT_EXCEEDED",
        "PROVENANCE_LIMIT_EXCEEDED",
        "SUMMARY_ROW_LIMIT_EXCEEDED",
        "DRAFT_SECTION_LIMIT_EXCEEDED",
        "FILENAME_UNSAFE",
        "NESTED_ARCHIVE_PROHIBITED",
      ]),
    );
  });
});
