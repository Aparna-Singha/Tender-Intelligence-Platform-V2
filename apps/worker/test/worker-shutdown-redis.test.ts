import { randomUUID } from "node:crypto";

import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { expect, it, vi } from "vitest";

import { WorkerShutdown } from "../src/worker-shutdown.js";
import { CompanyUploadRecovery } from "../src/company-upload-recovery.js";

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

it.skipIf(process.env.BIDVEDA_ISOLATED_SHUTDOWN_REDIS !== "YES")(
  "reconciles an acknowledged-lost insertion without a second BullMQ job",
  async () => {
    const redis = new Redis(localRedisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      commandTimeout: 10_000,
    });
    const name = `shutdown-ambiguous-${randomUUID()}`;
    const queue = new Queue(name, { connection: redis });
    const session = {
      id: "synthetic-session",
      organisationId: "synthetic-organisation",
      documentVersionId: "synthetic-version",
      documentVersion: { versionNumber: 1, document: { versions: [] } },
    };
    const database = {
      uploadSession: { findMany: vi.fn().mockResolvedValue([session]) },
    };
    let attempts = 0;
    const uncertainQueue = {
      add: async (...args: Parameters<typeof queue.add>) => {
        attempts += 1;
        const job = await queue.add(...args);
        if (attempts === 1) throw new Error("acknowledgement lost");
        return job;
      },
    };
    try {
      const recovery = new CompanyUploadRecovery(
        database as never,
        uncertainQueue as never,
        vi.fn(),
      );
      await recovery.run();
      await recovery.run();
      expect(attempts).toBe(2);
      expect(await queue.getJobCounts("waiting")).toMatchObject({ waiting: 1 });
      expect(await queue.getJob("synthetic-version")).not.toBeNull();
      database.uploadSession.findMany.mockResolvedValue([]);
      await recovery.run();
      expect(attempts).toBe(2);
      await redis.ping();
    } finally {
      await queue.obliterate({ force: true });
      await queue.close();
      await redis.quit();
    }
  },
);

it.skipIf(process.env.BIDVEDA_ISOLATED_SHUTDOWN_REDIS !== "YES")(
  "drains an active BullMQ job before closing its shared Redis connection",
  async () => {
    const redis = new Redis(localRedisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: null,
    });
    const name = `shutdown-active-${randomUUID()}`;
    const queue = new Queue(name, { connection: redis });
    let release: () => void = () => undefined;
    let started: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = () => resolve();
    });
    const active = new Promise<void>((resolve) => {
      started = () => resolve();
    });
    let sideEffects = 0;
    const worker = new Worker(
      name,
      async () => {
        started();
        await held;
        sideEffects += 1;
      },
      { connection: redis },
    );
    try {
      await queue.add("synthetic-job", {}, { jobId: "synthetic-only" });
      await active;
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
      const stopped = shutdown.run();
      expect(sideEffects).toBe(0);
      expect(await queue.getJobCounts("active")).toMatchObject({ active: 1 });
      release();
      await expect(stopped).resolves.toBe(true);
      expect(sideEffects).toBe(1);
    } finally {
      release();
      if (!worker.closing) await worker.close();
      await queue.close();
      if (redis.status !== "end") redis.disconnect();
    }
  },
);
