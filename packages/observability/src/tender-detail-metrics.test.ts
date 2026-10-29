import { describe, expect, it } from "vitest";

import { createApiMetrics } from "./metrics.js";

describe("tender detail stage metrics", () => {
  it("uses a fixed stage label and records duration without request identity", async () => {
    const metrics = createApiMetrics();
    metrics.tenderDetailStageFinished("tender_primary_query", 0.125);
    const output = await metrics.registry.metrics();
    expect(output).toContain(
      'tip_api_tender_detail_stage_duration_seconds_count{service="api",stage="tender_primary_query"} 1',
    );
    expect(output).not.toContain("request_id");
    expect(output).not.toContain("organisation_id");
    expect(output).not.toContain("tender_id");
  });
});
