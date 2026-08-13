import { describe, expect, it } from "vitest";

import { createApiMetrics, createWorkerMetrics } from "./metrics.js";

describe("service metrics", () => {
  it("records API metrics with bounded route and status-class labels", async () => {
    const metrics = createApiMetrics();

    metrics.requestStarted();
    metrics.requestFinished(
      { method: "GET", route: "/tenders/:tenderId", statusCode: 503 },
      0.12,
    );
    metrics.dependencyUnavailable("/tenders/:tenderId");
    const output = await metrics.registry.metrics();

    expect(output).toContain(
      'tip_api_requests_total{method="GET",route="/tenders/:tenderId",status_class="5xx",service="api"} 1',
    );
    expect(output).toContain(
      'tip_api_dependency_unavailable_total{route="/tenders/:tenderId",service="api"} 1',
    );
    expect(output).not.toContain("request-id");
    expect(output).not.toContain("8d9114e5");
  });

  it("records worker lifecycle metrics without job identifiers", async () => {
    const metrics = createWorkerMetrics();

    metrics.setReady(true);
    metrics.aiOperationFinished(
      { operation: "embedding", outcome: "success", provider: "gemini" },
      0.2,
    );
    metrics.jobStarted({ jobName: "extract-tender-version" }, 1.5);
    metrics.jobFinished(
      { jobName: "extract-tender-version", outcome: "completed" },
      2.25,
    );
    const output = await metrics.registry.metrics();

    expect(output).toContain(
      'tip_worker_jobs_started_total{job_name="extract-tender-version",service="worker"} 1',
    );
    expect(output).toContain(
      'tip_worker_jobs_finished_total{job_name="extract-tender-version",outcome="completed",service="worker"} 1',
    );
    expect(output).toContain('tip_worker_ready{service="worker"} 1');
    expect(output).toContain(
      'tip_worker_ai_operation_duration_seconds_count{service="worker",operation="embedding",outcome="success",provider="gemini"} 1',
    );
    expect(output).not.toContain("job-id");
    expect(output).not.toContain("run-id");
  });
});
