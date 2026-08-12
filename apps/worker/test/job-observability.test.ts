import type { Job } from "bullmq";
import { Writable } from "node:stream";
import { pino } from "pino";
import { describe, expect, it, vi } from "vitest";

import { startJobLifecycle } from "../src/job-observability.js";

function metrics(): {
  readonly jobFinished: ReturnType<typeof vi.fn>;
  readonly jobRetried: ReturnType<typeof vi.fn>;
  readonly jobStalled: ReturnType<typeof vi.fn>;
  readonly jobStarted: ReturnType<typeof vi.fn>;
  readonly registry: never;
  readonly setReady: ReturnType<typeof vi.fn>;
} {
  return {
    jobFinished: vi.fn(),
    jobRetried: vi.fn(),
    jobStalled: vi.fn(),
    jobStarted: vi.fn(),
    registry: {} as never,
    setReady: vi.fn(),
  };
}

describe("job lifecycle observability", () => {
  it("logs safe correlation context and lifecycle metrics", async () => {
    const chunks: string[] = [];
    const destination = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    const logger = pino({ base: { service: "worker" } }, destination);
    const workerMetrics = metrics();
    const job = {
      attemptsMade: 0,
      data: { requestId: "request-123", secret: "must-not-log" },
      id: "job-123",
      name: "extract-tender-version",
      processedOn: 2_000,
      timestamp: 1_000,
    } as unknown as Job;

    const lifecycle = startJobLifecycle(job, logger, workerMetrics as never);
    lifecycle.complete();
    await new Promise<void>((resolve) => destination.end(resolve));
    const output = chunks.join("");

    expect(workerMetrics.jobStarted).toHaveBeenCalledWith(
      { jobName: "extract-tender-version" },
      1,
    );
    expect(workerMetrics.jobFinished).toHaveBeenCalledWith(
      { jobName: "extract-tender-version", outcome: "completed" },
      expect.any(Number),
    );
    expect(output).toContain("request-123");
    expect(output).toContain("job_started");
    expect(output).toContain("job_completed");
    expect(output).not.toContain("must-not-log");
  });

  it("classifies timeout failures without leaking the error message", async () => {
    const chunks: string[] = [];
    const destination = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    const logger = pino({}, destination);
    const workerMetrics = metrics();
    const job = {
      attemptsMade: 1,
      data: { requestId: "request-456" },
      id: "job-456",
      name: "run-final-readiness-audit",
    } as unknown as Job;
    const error = new Error("private provider payload");
    error.name = "TimeoutError";

    startJobLifecycle(job, logger, workerMetrics as never).fail(error);
    await new Promise<void>((resolve) => destination.end(resolve));
    const output = chunks.join("");

    expect(workerMetrics.jobFinished).toHaveBeenCalledWith(
      { jobName: "run-final-readiness-audit", outcome: "timed_out" },
      expect.any(Number),
    );
    expect(output).toContain("job_timeout");
    expect(output).not.toContain("private provider payload");
  });
});
