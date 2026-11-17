import { randomUUID } from "node:crypto";

import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { describe, expect, it, vi } from "vitest";

import { MaintenanceService } from "../src/common/maintenance.service.js";

const redisUrl = process.env.BIDVEDA_MAINTENANCE_TEST_REDIS_URL;
const enabled = redisUrl !== undefined;
if (enabled) {
  const target = new URL(redisUrl);
  if (
    target.protocol !== "redis:" ||
    target.hostname !== "127.0.0.1" ||
    target.port !== "16392"
  )
    throw new Error("Disposable Redis target must be 127.0.0.1:16392");
}

describe.skipIf(!enabled)("disposable BullMQ maintenance drain", () => {
  it("waits for the active job, pauses locally, and resumes queued work once", async () => {
    const queueName = `bidveda-maintenance-${randomUUID()}`;
    const queueConnection = new Redis(redisUrl!, {
      maxRetriesPerRequest: null,
    });
    const workerConnection = new Redis(redisUrl!, {
      maxRetriesPerRequest: null,
    });
    const queue = new Queue(queueName, { connection: queueConnection });
    const processed: string[] = [];
    let started!: () => void;
    let release!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const firstReleased = new Promise<void>((resolve) => {
      release = resolve;
    });
    const worker = new Worker(
      queueName,
      async (job) => {
        if (job.id === "first") {
          started();
          await firstReleased;
        }
        processed.push(job.id ?? "unknown");
      },
      { connection: workerConnection, concurrency: 1 },
    );
    const maintenance = new MaintenanceService();
    maintenance.registerDrainCounter(() => 0);
    maintenance.registerConsumer({
      pause: () => worker.pause(),
      resume: () => worker.resume(),
    });
    try {
      await queue.add("synthetic", {}, { jobId: "first" });
      await firstStarted;
      const enabling = maintenance.setEnabled(true);
      await vi.waitFor(() =>
        expect(maintenance.status().admissionClosed).toBe(true),
      );
      await queue.add("synthetic", {}, { jobId: "second" });
      expect(maintenance.status().consumerPaused).toBe(false);
      release();
      await enabling;
      expect(processed).toEqual(["first"]);
      expect(maintenance.status().consumerPaused).toBe(true);
      await maintenance.setEnabled(false);
      await vi.waitFor(() => expect(processed).toEqual(["first", "second"]), {
        timeout: 5_000,
      });
      await vi.waitFor(
        async () => {
          const counts = await queue.getJobCounts(
            "active",
            "waiting",
            "delayed",
          );
          expect(
            (counts.active ?? 0) +
              (counts.waiting ?? 0) +
              (counts.delayed ?? 0),
          ).toBe(0);
        },
        { timeout: 5_000 },
      );
    } finally {
      release?.();
      await worker.close();
      await queue.obliterate({ force: true });
      await queue.close();
      await workerConnection.quit();
      await queueConnection.quit();
    }
  }, 15_000);
});
