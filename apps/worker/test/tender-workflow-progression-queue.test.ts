import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import {
  TENDER_WORKFLOW_PROGRESS_JOB,
  tenderWorkflowProgressQueueName,
  tenderWorkflowProgressQueuePolicy,
  type TenderWorkflowProgressJob,
  type TenderWorkflowProgressTriggerType,
} from "@tender/contracts";

export function shouldRunRedisIntegrationTests(
  environment: Readonly<Record<string, string | undefined>>,
): boolean {
  return environment.RUN_REDIS_INTEGRATION_TESTS === "true";
}

function resolveRedisIntegrationUrl(
  environment: Readonly<Record<string, string | undefined>>,
): string {
  const redisUrl = environment.REDIS_URL;
  if (!redisUrl)
    throw new Error(
      "REDIS_URL is required when RUN_REDIS_INTEGRATION_TESTS=true",
    );
  if (!redisUrl.startsWith("redis://"))
    throw new Error("REDIS_URL must use redis:// for Redis integration tests");
  return redisUrl;
}

const runRedisIntegrationTests = shouldRunRedisIntegrationTests(process.env);
const redisUrl = runRedisIntegrationTests
  ? resolveRedisIntegrationUrl(process.env)
  : null;

function createRedis(): Redis {
  if (redisUrl === null)
    throw new Error(
      "Redis integration tests must not create connections without explicit opt-in",
    );
  return new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: null,
  });
}

async function closeRedis(connection: Redis): Promise<void> {
  if ((connection.status as string) === "end") return;
  try {
    await connection.quit();
  } catch (error: unknown) {
    if (!(error instanceof Error) || error.message !== "Connection is closed.")
      throw error;
  } finally {
    if ((connection.status as string) !== "end") connection.disconnect();
  }
}

function createDeferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs = 5_000,
): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("Timed out waiting for queue condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function createJob(
  triggerType: TenderWorkflowProgressTriggerType,
  triggerId: string,
  organisationId = "organisation-a",
  tenderId = "tender-a",
): TenderWorkflowProgressJob {
  return {
    organisationId,
    requestId: `request-${triggerType}-${triggerId}`,
    tenderId,
    triggerId,
    triggerType,
    userId: "user-a",
  };
}

describe("tender workflow progression queue policy", () => {
  it("requires explicit Redis integration opt-in instead of ambient localhost availability", () => {
    expect(
      shouldRunRedisIntegrationTests({
        REDIS_URL: "redis://127.0.0.1:6379",
      }),
    ).toBe(false);
    expect(
      shouldRunRedisIntegrationTests({
        RUN_REDIS_INTEGRATION_TESTS: "false",
        REDIS_URL: "redis://127.0.0.1:6379",
      }),
    ).toBe(false);
    expect(
      shouldRunRedisIntegrationTests({
        RUN_REDIS_INTEGRATION_TESTS: "true",
        REDIS_URL: "redis://127.0.0.1:6379",
      }),
    ).toBe(true);
  });

  it("fails closed when Redis integration is explicitly enabled without a valid Redis URL", () => {
    expect(() =>
      resolveRedisIntegrationUrl({
        RUN_REDIS_INTEGRATION_TESTS: "true",
      }),
    ).toThrowError(
      "REDIS_URL is required when RUN_REDIS_INTEGRATION_TESTS=true",
    );
    expect(() =>
      resolveRedisIntegrationUrl({
        REDIS_URL: "http://127.0.0.1:6379",
        RUN_REDIS_INTEGRATION_TESTS: "true",
      }),
    ).toThrowError("REDIS_URL must use redis:// for Redis integration tests");
  });
});

describe.runIf(runRedisIntegrationTests)(
  "tender workflow progression queue policy",
  () => {
    const resources: {
      connections: Redis[];
      queue: Queue<TenderWorkflowProgressJob> | null;
      worker: Worker<TenderWorkflowProgressJob> | null;
      releases: (() => void)[];
    } = {
      connections: [],
      queue: null,
      releases: [],
      worker: null,
    };

    afterEach(async () => {
      for (const release of resources.releases.splice(0)) {
        release();
      }
      await resources.worker?.close();
      await resources.queue?.close();
      await Promise.all(resources.connections.splice(0).map(closeRedis));
      resources.worker = null;
      resources.queue = null;
    });

    async function setupQueue(
      processor: (job: TenderWorkflowProgressJob) => void | Promise<void>,
      concurrency = 8,
    ): Promise<Queue<TenderWorkflowProgressJob>> {
      const queueName = tenderWorkflowProgressQueueName(
        `workflow-progress-test-${randomUUID()}`,
      );
      const queueConnection = createRedis();
      const workerConnection = createRedis();
      resources.connections.push(queueConnection, workerConnection);
      const queue = new Queue<TenderWorkflowProgressJob>(queueName, {
        connection: queueConnection,
      });
      const worker = new Worker<TenderWorkflowProgressJob>(
        queueName,
        async (job) => {
          if (job.name !== TENDER_WORKFLOW_PROGRESS_JOB) return;
          await processor(job.data);
        },
        { concurrency, connection: workerConnection },
      );
      await queue.waitUntilReady();
      await worker.waitUntilReady();
      resources.queue = queue;
      resources.worker = worker;
      return queue;
    }

    async function enqueueWithPreviousPolicy(
      queue: Queue<TenderWorkflowProgressJob>,
      job: TenderWorkflowProgressJob,
    ): Promise<void> {
      await queue.add(TENDER_WORKFLOW_PROGRESS_JOB, job, {
        attempts: 5,
        backoff: { delay: 2_000, type: "exponential" },
        jobId: `${TENDER_WORKFLOW_PROGRESS_JOB}__${job.organisationId}__${job.tenderId}`,
        removeOnComplete: 100,
      });
    }

    async function enqueueWithCurrentPolicy(
      queue: Queue<TenderWorkflowProgressJob>,
      job: TenderWorkflowProgressJob,
    ): Promise<void> {
      const policy = tenderWorkflowProgressQueuePolicy(job);
      await queue.add(TENDER_WORKFLOW_PROGRESS_JOB, job, {
        attempts: policy.attempts,
        backoff: { delay: policy.backoffDelayMs, type: "exponential" },
        deduplication: {
          id: policy.deduplicationId,
          keepLastIfActive: policy.keepLastIfActive,
        },
        jobId: policy.jobId,
        removeOnComplete: policy.removeOnComplete,
      });
    }

    it("proves the old retained tender-level job id suppresses a later extraction-complete event", async () => {
      const processed: string[] = [];
      const queue = await setupQueue((job) => {
        processed.push(`${job.triggerType}:${job.triggerId}`);
      });

      await enqueueWithPreviousPolicy(
        queue,
        createJob("SOURCE_READY", "version-a"),
      );
      await waitForCondition(() => processed.length === 1);

      await enqueueWithPreviousPolicy(
        queue,
        createJob("EXTRACTION_COMPLETE", "extract-a"),
      );
      await new Promise((resolve) => setTimeout(resolve, 250));

      expect(processed).toEqual(["SOURCE_READY:version-a"]);
    });

    it("keeps progression tender-scoped while still allowing later stages through after the active job finishes", async () => {
      const started: string[] = [];
      const completed: string[] = [];
      const sourceStarted = createDeferred();
      const releaseSource = createDeferred();
      resources.releases.push(releaseSource.resolve);
      const queue = await setupQueue(async (job) => {
        const label = `${job.triggerType}:${job.triggerId}`;
        started.push(label);
        if (job.triggerType === "SOURCE_READY") {
          sourceStarted.resolve();
          await releaseSource.promise;
        }
        completed.push(label);
      });

      await enqueueWithCurrentPolicy(
        queue,
        createJob("SOURCE_READY", "version-a"),
      );
      await sourceStarted.promise;

      await enqueueWithCurrentPolicy(
        queue,
        createJob("SOURCE_READY", "version-a"),
      );
      await enqueueWithCurrentPolicy(
        queue,
        createJob("EXTRACTION_COMPLETE", "extract-a"),
      );
      await enqueueWithCurrentPolicy(
        queue,
        createJob("EXTRACTION_COMPLETE", "extract-a"),
      );

      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(started).toEqual(["SOURCE_READY:version-a"]);

      releaseSource.resolve();

      await waitForCondition(() => completed.length === 2);
      expect(started).toEqual([
        "SOURCE_READY:version-a",
        "EXTRACTION_COMPLETE:extract-a",
      ]);
      expect(completed).toEqual(started);

      await enqueueWithCurrentPolicy(
        queue,
        createJob("CONTINUE_DECISION", "decision-a"),
      );
      await waitForCondition(() => completed.length === 3);

      await enqueueWithCurrentPolicy(
        queue,
        createJob("ELIGIBILITY_COMPLETE", "assessment-a"),
      );
      await waitForCondition(() => completed.length === 4);

      expect(completed).toEqual([
        "SOURCE_READY:version-a",
        "EXTRACTION_COMPLETE:extract-a",
        "CONTINUE_DECISION:decision-a",
        "ELIGIBILITY_COMPLETE:assessment-a",
      ]);
    });
  },
);
