import client, { Counter, Gauge, Histogram, Registry } from "prom-client";

const durationBuckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];
const jobDurationBuckets = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 15, 30, 60, 300];
const queueWaitBuckets = [0.01, 0.05, 0.1, 0.5, 1, 5, 15, 30, 60, 300, 900];

export type ServiceName = "api" | "worker";

export interface ServiceMetricsRegistry {
  readonly registry: Registry;
  readonly contentType: string;
  metrics(): Promise<string>;
}

export interface ApiRequestLabels {
  readonly method: string;
  readonly route: string;
  readonly statusCode: number;
}

export interface ApiMetrics {
  readonly registry: ServiceMetricsRegistry;
  requestStarted(): void;
  requestFinished(labels: ApiRequestLabels, durationSeconds: number): void;
  unexpectedError(route: string): void;
  dependencyUnavailable(route: string): void;
}

export interface WorkerJobLabels {
  readonly jobName: string;
}

export interface WorkerJobResultLabels extends WorkerJobLabels {
  readonly outcome: "completed" | "failed" | "timed_out";
}

export interface WorkerMetrics {
  aiOperationFinished(
    labels: {
      readonly operation: "embedding" | "rag_answer" | "draft_generation";
      readonly outcome: "success" | "failure";
      readonly provider: string;
    },
    durationSeconds: number,
  ): void;
  readonly registry: ServiceMetricsRegistry;
  jobStarted(labels: WorkerJobLabels, queueWaitSeconds?: number): void;
  jobFinished(labels: WorkerJobResultLabels, durationSeconds: number): void;
  jobRetried(labels: WorkerJobLabels): void;
  jobStalled(labels: WorkerJobLabels): void;
  setReady(ready: boolean): void;
}

export function createServiceMetricsRegistry(
  service: ServiceName,
): ServiceMetricsRegistry {
  const registry = new Registry();
  registry.setDefaultLabels({ service });
  client.collectDefaultMetrics({ register: registry });

  return {
    contentType: registry.contentType,
    metrics: () => registry.metrics(),
    registry,
  };
}

export function createApiMetrics(): ApiMetrics {
  const serviceRegistry = createServiceMetricsRegistry("api");
  const { registry } = serviceRegistry;
  const requests = new Counter({
    help: "Total API requests by bounded route, method, and status class.",
    labelNames: ["method", "route", "status_class"] as const,
    name: "tip_api_requests_total",
    registers: [registry],
  });
  const durations = new Histogram({
    buckets: durationBuckets,
    help: "API request duration in seconds by bounded route, method, and status class.",
    labelNames: ["method", "route", "status_class"] as const,
    name: "tip_api_request_duration_seconds",
    registers: [registry],
  });
  const active = new Gauge({
    help: "Currently in-flight API requests.",
    name: "tip_api_in_flight_requests",
    registers: [registry],
  });
  const unexpectedErrors = new Counter({
    help: "Unexpected API server errors by bounded route.",
    labelNames: ["route"] as const,
    name: "tip_api_unexpected_errors_total",
    registers: [registry],
  });
  const dependencyUnavailable = new Counter({
    help: "API dependency unavailable responses by bounded route.",
    labelNames: ["route"] as const,
    name: "tip_api_dependency_unavailable_total",
    registers: [registry],
  });

  return {
    dependencyUnavailable: (route) => dependencyUnavailable.inc({ route }),
    registry: serviceRegistry,
    requestFinished: (labels, durationSeconds) => {
      const statusClass = `${Math.trunc(labels.statusCode / 100)}xx`;
      const metricLabels = {
        method: labels.method,
        route: labels.route,
        status_class: statusClass,
      };
      active.dec();
      requests.inc(metricLabels);
      durations.observe(metricLabels, durationSeconds);
    },
    requestStarted: () => active.inc(),
    unexpectedError: (route) => unexpectedErrors.inc({ route }),
  };
}

export function createWorkerMetrics(): WorkerMetrics {
  const serviceRegistry = createServiceMetricsRegistry("worker");
  const { registry } = serviceRegistry;
  const started = new Counter({
    help: "Worker jobs started by bounded job name.",
    labelNames: ["job_name"] as const,
    name: "tip_worker_jobs_started_total",
    registers: [registry],
  });
  const finished = new Counter({
    help: "Worker jobs finished by bounded job name and outcome.",
    labelNames: ["job_name", "outcome"] as const,
    name: "tip_worker_jobs_finished_total",
    registers: [registry],
  });
  const durations = new Histogram({
    buckets: jobDurationBuckets,
    help: "Worker job processing duration in seconds.",
    labelNames: ["job_name", "outcome"] as const,
    name: "tip_worker_job_duration_seconds",
    registers: [registry],
  });
  const queueWait = new Histogram({
    buckets: queueWaitBuckets,
    help: "Worker queue wait duration in seconds when BullMQ timestamps are available.",
    labelNames: ["job_name"] as const,
    name: "tip_worker_job_queue_wait_seconds",
    registers: [registry],
  });
  const active = new Gauge({
    help: "Currently executing worker jobs.",
    labelNames: ["job_name"] as const,
    name: "tip_worker_jobs_active",
    registers: [registry],
  });
  const retries = new Counter({
    help: "Worker jobs retried by bounded job name.",
    labelNames: ["job_name"] as const,
    name: "tip_worker_job_retries_total",
    registers: [registry],
  });
  const stalled = new Counter({
    help: "Worker jobs reported stalled by bounded job name when known.",
    labelNames: ["job_name"] as const,
    name: "tip_worker_jobs_stalled_total",
    registers: [registry],
  });
  const ready = new Gauge({
    help: "Worker readiness state, 1 when ready and 0 when not ready.",
    name: "tip_worker_ready",
    registers: [registry],
  });
  const aiOperationDuration = new Histogram({
    buckets: durationBuckets,
    help: "AI provider operation duration in seconds with bounded labels.",
    labelNames: ["operation", "outcome", "provider"] as const,
    name: "tip_worker_ai_operation_duration_seconds",
    registers: [registry],
  });

  return {
    aiOperationFinished: (labels, durationSeconds) => {
      aiOperationDuration.observe(
        {
          operation: labels.operation,
          outcome: labels.outcome,
          provider: labels.provider,
        },
        durationSeconds,
      );
    },
    jobFinished: (labels, durationSeconds) => {
      active.dec({ job_name: labels.jobName });
      finished.inc({ job_name: labels.jobName, outcome: labels.outcome });
      durations.observe(
        { job_name: labels.jobName, outcome: labels.outcome },
        durationSeconds,
      );
    },
    jobRetried: (labels) => retries.inc({ job_name: labels.jobName }),
    jobStalled: (labels) => stalled.inc({ job_name: labels.jobName }),
    jobStarted: (labels, queueWaitSeconds) => {
      active.inc({ job_name: labels.jobName });
      started.inc({ job_name: labels.jobName });
      if (queueWaitSeconds !== undefined) {
        queueWait.observe({ job_name: labels.jobName }, queueWaitSeconds);
      }
    },
    registry: serviceRegistry,
    setReady: (isReady) => ready.set(isReady ? 1 : 0),
  };
}

export function statusClass(statusCode: number): string {
  return `${Math.trunc(statusCode / 100)}xx`;
}
