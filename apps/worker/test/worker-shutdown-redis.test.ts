import { randomUUID } from "node:crypto";

import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { expect, it, vi } from "vitest";

import { WorkerShutdown } from "../src/worker-shutdown.js";

const localRedisUrl = "redis://127.0.0.1:16391";

it.skipIf(process.env.BIDVEDA_ISOLATED_SHUTDOWN_REDIS !== "YES")(
  "closes an idle BullMQ worker and shared Redis without force",
  async () => {
    const redis = new Redis(localRedisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: null,
    });
    const name = `shutdown-rehearsal-${randomUUID()}`;
    const queue = new Queue(name, { connection: redis });
    const worker = new Worker(name, () => Promise.resolve(undefined), {
      connection: redis,
    });
    try {
      await worker.waitUntilReady();
      expect(
        await queue.getJobCounts("active", "waiting", "delayed"),
      ).toMatchObject({
        active: 0,
        waiting: 0,
        delayed: 0,
      });
      const shutdown = new WorkerShutdown(
        {
          stopScheduling: () => undefined,
          recovery: () => Promise.resolve(),
          worker: () => worker.close(),
          queues: () => queue.close(),
          servers: () => Promise.resolve(),
          redis: () => redis.quit(),
          database: () => Promise.resolve(),
        },
        () => undefined,
      );
      await expect(shutdown.run()).resolves.toBe(true);
      expect(worker.closing).toBeDefined();
      await vi.waitFor(() => expect(redis.status).toBe("end"), {
        timeout: 1_000,
      });
    } finally {
      if (!worker.closing) await worker.close();
      await queue.close();
      if (redis.status !== "end") redis.disconnect();
    }
  },
);
