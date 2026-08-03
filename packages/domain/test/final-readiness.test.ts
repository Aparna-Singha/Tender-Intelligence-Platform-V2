import { describe, expect, it } from "vitest";

import {
  classifyEvidenceExpiry,
  classifyFinalReadinessFinding,
  consolidatedDraftQualificationDenials,
  evaluateFinalReadinessPrerequisites,
  FINAL_READINESS_EXPIRY_POLICY_VERSION,
  FINAL_READINESS_POLICY_VERSION,
  FINAL_READINESS_REQUIRED_DRAFT_POLICY_VERSION,
  FINAL_READINESS_REQUIRED_DRAFT_TYPE,
  finalReadinessDispositionDenials,
  hasPermission,
  normaliseFinalReadinessFingerprintInput,
  type ConsolidatedDraftQualificationInput,
  type FinalReadinessDispositionInput,
  type FinalReadinessFindingCondition,
  type FinalReadinessFingerprintInput,
  type FinalReadinessPrerequisiteInput,
  type OrganisationRole,
} from "../src/index.js";

describe("final readiness vocabulary", () => {
  it("locks deterministic v1 policy identifiers without provider vocabulary", () => {
    expect(FINAL_READINESS_POLICY_VERSION).toBe(
      "final-readiness-deterministic-v1",
    );
    expect(FINAL_READINESS_EXPIRY_POLICY_VERSION).toBe(
      "evidence-expiry-30-calendar-days-v1",
    );
    expect(FINAL_READINESS_REQUIRED_DRAFT_POLICY_VERSION).toBe(
      "required-consolidated-first-draft-v1",
    );
    expect(FINAL_READINESS_REQUIRED_DRAFT_TYPE).toBe(
      "CONSOLIDATED_FIRST_DRAFT",
    );
    expect(
      JSON.stringify({
        FINAL_READINESS_EXPIRY_POLICY_VERSION,
        FINAL_READINESS_POLICY_VERSION,
        FINAL_READINESS_REQUIRED_DRAFT_POLICY_VERSION,
      }),
    ).not.toMatch(/provider|model|prompt|rag/i);
  });
});

describe("final readiness hard prerequisites", () => {
  it("accepts an exact current Phase 5–10 authority chain", () => {
    expect(evaluateFinalReadinessPrerequisites(validPrerequisites())).toEqual(
      [],
    );
  });

  it("returns an explainable denial for every missing prerequisite", () => {
    const cases = [
      "tender",
      "tenderVersion",
      "sourceSet",
      "extraction",
      "earlyRisk",
      "continueDecision",
      "eligibilityAssessment",
      "evidenceSnapshot",
      "checklistGeneration",
      "consolidatedDraft",
    ] as const;
    for (const key of cases) {
      const input = validPrerequisites();
      input[key] = { ...input[key], exists: false } as never;
      expect(evaluateFinalReadinessPrerequisites(input), key).toContainEqual({
        code: "PREREQUISITE_MISSING",
        prerequisite: prerequisiteName(key),
      });
    }
  });

  it("denies stale, invalidated and cross-scope authority", () => {
    const input = validPrerequisites();
    input.extraction = {
      ...input.extraction,
      current: false,
      invalidated: true,
      organisationId: "org-b",
      tenderId: "tender-b",
      tenderVersionId: "version-b",
    };
    expect(evaluateFinalReadinessPrerequisites(input)).toEqual(
      expect.arrayContaining([
        {
          code: "PREREQUISITE_NOT_CURRENT",
          prerequisite: "EXTRACTION",
        },
        {
          code: "PREREQUISITE_INVALIDATED",
          prerequisite: "EXTRACTION",
        },
        {
          code: "ORGANISATION_SCOPE_MISMATCH",
          prerequisite: "EXTRACTION",
        },
        { code: "TENDER_SCOPE_MISMATCH", prerequisite: "EXTRACTION" },
        {
          code: "TENDER_VERSION_SCOPE_MISMATCH",
          prerequisite: "EXTRACTION",
        },
      ]),
    );
  });

  it("validates source, run, decision, snapshot and draft authority", () => {
    const input = validPrerequisites();
    input.sourceSet = { ...input.sourceSet, snapshottable: false };
    input.earlyRisk = {
      ...input.earlyRisk,
      complete: false,
      gate: "FINAL_READINESS",
    };
    input.continueDecision = {
      ...input.continueDecision,
      decision: "HOLD",
      earlyRiskRunMatches: false,
      superseded: true,
    };
    input.eligibilityAssessment = {
      ...input.eligibilityAssessment,
      complete: false,
    };
    input.evidenceSnapshot = {
      ...input.evidenceSnapshot,
      exactForEligibilityRun: false,
    };
    input.checklistGeneration = {
      ...input.checklistGeneration,
      complete: false,
      eligibilityRunMatches: false,
    };
    input.consolidatedDraft = {
      ...input.consolidatedDraft,
      count: 2,
      qualified: false,
    };
    expect(
      evaluateFinalReadinessPrerequisites(input).map(({ code }) => code),
    ).toEqual(
      expect.arrayContaining([
        "SOURCE_SET_NOT_SNAPSHOTTABLE",
        "EARLY_RISK_NOT_COMPLETE",
        "CONTINUE_DECISION_NOT_CURRENT",
        "ELIGIBILITY_ASSESSMENT_NOT_COMPLETE",
        "EVIDENCE_SNAPSHOT_NOT_EXACT",
        "CHECKLIST_GENERATION_NOT_COMPLETE",
        "CONSOLIDATED_DRAFT_COUNT_INVALID",
        "CONSOLIDATED_DRAFT_NOT_QUALIFIED",
      ]),
    );
  });

  it("keeps unresolved audit findings out of the hard start gate", () => {
    const auditInputs: readonly FinalReadinessFindingCondition[] = [
      "MANDATORY_ELIGIBILITY_MISSING",
      "MANDATORY_ELIGIBILITY_CONFLICT",
      "MANDATORY_ELIGIBILITY_LIKELY_MET",
      "MATERIAL_EXTRACTION_AMBIGUITY",
      "ACCEPTED_MATERIAL_RISK",
      "UNRESOLVED_BLOCKING_CHECKLIST_ITEM",
      "CHECKLIST_ITEM_READY_FOR_REASSESSMENT",
      "EXPIRED_MANDATORY_EVIDENCE",
      "EVIDENCE_EXPIRING_WITHIN_30_DAYS",
    ];
    expect(evaluateFinalReadinessPrerequisites(validPrerequisites())).toEqual(
      [],
    );
    expect(
      auditInputs.map((condition) => classifyFinalReadinessFinding(condition)),
    ).toHaveLength(auditInputs.length);
  });
});

describe("consolidated draft qualification", () => {
  it("qualifies one current independently approved consolidated draft", () => {
    expect(
      consolidatedDraftQualificationDenials(validConsolidatedDraft()),
    ).toEqual([]);
  });

  it("reports every controlled draft denial", () => {
    expect(
      consolidatedDraftQualificationDenials({
        ...validConsolidatedDraft(),
        approved: false,
        approverRoleAtApproval: "ADMIN",
        approverUserId: "creator",
        conflictingMaterialClaims: 1,
        draftType: "TECHNICAL_RESPONSE",
        expiredMaterialClaims: 1,
        invalidated: true,
        isCurrentVersion: false,
        materialClaimsRequiringHumanReview: 1,
        sourceFingerprintCurrent: false,
        superseded: true,
        unresolvedApprovalBlockingPlaceholders: 1,
        unsupportedMaterialClaims: 1,
        unreviewedMaterialCommitments: 1,
        unvalidatedHumanEditedSections: 1,
      }),
    ).toEqual([
      "REQUIRED_DRAFT_TYPE_MISMATCH",
      "CURRENT_VERSION_REQUIRED",
      "APPROVED_VERSION_REQUIRED",
      "NON_INVALIDATED_VERSION_REQUIRED",
      "NON_SUPERSEDED_VERSION_REQUIRED",
      "CURRENT_SOURCE_FINGERPRINT_REQUIRED",
      "INDEPENDENT_APPROVER_REQUIRED",
      "REQUIRED_REVIEWER_ROLE_NOT_SATISFIED",
      "UNRESOLVED_APPROVAL_BLOCKING_PLACEHOLDER",
      "UNSUPPORTED_MATERIAL_CLAIM",
      "CONFLICTING_MATERIAL_CLAIM",
      "EXPIRED_MATERIAL_CLAIM",
      "MATERIAL_CLAIM_REQUIRES_HUMAN_REVIEW",
      "UNVALIDATED_HUMAN_EDITED_SECTION",
      "UNREVIEWED_MATERIAL_COMMITMENT",
    ]);
  });

  it("rejects historical approval without role-at-approval evidence", () => {
    expect(
      consolidatedDraftQualificationDenials({
        ...validConsolidatedDraft(),
        approverRoleAtApproval: null,
      }),
    ).toContain("APPROVER_ROLE_EVIDENCE_REQUIRED");
  });
});

describe("evidence expiry policy", () => {
  const evaluatedAt = new Date("2026-08-03T23:30:00Z");

  it.each([
    ["2026-08-02T23:59:59Z", "BLOCKER", "EVIDENCE_EXPIRED"],
    ["2026-08-03T00:00:00Z", "WARNING", "EVIDENCE_EXPIRING_WITHIN_30_DAYS"],
    ["2026-09-02T23:59:59Z", "WARNING", "EVIDENCE_EXPIRING_WITHIN_30_DAYS"],
    ["2026-09-03T00:00:00Z", "INFORMATIONAL", "EVIDENCE_EXPIRY_INFORMATIONAL"],
  ] as const)(
    "classifies UTC calendar boundary %s",
    (expiry, treatment, policyRuleId) => {
      expect(
        classifyEvidenceExpiry({
          evaluatedAt,
          expiryDate: new Date(expiry),
          relevant: true,
        }),
      ).toEqual({ policyRuleId, treatment });
    },
  );

  it("does not invent absent or irrelevant later expiry findings", () => {
    expect(
      classifyEvidenceExpiry({
        evaluatedAt,
        expiryDate: null,
        relevant: true,
      }),
    ).toBeUndefined();
    expect(
      classifyEvidenceExpiry({
        evaluatedAt,
        expiryDate: new Date("2027-01-01T00:00:00Z"),
        relevant: false,
      }),
    ).toBeUndefined();
  });

  it("uses the same UTC calendar day for equivalent offset timestamps", () => {
    const utc = classifyEvidenceExpiry({
      evaluatedAt: new Date("2026-08-03T18:30:00Z"),
      expiryDate: new Date("2026-08-03T00:00:00Z"),
      relevant: true,
    });
    const offset = classifyEvidenceExpiry({
      evaluatedAt: new Date("2026-08-04T00:00:00+05:30"),
      expiryDate: new Date("2026-08-03T05:30:00+05:30"),
      relevant: true,
    });
    expect(offset).toEqual(utc);
  });
});

describe("readiness finding treatment", () => {
  it.each([
    ["INVALID_MATERIAL_CITATION", "BLOCKER"],
    ["MANDATORY_ELIGIBILITY_MISSING", "BLOCKER"],
    ["MANDATORY_ELIGIBILITY_CONFLICT", "BLOCKER"],
    ["CHECKLIST_ITEM_READY_FOR_REASSESSMENT", "BLOCKER"],
    ["MANDATORY_ELIGIBILITY_LIKELY_MET", "HUMAN_DISPOSITION_REQUIRED"],
    ["MATERIAL_EXTRACTION_AMBIGUITY", "HUMAN_DISPOSITION_REQUIRED"],
    ["ACCEPTED_MATERIAL_RISK", "HUMAN_DISPOSITION_REQUIRED"],
    ["EVIDENCE_EXPIRING_WITHIN_30_DAYS", "WARNING"],
    ["UNRESOLVED_NON_BLOCKING_CHECKLIST_ITEM", "WARNING"],
    ["SUPPORTED_APPROACHING_DEADLINE", "WARNING"],
    ["NON_AFFILIATION_NOTICE", "INFORMATIONAL"],
    ["NO_COMPLETE_RISK_GUARANTEE", "INFORMATIONAL"],
    ["HISTORICAL_RESOLVED_CONTEXT", "INFORMATIONAL"],
    ["PRODUCT_LIMITATION", "INFORMATIONAL"],
  ] as const)(
    "classifies %s independently from risk severity",
    (condition, treatment) => {
      expect(classifyFinalReadinessFinding(condition)).toEqual({
        policyRuleId: condition,
        treatment,
      });
    },
  );
});

describe("final readiness disposition", () => {
  it.each(["REVIEWER", "OWNER", "ADMIN"] as const)(
    "allows an independent %s to proceed when all controls pass",
    (role) => {
      expect(
        finalReadinessDispositionDenials({
          ...validDisposition(role),
          disposition: "PROCEED_TO_CONTROLLED_EXPORT_REVIEW",
        }),
      ).toEqual([]);
    },
  );

  it.each(["CONSULTANT", "TENDER_EXECUTIVE"] as const)(
    "denies %s without final disposition permission",
    (role) => {
      expect(
        finalReadinessDispositionDenials(validDisposition(role)),
      ).toContain("FINAL_READINESS_DECISION_PERMISSION_REQUIRED");
    },
  );

  it("denies Platform Administrator without tenant membership", () => {
    expect(
      finalReadinessDispositionDenials({
        ...validDisposition("REVIEWER"),
        actorHasDecisionPermission: false,
      }),
    ).toContain("FINAL_READINESS_DECISION_PERMISSION_REQUIRED");
  });

  it("enforces requester and draft-creator separation", () => {
    expect(
      finalReadinessDispositionDenials({
        ...validDisposition("REVIEWER"),
        actorUserId: "requester",
        consolidatedDraftCreatorUserId: "requester",
      }),
    ).toEqual(
      expect.arrayContaining([
        "REQUESTER_CANNOT_DECIDE",
        "CONSOLIDATED_DRAFT_CREATOR_CANNOT_DECIDE",
      ]),
    );
  });

  it("blocks proceed on blockers, required dispositions, acknowledgements or provenance", () => {
    expect(
      finalReadinessDispositionDenials({
        ...validDisposition("REVIEWER"),
        materialFindingProvenanceValid: false,
        requiredAcknowledgementsRecorded: false,
        unresolvedBlockers: 1,
        unresolvedHumanDispositions: 1,
      }),
    ).toEqual(
      expect.arrayContaining([
        "UNRESOLVED_BLOCKERS",
        "UNRESOLVED_HUMAN_DISPOSITIONS",
        "REQUIRED_ACKNOWLEDGEMENTS_MISSING",
        "MATERIAL_FINDING_PROVENANCE_INVALID",
      ]),
    );
  });

  it.each(["HOLD_FOR_REMEDIATION", "STOP_PURSUIT"] as const)(
    "allows %s with blockers and mandatory rationale",
    (disposition) => {
      expect(
        finalReadinessDispositionDenials({
          ...validDisposition("REVIEWER"),
          disposition,
          materialFindingProvenanceValid: false,
          requiredAcknowledgementsRecorded: false,
          unresolvedBlockers: 3,
          unresolvedHumanDispositions: 2,
        }),
      ).toEqual([]);
    },
  );

  it("denies missing rationale, stale fingerprints and invalidated runs", () => {
    expect(
      finalReadinessDispositionDenials({
        ...validDisposition("REVIEWER"),
        fingerprintMatches: false,
        invalidated: true,
        rationale: "",
      }),
    ).toEqual(
      expect.arrayContaining([
        "READINESS_RUN_INVALIDATED",
        "INPUT_FINGERPRINT_STALE",
        "DECISION_RATIONALE_REQUIRED",
      ]),
    );
  });
});

describe("final readiness fingerprint normalization", () => {
  it("normalizes relation order without adding sensitive bodies", () => {
    const first = fingerprintInput();
    const second: FinalReadinessFingerprintInput = {
      ...first,
      documents: [...first.documents].reverse(),
      policyVersions: [...first.policyVersions].reverse(),
    };
    const normalized = normaliseFinalReadinessFingerprintInput(first);
    expect(normalized).toEqual(normaliseFinalReadinessFingerprintInput(second));
    expect(JSON.stringify(normalized)).not.toMatch(
      /sourceBody|draftText|evidenceText|prompt|secret/i,
    );
  });
});

function validPrerequisites(): FinalReadinessPrerequisiteInput {
  const scoped = {
    current: true,
    exists: true,
    invalidated: false,
    organisationId: "org-a",
    tenderId: "tender-a",
    tenderVersionId: "version-a",
  } as const;
  return {
    checklistGeneration: {
      ...scoped,
      complete: true,
      eligibilityRunMatches: true,
      evidenceSnapshotMatches: true,
    },
    consolidatedDraft: { ...scoped, count: 1, qualified: true },
    continueDecision: {
      ...scoped,
      decision: "CONTINUE",
      earlyRiskRunMatches: true,
      superseded: false,
    },
    earlyRisk: { ...scoped, complete: true, gate: "EARLY" },
    eligibilityAssessment: { ...scoped, complete: true },
    evidenceSnapshot: { ...scoped, exactForEligibilityRun: true },
    extraction: { ...scoped, complete: true },
    organisationId: "org-a",
    sourceSet: { ...scoped, snapshottable: true },
    tender: scoped,
    tenderId: "tender-a",
    tenderVersion: scoped,
    tenderVersionId: "version-a",
  };
}

function prerequisiteName(
  key: Exclude<
    keyof FinalReadinessPrerequisiteInput,
    "organisationId" | "tenderId" | "tenderVersionId"
  >,
): string {
  const names = {
    checklistGeneration: "CHECKLIST_GENERATION",
    consolidatedDraft: "CONSOLIDATED_DRAFT",
    continueDecision: "CONTINUE_DECISION",
    earlyRisk: "EARLY_RISK",
    eligibilityAssessment: "ELIGIBILITY_ASSESSMENT",
    evidenceSnapshot: "EVIDENCE_SNAPSHOT",
    extraction: "EXTRACTION",
    sourceSet: "SOURCE_SET",
    tender: "TENDER",
    tenderVersion: "TENDER_VERSION",
  } as const;
  return names[key];
}

function validConsolidatedDraft(): ConsolidatedDraftQualificationInput {
  return {
    approved: true,
    approverRoleAtApproval: "REVIEWER",
    approverUserId: "reviewer",
    conflictingMaterialClaims: 0,
    creatorUserId: "creator",
    draftType: "CONSOLIDATED_FIRST_DRAFT",
    expiredMaterialClaims: 0,
    invalidated: false,
    isCurrentVersion: true,
    materialClaimsRequiringHumanReview: 0,
    requiredReviewerRole: "REVIEWER",
    sourceFingerprintCurrent: true,
    superseded: false,
    unresolvedApprovalBlockingPlaceholders: 0,
    unsupportedMaterialClaims: 0,
    unreviewedMaterialCommitments: 0,
    unvalidatedHumanEditedSections: 0,
  };
}

function validDisposition(
  role: OrganisationRole,
): FinalReadinessDispositionInput {
  return {
    actorHasDecisionPermission: hasPermission(
      role,
      "TENDER_FINAL_READINESS_DISPOSITION_CREATE",
    ),
    actorUserId: "decision-maker",
    consolidatedDraftCreatorUserId: "draft-creator",
    disposition: "PROCEED_TO_CONTROLLED_EXPORT_REVIEW",
    finalRiskRunComplete: true,
    finalRiskRunCurrent: true,
    fingerprintMatches: true,
    invalidated: false,
    materialFindingProvenanceValid: true,
    rationale: "Reviewed every material finding and limitation.",
    readinessRunComplete: true,
    readinessRunCurrent: true,
    requesterUserId: "requester",
    requiredAcknowledgementsRecorded: true,
    unresolvedBlockers: 0,
    unresolvedHumanDispositions: 0,
  };
}

function fingerprintInput(): FinalReadinessFingerprintInput {
  return {
    checklistFingerprint: "checklist-fingerprint",
    checklistRunId: "checklist-run",
    consolidatedDraftFingerprint: "draft-fingerprint",
    consolidatedDraftId: "draft",
    consolidatedDraftVersionId: "draft-version",
    documents: [
      { checksum: "bbb", id: "document-b", role: "ANNEXURE" },
      { checksum: "aaa", id: "document-a", role: "PRIMARY" },
    ],
    earlyRiskFingerprint: "early-risk-fingerprint",
    earlyRiskRunId: "early-risk-run",
    eligibilityRunId: "eligibility-run",
    evidenceSnapshotFingerprint: "evidence-fingerprint",
    evidenceSnapshotId: "evidence-snapshot",
    extractionFingerprint: "extraction-fingerprint",
    extractionRunId: "extraction-run",
    organisationId: "org-a",
    policyVersions: [
      FINAL_READINESS_REQUIRED_DRAFT_POLICY_VERSION,
      FINAL_READINESS_POLICY_VERSION,
      FINAL_READINESS_EXPIRY_POLICY_VERSION,
    ],
    pursuitDecisionId: "decision",
    tenderId: "tender-a",
    tenderVersionFingerprint: "tender-fingerprint",
    tenderVersionId: "version-a",
  };
}
