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

  it.each([
    { completedAt: null, startedAt: null, status: "QUEUED" },
    {
      completedAt: null,
      startedAt: new Date("2026-08-03T10:01:00.000Z"),
      status: "PROCESSING",
    },
    {
      completedAt: new Date("2026-08-03T10:02:00.000Z"),
      startedAt: new Date("2026-08-03T10:01:00.000Z"),
      status: "COMPLETED",
    },
  ])(
    "maps persisted $status lifecycle timestamps and opaque state",
    async (state) => {
      const database = {
        finalReadinessRun: {
          findFirst: vi.fn().mockResolvedValue({
            ...state,
            createdAt: new Date("2026-08-03T10:00:00.000Z"),
            decisions: [],
            finalRiskRun: { id: "risk-a", status: "COMPLETE" },
            findings: [],
            id: "run-a",
            inputFingerprint: "authoritative-opaque-fingerprint",
            invalidatedAt: null,
            invalidationCode: null,
            policyVersion: "final-readiness-deterministic-v1",
            safeFailureCode: null,
            tenderVersionId: "version-a",
            updatedAt: new Date("2026-08-03T10:03:00.000Z"),
          }),
        },
      };
      const freshness = {
        evaluate: vi.fn().mockResolvedValue({ fresh: true, reasons: [] }),
      };
      const service = new FinalReadinessService(
        database as never,
        {} as never,
        freshness as never,
      );

      const result = (await service.run(
        "organisation-a",
        "tender-a",
        "run-a",
      )) as Record<string, unknown>;

      expect(result).toMatchObject({
        completed_at: state.completedAt?.toISOString() ?? null,
        disposition_concurrency_token: "authoritative-opaque-fingerprint",
        started_at: state.startedAt?.toISOString() ?? null,
        status: state.status,
      });
      expect(JSON.stringify(result)).not.toMatch(
        /source_body|draft_text|evidence_text|object_key|snapshot/i,
      );
    },
  );

  it("derives the current finding review version from persisted history", async () => {
    const database = {
      finalReadinessFinding: {
        findFirst: vi.fn().mockResolvedValue({
          createdAt: new Date("2026-08-03T10:00:00.000Z"),
          explanation: "A bounded explanation for human review.",
          id: "finding-a",
          lifecycle: "UNDER_REVIEW",
          materiality: "MATERIAL",
          provenance: [],
          provenanceValid: true,
          reviewState: "REVIEWED",
          reviews: [
            {
              acknowledgementRecorded: true,
              action: "ACKNOWLEDGE",
              actor: { displayName: "Reviewer", id: "user-a" },
              createdAt: new Date("2026-08-03T10:01:00.000Z"),
              reviewVersion: 2,
            },
            {
              acknowledgementRecorded: false,
              action: "REOPEN",
              actor: { displayName: "Reviewer", id: "user-a" },
              createdAt: new Date("2026-08-03T10:00:30.000Z"),
              reviewVersion: 1,
            },
          ],
          ruleCode: "MATERIAL_EXTRACTION_AMBIGUITY",
          title: "Material extraction ambiguity",
          treatment: "HUMAN_DISPOSITION_REQUIRED",
        }),
      },
    };
    const service = new FinalReadinessService(
      database as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.finding("organisation-a", "tender-a", "run-a", "finding-a"),
    ).resolves.toMatchObject({ current_review_version: 2 });
  });

  it("returns bounded chronological review history with tenant and tender predicates", async () => {
    const findingLookup = vi.fn().mockResolvedValue({ id: "finding-a" });
    const reviewLookup = vi.fn().mockResolvedValue([
      {
        acknowledgementRecorded: true,
        action: "ACKNOWLEDGE",
        actor: { displayName: "Independent Reviewer", id: "user-a" },
        createdAt: new Date("2026-08-03T10:01:00.000Z"),
        findingId: "finding-a",
        id: "review-a",
        rationale: "The cited limitation was reviewed and acknowledged.",
        reviewVersion: 1,
      },
    ]);
    const database = {
      finalReadinessFinding: { findFirst: findingLookup },
      finalReadinessFindingReview: { findMany: reviewLookup },
    };
    const service = new FinalReadinessService(
      database as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.findingReviews(
        "organisation-a",
        "tender-a",
        "run-a",
        "finding-a",
      ),
    ).resolves.toMatchObject({
      items: [{ review_version: 1, rationale: expect.any(String) }],
    });
    expect(findingLookup).toHaveBeenCalledWith({
      select: { id: true },
      where: {
        id: "finding-a",
        organisationId: "organisation-a",
        run: { id: "run-a", tenderId: "tender-a" },
      },
    });
    expect(reviewLookup).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { reviewVersion: "asc" },
        take: 100,
        where: {
          findingId: "finding-a",
          organisationId: "organisation-a",
        },
      }),
    );
  });

  it("does not reveal review history through altered scope identifiers", async () => {
    const service = new FinalReadinessService(
      {
        finalReadinessFinding: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      } as never,
      {} as never,
      {} as never,
    );
    await expect(
      service.findingReviews(
        "organisation-b",
        "tender-b",
        "run-b",
        "finding-a",
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
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

  it("appends a review at the authoritative next version and rejects a stale version", async () => {
    const aggregate = vi.fn().mockResolvedValue({ _max: { reviewVersion: 1 } });
    const transaction = {
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
      finalReadinessFinding: {
        findFirst: vi.fn().mockResolvedValue({ id: "finding-a" }),
        update: vi.fn().mockResolvedValue({}),
      },
      finalReadinessFindingReview: {
        aggregate,
        create: vi.fn().mockResolvedValue({
          acknowledgementRecorded: true,
          action: "ACKNOWLEDGE",
          actor: { displayName: "Reviewer", id: "user-a" },
          createdAt: new Date("2026-08-03T10:00:00.000Z"),
          findingId: "finding-a",
          id: "review-b",
          rationale: "The cited limitation was reviewed and acknowledged.",
          reviewVersion: 2,
        }),
      },
    };
    const database = {
      $transaction: vi
        .fn()
        .mockImplementation(
          (operation: (value: typeof transaction) => Promise<unknown>) =>
            operation(transaction),
        ),
    };
    const freshness = {
      evaluate: vi.fn().mockResolvedValue({ fresh: true, reasons: [] }),
    };
    const service = new FinalReadinessService(
      database as never,
      {} as never,
      freshness as never,
    );
    const request = {
      acknowledgement_recorded: true,
      action: "ACKNOWLEDGE" as const,
      expected_current_review_version: 1,
      rationale: "The cited limitation was reviewed and acknowledged.",
    };

    await expect(
      service.reviewFinding(
        "organisation-a",
        "tender-a",
        "run-a",
        "finding-a",
        request,
        "user-a",
        "request-a",
      ),
    ).resolves.toMatchObject({ review_version: 2 });
    expect(transaction.finalReadinessFindingReview.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ reviewVersion: 2 }),
      }),
    );

    await expect(
      service.reviewFinding(
        "organisation-a",
        "tender-a",
        "run-a",
        "finding-a",
        { ...request, expected_current_review_version: 0 },
        "user-a",
        "request-b",
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(aggregate).toHaveBeenCalledTimes(2);
  });

  it("accepts only the current server-issued disposition token", async () => {
    const run = {
      finalRiskRun: { invalidatedAt: null, status: "COMPLETE" },
      findings: [],
      id: "run-a",
      inputFingerprint: "authoritative-opaque-fingerprint",
      inputSnapshot: {
        requiredDrafts: [{ draftCreatorUserId: "draft-creator" }],
      },
      invalidatedAt: null,
      requestedByUserId: "requester",
      status: "COMPLETED",
      tenderVersionId: "version-a",
    };
    const transaction = {
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
      finalReadinessDecision: {
        create: vi.fn().mockResolvedValue({
          actor: { displayName: "Independent Reviewer", id: "reviewer" },
          createdAt: new Date("2026-08-03T10:00:00.000Z"),
          disposition: "HOLD_FOR_REMEDIATION",
          id: "decision-a",
          rationale: "Work remains and remediation must be completed first.",
          runId: "run-a",
          supersededAt: null,
        }),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
      finalReadinessRun: { findFirst: vi.fn().mockResolvedValue(run) },
      tenderVersion: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ activeFinalReadinessRunId: "run-a" }),
      },
    };
    const database = {
      $transaction: vi
        .fn()
        .mockImplementation(
          (operation: (value: typeof transaction) => Promise<unknown>) =>
            operation(transaction),
        ),
    };
    const freshness = {
      evaluate: vi.fn().mockResolvedValue({ fresh: true, reasons: [] }),
    };
    const service = new FinalReadinessService(
      database as never,
      {} as never,
      freshness as never,
    );
    const request = {
      acknowledgement_ids: [],
      disposition: "HOLD_FOR_REMEDIATION" as const,
      expected_fingerprint: "authoritative-opaque-fingerprint",
      rationale: "Work remains and remediation must be completed first.",
      run_id: "run-a",
    };

    await expect(
      service.createDisposition(
        "organisation-a",
        "tender-a",
        request,
        "reviewer",
        "REVIEWER",
        "request-a",
      ),
    ).resolves.toMatchObject({ disposition: "HOLD_FOR_REMEDIATION" });

    await expect(
      service.createDisposition(
        "organisation-a",
        "tender-a",
        { ...request, expected_fingerprint: "stale-opaque-fingerprint" },
        "reviewer",
        "REVIEWER",
        "request-b",
      ),
    ).rejects.toMatchObject({
      publicCode: "FINAL_READINESS_DECISION_BLOCKED",
    });
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
    expect(source).toContain(
      'Get("final-readiness/:runId/findings/:findingId/reviews")',
    );
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
