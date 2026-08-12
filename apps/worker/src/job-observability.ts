import type { Job } from "bullmq";
import type { Logger } from "pino";
import { requestIdSchema } from "@tender/contracts";
import type { WorkerMetrics } from "@tender/observability";

export type JobOutcome = "completed" | "failed" | "timed_out";

export interface JobLifecycle {
  complete(): void;
  fail(error: unknown): void;
}

export function startJobLifecycle(
  job: Job,
  logger: Logger,
  metrics: WorkerMetrics,
): JobLifecycle {
  const startedAt = process.hrtime.bigint();
  const context = buildJobContext(job);
  const jobLogger = logger.child(context);
  metrics.jobStarted({ jobName: job.name }, queueWaitSeconds(job));
  jobLogger.info({ event: "job_started" }, "Worker job started");

  return {
    complete: () => {
      const durationSeconds = elapsedSeconds(startedAt);
      metrics.jobFinished(
        { jobName: job.name, outcome: "completed" },
        durationSeconds,
      );
      jobLogger.info(
        { duration_seconds: durationSeconds, event: "job_completed" },
        "Worker job completed",
      );
    },
    fail: (error) => {
      const durationSeconds = elapsedSeconds(startedAt);
      const outcome = isTimeout(error) ? "timed_out" : "failed";
      metrics.jobFinished({ jobName: job.name, outcome }, durationSeconds);
      jobLogger.error(
        {
          duration_seconds: durationSeconds,
          error_category:
            outcome === "timed_out" ? "job_timeout" : "job_failed",
          error_type: error instanceof Error ? error.name : "UnknownError",
          event: outcome === "timed_out" ? "job_timed_out" : "job_failed",
        },
        "Worker job failed",
      );
    },
  };
}

function buildJobContext(job: Job): Record<string, unknown> {
  return {
    attempt: job.attemptsMade + 1,
    job_id: job.id,
    job_name: job.name,
    request_id: extractRequestId(job.data),
  };
}

function extractRequestId(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null || !("requestId" in data)) {
    return undefined;
  }
  const result = requestIdSchema.safeParse(
    (data as { readonly requestId?: unknown }).requestId,
  );
  return result.success ? result.data : undefined;
}

function queueWaitSeconds(job: Job): number | undefined {
  if (
    typeof job.processedOn !== "number" ||
    typeof job.timestamp !== "number"
  ) {
    return undefined;
  }
  return Math.max(0, (job.processedOn - job.timestamp) / 1_000);
}

function elapsedSeconds(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}
