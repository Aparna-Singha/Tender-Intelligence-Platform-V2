import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  FinalReadinessProcessingFailure,
  FinalReadinessProcessor,
  generateDeterministicReadinessFindings,
  isFinalReadinessJob,
  type DeterministicReadinessInput,
} from "../src/final-readiness-processor.js";

const job = {
  finalReadinessRunId: "run-a",
  kind: "FINAL_READINESS" as const,
  organisationId: "organisation-a",
  requestId: "request-a",
};

const source = readFileSync(
  new URL("../src/final-readiness-processor.ts", import.meta.url),
  "utf8",
);
const mainSource = readFileSync(
  new URL("../src/main.ts", import.meta.url),
  "utf8",
);

function input(
  changes: Partial<DeterministicReadinessInput> = {},
): DeterministicReadinessInput {
  return {
    approvalDraftVersionId: "draft-version-a",
    approvalValid: true,
    assessments: [],
    checklistItems: [],
    draftClaims: [],
    draftPlaceholders: [],
    evaluatedAt: new Date("2026-08-03T12:00:00.000Z"),
    evidence: [],
    extractionAmbiguities: [],
    invalidCitations: [],
    priorRisks: [],
    ...changes,
  };
}

function rules(value: DeterministicReadinessInput): string[] {
  return generateDeterministicReadinessFindings(value).map(
    ({ ruleCode }) => ruleCode,
  );
}

describe("final-readiness worker job validation", () => {
  it("accepts only the exact opaque payload", () => {
    expect(
      isFinalReadinessJob({
        finalReadinessRunId: "run-a",
        kind: "FINAL_READINESS",
        organisationId: "organisation-a",
        requestId: "request-a",
      }),
    ).toBe(true);
    expect(isFinalReadinessJob({ kind: "FINAL_READINESS" })).toBe(false);
    expect(
      isFinalReadinessJob({
        draftText: "private",
        finalReadinessRunId: "run-a",
        kind: "FINAL_READINESS",
        organisationId: "organisation-a",
        requestId: "request-a",
      }),
    ).toBe(false);
  });

  it("is registered with timeout and failed-event handling", () => {
    expect(mainSource).toContain('job.name === "run-final-readiness-audit"');
    expect(mainSource).toContain("isFinalReadinessJob(job.data)");
    expect(mainSource).toContain(
      "finalReadinessProcessor.process(data, signal)",
    );
    expect(mainSource).toContain(
      "finalReadinessProcessor.fail(job.data, error)",
    );
  });
});

describe("deterministic final-readiness rules", () => {
  it("classifies mandatory eligibility states without making them start prerequisites", () => {
    const findings = generateDeterministicReadinessFindings(
      input({
        assessments: [
          { id: "missing", mandatory: true, state: "MISSING" },
          { id: "conflict", mandatory: true, state: "CONFLICT" },
          { id: "likely", mandatory: true, state: "LIKELY_MET" },
        ],
      }),
    );
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleCode: "MANDATORY_ELIGIBILITY_MISSING",
          treatment: "BLOCKER",
        }),
        expect.objectContaining({
          ruleCode: "MANDATORY_ELIGIBILITY_CONFLICT",
          treatment: "BLOCKER",
        }),
        expect.objectContaining({
          ruleCode: "MANDATORY_ELIGIBILITY_LIKELY_MET",
          treatment: "HUMAN_DISPOSITION_REQUIRED",
        }),
      ]),
    );
  });

  it("uses one captured time and preserves the 30-calendar-day warning boundary", () => {
    const findings = generateDeterministicReadinessFindings(
      input({
        evidence: [
          {
            assessmentId: "expired",
            expiryDate: new Date("2026-08-02T23:59:59.000Z"),
            mandatory: true,
          },
          {
            assessmentId: "boundary",
            expiryDate: new Date("2026-09-02T00:00:00.000Z"),
            mandatory: true,
          },
        ],
      }),
    );
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleCode: "EXPIRED_MANDATORY_EVIDENCE",
          treatment: "BLOCKER",
        }),
        expect.objectContaining({
          ruleCode: "EVIDENCE_EXPIRING_WITHIN_30_DAYS",
          treatment: "WARNING",
        }),
      ]),
    );
  });

  it("classifies blocking, reassessment, and non-blocking checklist work", () => {
    const result = rules(
      input({
        checklistItems: [
          { id: "blocking", priority: "BLOCKING", status: "OPEN" },
          {
            id: "reassess",
            priority: "HIGH",
            status: "READY_FOR_REASSESSMENT",
          },
          { id: "open", priority: "MEDIUM", status: "IN_PROGRESS" },
        ],
      }),
    );
    expect(result).toEqual(
      expect.arrayContaining([
        "UNRESOLVED_BLOCKING_CHECKLIST_ITEM",
        "CHECKLIST_ITEM_READY_FOR_REASSESSMENT",
        "UNRESOLVED_NON_BLOCKING_CHECKLIST_ITEM",
      ]),
    );
  });

  it("blocks unsupported/conflicting claims, material placeholders, and unverifiable approval", () => {
    const result = rules(
      input({
        approvalValid: false,
        draftClaims: [
          { id: "unsupported", material: true, supportState: "UNSUPPORTED" },
          { id: "conflicting", material: true, supportState: "CONFLICTING" },
        ],
        draftPlaceholders: [
          { id: "placeholder", material: true, resolutionState: "OPEN" },
        ],
      }),
    );
    expect(result).toEqual(
      expect.arrayContaining([
        "UNSUPPORTED_MATERIAL_DRAFT_CLAIM",
        "CONFLICTING_MATERIAL_DRAFT_CLAIM",
        "UNRESOLVED_MATERIAL_PLACEHOLDER",
        "MISSING_INDEPENDENT_APPROVAL",
      ]),
    );
  });

  it("blocks invalid material citations with typed provenance", () => {
    const findings = generateDeterministicReadinessFindings(
      input({
        invalidCitations: [
          {
            provenance: {
              draftCitationId: "citation-a",
              kind: "DRAFT_CITATION",
            },
          },
        ],
      }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({
        provenance: {
          draftCitationId: "citation-a",
          kind: "DRAFT_CITATION",
        },
        ruleCode: "INVALID_MATERIAL_CITATION",
        treatment: "BLOCKER",
      }),
    );
  });

  it("blocks an expired material draft claim", () => {
    expect(
      rules(
        input({
          draftClaims: [
            {
              expiryDate: new Date("2026-08-02T00:00:00.000Z"),
              id: "expired-claim",
              material: true,
              supportState: "SUPPORTED",
            },
          ],
        }),
      ),
    ).toContain("EXPIRED_MATERIAL_DRAFT_CLAIM");
  });

  it("separates accepted material and non-material risk treatments", () => {
    const findings = generateDeterministicReadinessFindings(
      input({
        priorRisks: [
          { accepted: true, id: "material", material: true, open: false },
          { accepted: true, id: "minor", material: false, open: false },
          { accepted: false, id: "open", material: true, open: true },
        ],
      }),
    );
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleCode: "ACCEPTED_MATERIAL_RISK",
          treatment: "HUMAN_DISPOSITION_REQUIRED",
        }),
        expect.objectContaining({
          ruleCode: "ACCEPTED_NON_MATERIAL_RISK",
          treatment: "WARNING",
        }),
        expect.objectContaining({
          ruleCode: "OPEN_DISPOSITIONABLE_MATERIAL_RISK",
          treatment: "HUMAN_DISPOSITION_REQUIRED",
        }),
      ]),
    );
  });

  it("generates stable ordering and no numeric readiness score", () => {
    const value = input({
      checklistItems: [{ id: "z", priority: "BLOCKING", status: "OPEN" }],
      extractionAmbiguities: [{ citationId: "citation-a" }],
    });
    expect(generateDeterministicReadinessFindings(value)).toEqual(
      generateDeterministicReadinessFindings(value),
    );
    expect(
      JSON.stringify(generateDeterministicReadinessFindings(value)),
    ).not.toContain("score");
  });

  it("always emits the locked informational limitations as non-material", () => {
    const findings = generateDeterministicReadinessFindings(input());
    for (const ruleCode of [
      "NON_AFFILIATION_NOTICE",
      "NO_COMPLETE_RISK_GUARANTEE",
      "PRODUCT_LIMITATION",
    ])
      expect(findings).toContainEqual(
        expect.objectContaining({ materiality: "NON_MATERIAL", ruleCode }),
      );
  });
});

describe("final-readiness worker safety architecture", () => {
  it("rechecks canonical authority before processing and inside serializable activation", () => {
    expect(source).toContain("fingerprintFor(loaded)");
    expect(source).toContain("SOURCE_SET_CHANGED");
    expect(source).toContain("AUTHORITATIVE_INPUT_CHANGED");
    expect(source).toContain("TransactionIsolationLevel.Serializable");
    expect(
      source.indexOf("validateAuthority(await this.load(job))"),
    ).toBeLessThan(source.indexOf("this.activate(job"));
  });

  it("activates only the final-readiness pointer and creates no human decision", () => {
    expect(source).toContain("activeFinalReadinessRunId: current.id");
    expect(source).not.toContain("activeEarlyRiskRunId: current.id");
    expect(source).not.toContain("earlyPursuitDecision.create");
    expect(source).not.toContain("finalReadinessDecision.create");
  });

  it("uses typed relational provenance and no provider, prompt, RAG, or export path", () => {
    expect(source).toContain("provenance: { create: provenance }");
    expect(source).toContain("eligibilityAssessmentId");
    expect(source).toContain("checklistItemId");
    expect(source).toContain("draftClaimId");
    expect(source).toContain("riskFindingId");
    for (const prohibited of [
      "Gemini",
      "Gateway",
      "prompt",
      "ragIndex",
      "embedding",
      "exportManifest",
      "readinessScore",
    ])
      expect(source).not.toContain(prohibited);
  });

  it("handles duplicate, cancellation, invalidation, timeout, and safe failure states", () => {
    expect(source).toContain('run.status === "COMPLETED"');
    expect(source).toContain("checkCancellation");
    expect(source).toContain("RUN_CANCELLED");
    expect(source).toContain("FINAL_READINESS_TIMEOUT");
    expect(source).toContain("safeFailureCode");
    expect(source).toContain('status: "INVALIDATED"');
  });
});

describe("final-readiness worker lifecycle", () => {
  it("returns completed duplicate deliveries without rewriting outputs", async () => {
    const database = {
      finalReadinessRun: {
        findFirst: vi.fn().mockResolvedValue({
          finalRiskRun: { gateType: "FINAL_READINESS" },
          inputSnapshot: {},
          status: "COMPLETED",
        }),
        updateMany: vi.fn(),
      },
    };
    const processor = new FinalReadinessProcessor(database as never);

    await expect(processor.process(job)).resolves.toBeUndefined();
    expect(database.finalReadinessRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "run-a", organisationId: "organisation-a" },
      }),
    );
    expect(database.finalReadinessRun.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a missing or cross-organisation snapshot", async () => {
    const processor = new FinalReadinessProcessor({
      finalReadinessRun: { findFirst: vi.fn().mockResolvedValue(null) },
    } as never);
    await expect(processor.process(job)).rejects.toMatchObject({
      code: "SNAPSHOT_NOT_FOUND",
    });
  });

  it("cancels both linked records without activating a result", async () => {
    const readinessUpdate = vi.fn().mockResolvedValue({ count: 1 });
    const riskUpdate = vi.fn().mockResolvedValue({ count: 1 });
    const database = {
      $transaction: vi
        .fn()
        .mockImplementation(async (operations) => Promise.all(operations)),
      finalReadinessRun: {
        findFirst: vi.fn().mockResolvedValue({
          finalRiskRun: { gateType: "FINAL_READINESS", id: "risk-a" },
          id: "run-a",
          inputSnapshot: {},
          status: "QUEUED",
        }),
        findUnique: vi.fn().mockResolvedValue({
          cancellationRequestedAt: new Date(),
        }),
        updateMany: readinessUpdate,
      },
      riskAnalysisRun: { updateMany: riskUpdate },
    };
    const processor = new FinalReadinessProcessor(database as never);

    await expect(processor.process(job)).rejects.toMatchObject({
      code: "RUN_CANCELLED",
    });
    expect(readinessUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "CANCELLED" }),
      }),
    );
    expect(riskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "CANCELLED" }),
      }),
    );
  });

  it("persists bounded failure and stale-invalidation codes", async () => {
    const readinessUpdate = vi.fn().mockResolvedValue({ count: 1 });
    const riskUpdate = vi.fn().mockResolvedValue({ count: 1 });
    const database = {
      $transaction: vi
        .fn()
        .mockImplementation(async (operations) => Promise.all(operations)),
      finalReadinessRun: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ finalRiskRun: { id: "risk-a" } }),
        updateMany: readinessUpdate,
      },
      riskAnalysisRun: { updateMany: riskUpdate },
    };
    const processor = new FinalReadinessProcessor(database as never);

    await processor.fail(
      job,
      new FinalReadinessProcessingFailure("SOURCE_SET_CHANGED"),
    );
    expect(readinessUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          invalidationCode: "SOURCE_SET_CHANGED",
          status: "INVALIDATED",
        }),
      }),
    );

    await processor.fail(job, new Error("private database detail"));
    expect(readinessUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          safeFailureCode: "FINAL_READINESS_PROCESSING_FAILED",
          status: "FAILED",
        }),
      }),
    );
    expect(JSON.stringify(readinessUpdate.mock.calls)).not.toContain(
      "private database detail",
    );
  });
});
