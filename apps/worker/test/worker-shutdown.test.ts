import { describe, expect, it, vi } from "vitest";
import {
  WorkerShutdown,
  type ShutdownDependencies,
  type ShutdownEvent,
} from "../src/worker-shutdown.js";

function deferred(): { promise: Promise<void>; release: () => void } {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    release = () => resolve();
  });
  return { promise, release };
}

function dependencies(order: string[]): ShutdownDependencies {
  return {
    stopScheduling: () => order.push("timer"),
    recovery: () => {
      order.push("recovery");
      return Promise.resolve();
    },
    worker: () => {
      order.push("worker");
      return Promise.resolve();
    },
    queues: () => {
      order.push("queues");
      return Promise.resolve();
    },
    servers: () => {
      order.push("servers");
      return Promise.resolve();
    },
    redis: () => {
      order.push("redis");
      return Promise.resolve();
    },
    database: () => {
      order.push("database");
      return Promise.resolve();
    },
  };
}

const shortTimeouts = {
  RECOVERY_DRAIN: 10,
  BULLMQ_WORKER_CLOSE: 10,
  QUEUE_CLOSE: 10,
  SERVER_CLOSE: 10,
  REDIS_SHUTDOWN: 10,
  PRISMA_SHUTDOWN: 10,
} as const;

describe("worker shutdown", () => {
  it("closes an idle worker in dependency order and coalesces repeated signals", async () => {
    const order: string[] = [];
    const events: ShutdownEvent[] = [];
    const shutdown = new WorkerShutdown(dependencies(order), (event) => {
      events.push(event);
    });
    const first = shutdown.run();
    expect(shutdown.run()).toBe(first);
    await expect(first).resolves.toBe(true);
    expect(order).toEqual([
      "timer",
      "recovery",
      "worker",
      "queues",
      "servers",
      "redis",
      "database",
    ]);
    expect(events.at(-1)).toMatchObject({
      stage: "SHUTDOWN",
      event: "completed",
    });
    expect(events.filter((event) => event.event === "requested")).toHaveLength(
      1,
    );
  });

  it("waits for an in-flight recovery sweep before closing the BullMQ worker", async () => {
    const order: string[] = [];
    const pending = deferred();
    const base = dependencies(order);
    const shutdown = new WorkerShutdown(
      {
        ...base,
        recovery: async () => {
          order.push("recovery");
          await pending.promise;
        },
      },
      vi.fn(),
    );
    const result = shutdown.run();
    expect(order).toEqual(["timer", "recovery"]);
    pending.release();
    await expect(result).resolves.toBe(true);
    expect(order[2]).toBe("worker");
  });

  it("reports a never-settling recovery stage without closing its dependencies", async () => {
    vi.useFakeTimers();
    try {
      const order: string[] = [];
      const events: ShutdownEvent[] = [];
      const pending = deferred();
      const base = dependencies(order);
      const shutdown = new WorkerShutdown(
        {
          ...base,
          recovery: () => pending.promise,
        },
        (event) => {
          events.push(event);
        },
        shortTimeouts,
      );
      const result = shutdown.run();
      await vi.advanceTimersByTimeAsync(11);
      expect(events).toContainEqual(
        expect.objectContaining({
          stage: "RECOVERY_DRAIN",
          event: "failed",
          reason: "timeout",
        }),
      );
      expect(order).toEqual(["timer"]);
      pending.release();
      await expect(result).resolves.toBe(false);
      expect(order).toContain("database");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps Redis and Prisma open until delayed BullMQ closure finishes", async () => {
    const order: string[] = [];
    const pending = deferred();
    const base = dependencies(order);
    const shutdown = new WorkerShutdown(
      {
        ...base,
        worker: async () => {
          order.push("worker");
          await pending.promise;
        },
      },
      vi.fn(),
    );
    const result = shutdown.run();
    await Promise.resolve();
    expect(order).toEqual(["timer", "recovery", "worker"]);
    pending.release();
    await expect(result).resolves.toBe(true);
    expect(order.slice(-2)).toEqual(["redis", "database"]);
  });

  it("stops on a failed stage and reports only fixed labels", async () => {
    const order: string[] = [];
    const events: ShutdownEvent[] = [];
    const base = dependencies(order);
    const shutdown = new WorkerShutdown(
      {
        ...base,
        worker: () => {
          throw new Error("SECRET_URL_AND_DOCUMENT_TEXT");
        },
      },
      (event) => {
        events.push(event);
      },
    );
    await expect(shutdown.run()).resolves.toBe(false);
    expect(order).toEqual(["timer", "recovery"]);
    expect(events).toContainEqual(
      expect.objectContaining({
        stage: "BULLMQ_WORKER_CLOSE",
        event: "failed",
        reason: "rejected",
      }),
    );
    expect(JSON.stringify(events)).not.toContain(
      "SECRET_URL_AND_DOCUMENT_TEXT",
    );
  });
});
