import { describe, expect, it } from "vitest";
import {
  createFinalReadinessDispositionSchema,
  finalReadinessCurrentResponseSchema,
  finalReadinessDispositionHistorySchema,
  finalReadinessErrorCodeSchema,
  finalReadinessErrorCodes,
  finalReadinessFindingFilterSchema,
  finalReadinessFindingListResponseSchema,
  finalReadinessFindingReviewHistorySchema,
  finalReadinessFindingSchema,
  finalReadinessHistoryResponseSchema,
  finalReadinessPaginationSchema,
  finalReadinessPreflightResponseSchema,
  finalReadinessProgressEventSchema,
  finalReadinessRunSchema,
  reviewFinalReadinessFindingSchema,
  startFinalReadinessResponseSchema,
  startFinalReadinessSchema,
} from "./final-readiness.js";

const id = "00000000-0000-4000-8000-000000000001";
const otherId = "00000000-0000-4000-8000-000000000002";
const timestamp = "2026-08-03T12:00:00.000Z";

const actor = { display_name: "Independent Reviewer", user_id: otherId };
const dispositionRecord = {
  actor,
  created_at: timestamp,
  disposition: "HOLD_FOR_REMEDIATION",
  id: otherId,
  rationale: "Hold while the cited mandatory evidence is remediated.",
  run_id: id,
  superseded: false,
  superseded_at: null,
};
const run = {
  completed_at: timestamp,
  created_at: timestamp,
  current_disposition: dispositionRecord,
  disposition_concurrency_token:
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  failure_code: null,
  final_risk_run_id: otherId,
  final_risk_status: "COMPLETED",
  finding_counts: {
    blockers: 1,
    human_disposition_required: 2,
    informational: 4,
    warnings: 3,
  },
  id,
  invalidated: false,
  is_current: true,
  policy_version: "final-readiness-deterministic-v1",
  stale: false,
  started_at: timestamp,
  status: "COMPLETED",
  tender_version_id: otherId,
  updated_at: timestamp,
};
const finding = {
  created_at: timestamp,
  current_review_version: 0,
  explanation: "A mandatory eligibility requirement has conflicting evidence.",
  id,
  lifecycle_state: "OPEN",
  materiality: "MATERIAL",
  provenance: [{ id: otherId, source_class: "ELIGIBILITY_ASSESSMENT" }],
  provenance_valid: true,
  review_state: "HUMAN_REVIEW_REQUIRED",
  review_summary: {
    acknowledgement_recorded: false,
    latest_action: null,
    reviewed_at: null,
    reviewer: null,
  },
  rule_code: "MANDATORY_ELIGIBILITY_CONFLICT",
  title: "Conflicting mandatory eligibility evidence",
  treatment: "BLOCKER",
};

describe("final readiness contracts", () => {
  it("accepts an informational preflight without a decision or content bodies", () => {
    const value = {
      eligible_independent_decision_actor_exists: true,
      evaluated_at: timestamp,
      hard_prerequisites_pass: false,
      informational_only: true,
      policy_version: "final-readiness-deterministic-v1",
      prerequisite_denials: [
        { code: "PREREQUISITE_NOT_CURRENT", prerequisite: "EXTRACTION" },
        { code: "PREREQUISITE_INVALIDATED", prerequisite: "EARLY_RISK" },
      ],
      qualifying_consolidated_draft_version_id: null,
      tender_version_id: id,
      transactional_revalidation_required: true,
    };
    const parsed = finalReadinessPreflightResponseSchema.parse(value);
    expect(parsed.prerequisite_denials).toHaveLength(2);
    expect(parsed).not.toHaveProperty("disposition");
    expect(parsed).not.toHaveProperty("readiness_score");
    expect(JSON.stringify(parsed)).not.toMatch(
      /source_body|draft_text|evidence_text|object_key/i,
    );
  });

  it("accepts only the idempotency key as start authority", () => {
    expect(
      startFinalReadinessSchema.parse({ idempotency_key: "readiness-123" }),
    ).toEqual({ idempotency_key: "readiness-123" });
    for (const authority of [
      "actor_id",
      "organisation_id",
      "membership",
      "final_risk_run_id",
      "snapshot_id",
      "input_fingerprint",
      "source_ids",
    ]) {
      expect(
        startFinalReadinessSchema.safeParse({
          [authority]: id,
          idempotency_key: "readiness-123",
        }).success,
      ).toBe(false);
    }
    expect(
      startFinalReadinessResponseSchema.safeParse({
        created_at: timestamp,
        events_path: `/final-readiness/${id}/events`,
        final_risk_run_id: otherId,
        policy_version: "final-readiness-deterministic-v1",
        polling_path: `/final-readiness/${id}`,
        queue_id: "private-job-id",
        run_id: id,
        status: "QUEUED",
      }).success,
    ).toBe(false);
  });

  it("accepts bounded current, history, run, and progress responses", () => {
    expect(finalReadinessRunSchema.safeParse(run).success).toBe(true);
    expect(finalReadinessCurrentResponseSchema.safeParse({ run }).success).toBe(
      true,
    );
    expect(
      finalReadinessHistoryResponseSchema.safeParse({
        items: [run],
        next_cursor: null,
      }).success,
    ).toBe(true);
    expect(
      finalReadinessProgressEventSchema.safeParse({
        occurred_at: timestamp,
        progress_percent: 75,
        run_id: id,
        stage: "EVALUATING_READINESS",
        status: "PROCESSING",
      }).success,
    ).toBe(true);
    expect(run).not.toHaveProperty("readiness_score");
  });

  it("requires an opaque disposition token and nullable lifecycle timestamps", () => {
    expect(
      finalReadinessRunSchema.safeParse({
        ...run,
        completed_at: null,
        started_at: null,
      }).success,
    ).toBe(true);
    expect(
      finalReadinessRunSchema.safeParse({
        ...run,
        disposition_concurrency_token: "short",
      }).success,
    ).toBe(false);
    expect(JSON.stringify(run)).not.toMatch(
      /source_body|draft_text|evidence_text|object_key|snapshot/i,
    );
  });

  it("enforces pagination boundaries and strict filters", () => {
    expect(finalReadinessPaginationSchema.parse({}).limit).toBe(25);
    expect(finalReadinessPaginationSchema.safeParse({ limit: 1 }).success).toBe(
      true,
    );
    expect(
      finalReadinessPaginationSchema.safeParse({ limit: 100 }).success,
    ).toBe(true);
    expect(finalReadinessPaginationSchema.safeParse({ limit: 0 }).success).toBe(
      false,
    );
    expect(
      finalReadinessPaginationSchema.safeParse({ limit: 101 }).success,
    ).toBe(false);
    expect(
      finalReadinessFindingFilterSchema.safeParse({ unknown: "filter" })
        .success,
    ).toBe(false);
  });

  it.each([
    "BLOCKER",
    "HUMAN_DISPOSITION_REQUIRED",
    "WARNING",
    "INFORMATIONAL",
  ])("accepts the %s finding treatment", (treatment) => {
    expect(
      finalReadinessFindingSchema.safeParse({ ...finding, treatment }).success,
    ).toBe(true);
  });

  it("allows only typed provenance handles and no private content", () => {
    expect(finalReadinessFindingSchema.safeParse(finding).success).toBe(true);
    expect(
      finalReadinessFindingSchema.safeParse({
        ...finding,
        provenance: [
          { id: otherId, source_class: "ARBITRARY", text: "secret" },
        ],
      }).success,
    ).toBe(false);
    expect(
      finalReadinessFindingSchema.safeParse({
        ...finding,
        provenance: [
          {
            id: otherId,
            object_key: "private/key",
            source_class: "EVIDENCE_CITATION",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      finalReadinessFindingListResponseSchema.safeParse({
        items: [finding],
        next_cursor: null,
      }).success,
    ).toBe(true);
  });

  it("bounds append-only finding review rationale and rejects authority", () => {
    const valid = {
      acknowledgement_recorded: true,
      action: "ACKNOWLEDGE",
      expected_current_review_version: 0,
      rationale: "The cited limitation was reviewed and acknowledged.",
    };
    expect(reviewFinalReadinessFindingSchema.safeParse(valid).success).toBe(
      true,
    );
    expect(
      reviewFinalReadinessFindingSchema.safeParse({
        ...valid,
        rationale: "too short",
      }).success,
    ).toBe(false);
    expect(
      reviewFinalReadinessFindingSchema.safeParse({
        ...valid,
        actor_id: id,
      }).success,
    ).toBe(false);
  });

  it("exposes the authoritative review version and safe append-only history", () => {
    expect(
      finalReadinessFindingSchema.safeParse({
        ...finding,
        current_review_version: 2,
      }).success,
    ).toBe(true);
    const parsed = finalReadinessFindingReviewHistorySchema.parse({
      items: [
        {
          acknowledgement_recorded: true,
          action: "ACKNOWLEDGE",
          actor,
          created_at: timestamp,
          finding_id: id,
          id: otherId,
          rationale: "The cited limitation was reviewed and acknowledged.",
          review_version: 1,
        },
      ],
    });
    expect(parsed.items[0]?.review_version).toBe(1);
    expect(JSON.stringify(parsed)).not.toMatch(
      /source_body|draft_text|evidence_text|object_key/i,
    );
  });

  it.each([
    "PROCEED_TO_CONTROLLED_EXPORT_REVIEW",
    "HOLD_FOR_REMEDIATION",
    "STOP_PURSUIT",
  ])("accepts the %s final disposition", (disposition) => {
    expect(
      createFinalReadinessDispositionSchema.safeParse({
        acknowledgement_ids: [otherId],
        disposition,
        expected_fingerprint: "sha256:0123456789abcdef",
        rationale: "The independent reviewer recorded a controlled decision.",
        run_id: id,
      }).success,
    ).toBe(true);
  });

  it("requires rationale and a bounded fingerprint token", () => {
    const value = {
      acknowledgement_ids: [],
      disposition: "HOLD_FOR_REMEDIATION",
      expected_fingerprint: "sha256:0123456789abcdef",
      rationale: "short",
      run_id: id,
    };
    expect(createFinalReadinessDispositionSchema.safeParse(value).success).toBe(
      false,
    );
    expect(
      createFinalReadinessDispositionSchema.safeParse({
        ...value,
        expected_fingerprint: "unsafe fingerprint with spaces",
        rationale: "A sufficiently detailed remediation rationale is supplied.",
      }).success,
    ).toBe(false);
  });

  it("bounds acknowledgement identifiers and rejects duplicates", () => {
    const value = {
      acknowledgement_ids: [otherId, otherId],
      disposition: "PROCEED_TO_CONTROLLED_EXPORT_REVIEW",
      expected_fingerprint: "sha256:0123456789abcdef",
      rationale:
        "All required acknowledgements have been reviewed independently.",
      run_id: id,
    };
    expect(createFinalReadinessDispositionSchema.safeParse(value).success).toBe(
      false,
    );
    expect(
      createFinalReadinessDispositionSchema.safeParse({
        ...value,
        acknowledgement_ids: Array.from(
          { length: 101 },
          (_, index) =>
            `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        ),
      }).success,
    ).toBe(false);
  });

  it("rejects client claims about server-validated decision facts", () => {
    expect(
      createFinalReadinessDispositionSchema.safeParse({
        acknowledgement_ids: [],
        actor_has_permission: true,
        disposition: "STOP_PURSUIT",
        expected_fingerprint: "sha256:0123456789abcdef",
        rationale:
          "The independent reviewer recorded the reason to stop pursuit.",
        run_id: id,
      }).success,
    ).toBe(false);
  });

  it("preserves safe disposition history without submission approval language", () => {
    const parsed = finalReadinessDispositionHistorySchema.parse({
      items: [dispositionRecord],
    });
    expect(JSON.stringify(parsed)).not.toMatch(/approved.to.submit/i);
  });

  it("exports the stable feature error vocabulary", () => {
    expect(finalReadinessErrorCodes).toHaveLength(11);
    for (const code of finalReadinessErrorCodes)
      expect(finalReadinessErrorCodeSchema.parse(code)).toBe(code);
    expect(finalReadinessErrorCodeSchema.safeParse("SQL_ERROR").success).toBe(
      false,
    );
  });
});
