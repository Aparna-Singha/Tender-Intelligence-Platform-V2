import { NotFoundException } from "@nestjs/common";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { FinalReadinessController } from "../src/final-readiness/final-readiness.controller.js";
import { FinalReadinessError } from "../src/final-readiness/final-readiness.error.js";
import { FinalReadinessFreshnessService } from "../src/final-readiness/final-readiness-freshness.service.js";
import { FinalReadinessService } from "../src/final-readiness/final-readiness.service.js";

describe("Phase 11 final-readiness API boundaries", () => {
  it("does not reveal a cross-tenant run", async () => {
    const database = {
      finalReadinessRun: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const service = new FinalReadinessService(
      database as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.run("organisation-b", "tender-a", "run-a"),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(database.finalReadinessRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "run-a",
          organisationId: "organisation-b",
          tenderId: "tender-a",
        },
      }),
    );
  });

  it("returns a bounded content-free progress payload", async () => {
    const database = {
      finalReadinessRun: {
        findFirst: vi.fn().mockResolvedValue({
          currentStage: "EVALUATING_READINESS",
          progressPercentage: 65,
          status: "PROCESSING",
          updatedAt: new Date("2026-08-03T10:00:00.000Z"),
        }),
      },
    };
    const service = new FinalReadinessService(
      database as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.progress("organisation-a", "tender-a", "run-a"),
    ).resolves.toEqual({
      occurred_at: "2026-08-03T10:00:00.000Z",
      progress_percent: 65,
      run_id: "run-a",
      stage: "EVALUATING_READINESS",
      status: "PROCESSING",
    });
  });

  it("returns an idempotent replay without enqueueing a second job", async () => {
    const database = {
      finalReadinessRun: {
        findFirst: vi.fn().mockResolvedValue({
          createdAt: new Date("2026-08-03T10:00:00.000Z"),
          finalRiskRun: { id: "risk-a" },
          id: "run-a",
          status: "QUEUED",
        }),
      },
    };
    const jobs = { add: vi.fn() };
    const service = new FinalReadinessService(
      database as never,
      jobs as never,
      {} as never,
    );

    await expect(
      service.start(
        "organisation-a",
        "tender-a",
        "user-a",
        "idempotency-a",
        "request-a",
      ),
    ).resolves.toMatchObject({
      final_risk_run_id: "risk-a",
      run_id: "run-a",
      status: "QUEUED",
    });
    expect(jobs.add).not.toHaveBeenCalled();
  });

  it("prevents finding review when freshness fails", async () => {
    const freshness = {
      evaluate: vi.fn().mockResolvedValue({
        fresh: false,
        reasons: ["SOURCE_SET_CHANGED"],
      }),
    };
    const service = new FinalReadinessService(
      {} as never,
      {} as never,
      freshness as never,
    );

    await expect(
      service.reviewFinding(
        "organisation-a",
        "tender-a",
        "run-a",
        "finding-a",
        {
          acknowledgement_recorded: true,
          action: "ACKNOWLEDGE",
          expected_current_review_version: 0,
          rationale: "A sufficiently detailed human rationale.",
        },
        "user-a",
        "request-a",
      ),
    ).rejects.toMatchObject({ publicCode: "FINAL_READINESS_RUN_STALE" });
  });

  it("uses explicit permissions and authenticated server authority", () => {
    const source = readFileSync(
      new URL(
        "../src/final-readiness/final-readiness.controller.ts",
        import.meta.url,
      ),
      "utf8",
    );
    for (const permission of [
      "TENDER_FINAL_READINESS_READ",
      "TENDER_FINAL_READINESS_START",
      "TENDER_FINAL_READINESS_FINDING_REVIEW",
      "TENDER_FINAL_READINESS_DISPOSITION_CREATE",
      "TENDER_FINAL_READINESS_CANCEL",
      "TENDER_FINAL_READINESS_RETRY",
    ])
      expect(source).toContain(permission);
    expect(source).toContain("request.authenticatedUser.userId");
    expect(source).toContain("request.organisationPrincipal.role");
    expect(source).not.toContain("body.userId");
    expect(source).not.toContain("body.role");
    expect(source).not.toContain('Post("export');
  });

  it("uses a serializable transaction and an opaque queue body", () => {
    const source = readFileSync(
      new URL(
        "../src/final-readiness/final-readiness.service.ts",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).toContain("TransactionIsolationLevel.Serializable");
    expect(source).toContain('"run-final-readiness-audit"');
    const queueCall = source.slice(
      source.indexOf("await this.jobs.add"),
      source.indexOf("removeOnComplete", source.indexOf("await this.jobs.add")),
    );
    expect(queueCall).toContain("finalReadinessRunId");
    expect(queueCall).toContain("organisationId");
    expect(queueCall).toContain("requestId");
    for (const prohibited of [
      "sourceContent",
      "evidenceValue",
      "draftText",
      "objectKey",
      "prompt",
      "credential",
      "snapshot",
    ])
      expect(queueCall).not.toContain(prohibited);
  });
});

describe("Phase 11 freshness checks", () => {
  it("detects changed source checksums and preserves safe reason codes", async () => {
    const database = {
      draft: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ currentVersionId: "draft-version-a" }),
      },
      finalReadinessRun: {
        findFirst: vi.fn().mockResolvedValue({
          id: "run-a",
          inputSnapshot: {
            checklistGenerationRun: {
              invalidatedAt: null,
              sourceFingerprint: "checklist-fingerprint",
              status: "COMPLETE",
            },
            checklistGenerationRunId: "checklist-a",
            documents: [{ checksum: "old", tenderDocumentId: "document-a" }],
            earlyRiskRun: {
              invalidatedAt: null,
              sourceFingerprint: "risk-fingerprint",
              status: "COMPLETE",
            },
            earlyRiskRunId: "risk-a",
            eligibilityAssessmentRun: {
              invalidatedAt: null,
              status: "COMPLETE",
            },
            eligibilityAssessmentRunId: "eligibility-a",
            eligibilityInputSnapshot: { fingerprint: "evidence-fingerprint" },
            eligibilityInputSnapshotId: "eligibility-snapshot-a",
            evidenceExpiryPolicyVersion: "evidence-expiry-30-calendar-days-v1",
            extractionRun: {
              invalidatedAt: null,
              sourceFingerprint: "extraction-fingerprint",
              status: "COMPLETE",
            },
            extractionRunId: "extraction-a",
            fingerprint: "stored-fingerprint",
            policyVersion: "final-readiness-deterministic-v1",
            pursuitDecision: { decision: "CONTINUE", supersededAt: null },
            pursuitDecisionId: "decision-a",
            requiredDraftPolicyVersion: "required-consolidated-first-draft-v1",
            requiredDrafts: [
              {
                draftId: "draft-a",
                draftVersion: { invalidatedAt: null, reviewState: "APPROVED" },
                draftVersionId: "draft-version-a",
                qualifyingReviewEvent: {
                  action: "APPROVE_VERSION",
                  actorRoleAtAction: "REVIEWER",
                },
                sourceFingerprint: "draft-fingerprint",
                templateVersion: { requiredReviewRole: "REVIEWER" },
              },
            ],
          },
          inputFingerprint: "stored-fingerprint",
          invalidatedAt: null,
          status: "PROCESSING",
          tenderVersionId: "version-a",
        }),
      },
      tender: {
        findFirst: vi.fn().mockResolvedValue({ currentVersionId: "version-a" }),
      },
      tenderDocument: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: "document-a", sha256: "new" }]),
      },
      tenderVersion: {
        findFirst: vi.fn().mockResolvedValue({
          activeEarlyRiskRunId: "risk-a",
          activeEligibilityAssessmentRunId: "eligibility-a",
          activeExtractionRunId: "extraction-a",
          activeFinalReadinessRunId: null,
          sourceFingerprint: "version-fingerprint",
        }),
      },
    };
    const service = new FinalReadinessFreshnessService(database as never);

    const result = await service.evaluate(
      "organisation-a",
      "tender-a",
      "run-a",
    );

    expect(result.fresh).toBe(false);
    expect(result.reasons).toContain("SOURCE_SET_CHANGED");
  });
});

describe("Phase 11 stable public errors", () => {
  it("carries only the bounded public code and safe message", () => {
    const error = new FinalReadinessError(
      "FINAL_READINESS_RUN_STALE",
      "The final-readiness run is no longer current.",
      409,
    );
    expect(error.publicCode).toBe("FINAL_READINESS_RUN_STALE");
    expect(error.message).not.toContain("Prisma");
    expect(error.message).not.toContain("constraint");
  });
});

describe("Phase 11 controller selectors", () => {
  it("rejects a mismatched body run identifier", () => {
    const controller = new FinalReadinessController({} as never);
    expect(() =>
      controller.cancel(
        "organisation-a",
        "tender-a",
        "00000000-0000-4000-8000-000000000001",
        {
          rationale: "A sufficiently detailed cancellation rationale.",
          run_id: "00000000-0000-4000-8000-000000000002",
        },
        {} as never,
      ),
    ).toThrow(NotFoundException);
  });
});
