import { describe, expect, it } from "vitest";
import {
  tenderWorkflowProgressDeduplicationId,
  tenderWorkflowProgressJobId,
  tenderWorkflowProgressQueuePolicy,
} from "./tender-workflow.js";

describe("tender workflow progression contracts", () => {
  it("uses stage-specific job ids so later progression events for the same tender are distinct", () => {
    const sourceReadyJobId = tenderWorkflowProgressJobId({
      organisationId: "organisation-a",
      tenderId: "tender-a",
      triggerId: "version-a",
      triggerType: "SOURCE_READY",
    });
    const extractionCompleteJobId = tenderWorkflowProgressJobId({
      organisationId: "organisation-a",
      tenderId: "tender-a",
      triggerId: "extraction-a",
      triggerType: "EXTRACTION_COMPLETE",
    });

    expect(sourceReadyJobId).not.toBe(extractionCompleteJobId);
  });

  it("keeps deduplication tenant scoped while allowing only one active and one queued tender job", () => {
    const policy = tenderWorkflowProgressQueuePolicy({
      organisationId: "organisation-a",
      tenderId: "tender-a",
      triggerId: "decision-a",
      triggerType: "CONTINUE_DECISION",
    });

    expect(policy).toMatchObject({
      attempts: 5,
      backoffDelayMs: 2_000,
      deduplicationId: "progress-tender-workflow__organisation-a__tender-a",
      jobId:
        "progress-tender-workflow__organisation-a__tender-a__CONTINUE_DECISION__decision-a",
      keepLastIfActive: true,
      removeOnComplete: 100,
    });
  });

  it("prevents cross-tenant identity collisions for the same tender id", () => {
    expect(
      tenderWorkflowProgressDeduplicationId("organisation-a", "tender-a"),
    ).not.toBe(
      tenderWorkflowProgressDeduplicationId("organisation-b", "tender-a"),
    );
  });
});
