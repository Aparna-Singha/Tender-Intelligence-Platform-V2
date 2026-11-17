import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { get } from "node:http";
import type { FastifyRequest } from "fastify";
import type { ApiMetrics } from "@tender/observability";
import type { Queue } from "bullmq";
import type { PrismaClient } from "@tender/database";

import { createRequestLifecycle } from "../src/common/request-lifecycle.js";
import { MaintenanceService } from "../src/common/maintenance.service.js";
import {
  isOperationalPath,
  shouldRejectForMaintenance,
} from "../src/common/maintenance-admission.js";
import { MaintenanceController } from "../src/common/maintenance.controller.js";
import { MaintenanceReconciliationService } from "../src/common/maintenance-reconciliation.service.js";
import { registerRequestLifecycleHooks } from "../src/common/request-lifecycle-hooks.js";
import type { AuthenticatedRequest } from "../src/common/authenticated-request.js";

function request(method = "GET"): FastifyRequest {
  return {
    method,
    url: "/test",
    routeOptions: { url: "/test" },
  } as FastifyRequest;
}

describe("request lifecycle accounting", () => {
  it("finishes normal, failed, aborted, timed out, and disconnected requests exactly once", () => {
    const started = vi.fn();
    const finished = vi.fn();
    const tracker = createRequestLifecycle({
      requestStarted: started,
      requestFinished: finished,
    } as unknown as ApiMetrics);
    const requests = Array.from({ length: 5 }, () => request());
    for (const item of requests) tracker.start(item);
    expect(tracker.activeCount()).toBe(5);
    expect(tracker.activeApplicationCount()).toBe(5);
    for (const [index, status] of [200, 500, 499, 504, 499].entries()) {
      const settled = index < 2;
      expect(tracker.finish(requests[index]!, status, settled)).toBe(true);
      expect(tracker.finish(requests[index]!, status, false)).toBe(false);
    }
    expect(tracker.activeCount()).toBe(0);
    expect(tracker.activeApplicationCount()).toBe(3);
    for (const item of requests.slice(2)) tracker.finish(item, 200, true);
    expect(tracker.activeApplicationCount()).toBe(3);
    expect(started).toHaveBeenCalledTimes(5);
    expect(finished).toHaveBeenCalledTimes(5);
  });

  it("keeps long-lived responses active until completion", () => {
    const tracker = createRequestLifecycle({
      requestStarted: vi.fn(),
      requestFinished: vi.fn(),
    } as unknown as ApiMetrics);
    const long = request();
    tracker.start(long);
    expect(tracker.activeCount()).toBe(1);
    tracker.finish(long, 200);
    expect(tracker.activeCount()).toBe(0);
  });

  it("excludes operational requests and maintenance rejections from drain", () => {
    const tracker = createRequestLifecycle({
      requestStarted: vi.fn(),
      requestFinished: vi.fn(),
    } as unknown as ApiMetrics);
    const operation = request();
    const health = request();
    tracker.start(operation);
    tracker.start(health, undefined, false);
    expect(tracker.activeCount()).toBe(2);
    expect(tracker.activeApplicationCount()).toBe(1);
    tracker.finish(operation, 200);
    expect(tracker.activeApplicationCount()).toBe(0);
    tracker.finish(health, 200);
  });
});

describe("maintenance transitions", () => {
  it("closes admission before pausing and reopens after resuming", async () => {
    const maintenance = new MaintenanceService();
    maintenance.registerDrainCounter(() => 0);
    let finishPause!: () => void;
    const pause = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishPause = resolve;
        }),
    );
    const resume = vi.fn();
    maintenance.registerConsumer({ pause, resume });
    const enabling = maintenance.setEnabled(true);
    expect(maintenance.isEnabled()).toBe(true);
    await vi.waitFor(() => expect(pause).toHaveBeenCalledOnce());
    finishPause();
    await enabling;
    expect(maintenance.status()).toMatchObject({
      admissionClosed: true,
      consumerPaused: true,
      transitioning: false,
    });
    await maintenance.setEnabled(false);
    expect(maintenance.isEnabled()).toBe(false);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it("fails closed when consumer suspension fails", async () => {
    const maintenance = new MaintenanceService();
    maintenance.registerDrainCounter(() => 0);
    maintenance.registerConsumer({
      pause: vi.fn(() => Promise.reject(new Error("sensitive"))),
      resume: vi.fn(),
    });
    await expect(maintenance.setEnabled(true)).rejects.toThrow(
      "Maintenance transition failed",
    );
    expect(maintenance.isEnabled()).toBe(true);
    expect(maintenance.status().consumerPaused).toBe(false);
    await expect(maintenance.setEnabled(false)).rejects.toThrow(
      "Maintenance transition failed",
    );
  });

  it("does not pause the consumer while an accepted operation is active", async () => {
    vi.useFakeTimers();
    try {
      const maintenance = new MaintenanceService();
      let active = 1;
      maintenance.registerDrainCounter(() => active);
      const pause = vi.fn(() => Promise.resolve());
      maintenance.registerConsumer({ pause, resume: vi.fn() });
      const enabling = maintenance.setEnabled(true);
      expect(maintenance.isEnabled()).toBe(true);
      expect(pause).not.toHaveBeenCalled();
      active = 0;
      await vi.advanceTimersByTimeAsync(50);
      await enabling;
      expect(pause).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out a stalled consumer pause without claiming suspension", async () => {
    vi.useFakeTimers();
    try {
      const maintenance = new MaintenanceService();
      maintenance.registerDrainCounter(() => 0);
      let release!: () => void;
      const pause = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );
      maintenance.registerConsumer({ pause, resume: vi.fn() });
      const enabling = maintenance.setEnabled(true);
      const rejected = expect(enabling).rejects.toThrow(
        "Maintenance transition failed",
      );
      await vi.advanceTimersByTimeAsync(120_000);
      await rejected;
      expect(maintenance.isEnabled()).toBe(true);
      await expect(maintenance.setEnabled(false)).rejects.toThrow();
      release();
      await Promise.resolve();
      await maintenance.setEnabled(false);
      expect(maintenance.isEnabled()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reopens admission when application drain times out before pausing", async () => {
    vi.useFakeTimers();
    try {
      const maintenance = new MaintenanceService();
      maintenance.registerDrainCounter(() => 1);
      const pause = vi.fn(() => Promise.resolve());
      maintenance.registerConsumer({ pause, resume: vi.fn() });
      const enabling = maintenance.setEnabled(true);
      const rejected = expect(enabling).rejects.toThrow(
        "Maintenance transition failed",
      );
      await vi.advanceTimersByTimeAsync(30_050);
      await rejected;
      expect(maintenance.isEnabled()).toBe(false);
      expect(pause).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("maintenance admission", () => {
  it("allows only bounded operational routes while active", () => {
    for (const path of [
      "/health",
      "/ready",
      "/maintenance",
      "/maintenance/enable",
      "/maintenance/disable",
      "/maintenance/reconciliation",
    ])
      expect(isOperationalPath(path)).toBe(true);
    for (const path of [
      "/documents",
      "/auth/login",
      "/maintenance/other",
      "/health/other",
    ])
      expect(shouldRejectForMaintenance(path, true)).toBe(true);
    expect(shouldRejectForMaintenance("/documents", false)).toBe(false);
  });

  it("denies a non-operator before changing state", async () => {
    const maintenance = new MaintenanceService();
    const controller = new MaintenanceController(maintenance, {} as never);
    const user = {
      authenticatedUser: { platformRole: null },
    } as AuthenticatedRequest;
    await expect(controller.enable(user)).rejects.toThrow();
    expect(maintenance.isEnabled()).toBe(false);
  });
});

describe("Fastify request lifecycle integration", () => {
  it("accounts for completed, failed, concurrent, and rejected requests", async () => {
    const finished = vi.fn();
    const tracker = createRequestLifecycle({
      requestStarted: vi.fn(),
      requestFinished: finished,
    } as unknown as ApiMetrics);
    const maintenance = new MaintenanceService();
    const app = Fastify();
    registerRequestLifecycleHooks(app, tracker, maintenance);
    app.get("/health", () => ({ ok: true }));
    app.get("/ok", () => ({ ok: true }));
    app.get("/failed", async (_request, reply) => reply.code(500).send());
    try {
      const results = await Promise.all([
        app.inject("/ok"),
        app.inject("/ok"),
        app.inject("/failed"),
      ]);
      expect(results.map((result) => result.statusCode)).toEqual([
        200, 200, 500,
      ]);
      expect(tracker.activeCount()).toBe(0);
      maintenance.registerDrainCounter(() => tracker.activeApplicationCount());
      maintenance.registerConsumer({
        pause: vi.fn(() => Promise.resolve()),
        resume: vi.fn(),
      });
      await maintenance.setEnabled(true);
      expect((await app.inject("/ok")).statusCode).toBe(503);
      expect((await app.inject("/health")).statusCode).toBe(200);
      expect(tracker.activeApplicationCount()).toBe(0);
      await maintenance.setEnabled(false);
      expect((await app.inject("/ok")).statusCode).toBe(200);
      expect(finished).toHaveBeenCalledTimes(6);
    } finally {
      await app.close();
    }
  });

  it("keeps an aborted handler in the application drain after transport closes", async () => {
    const finished = vi.fn();
    const tracker = createRequestLifecycle({
      requestStarted: vi.fn(),
      requestFinished: finished,
    } as unknown as ApiMetrics);
    const app = Fastify();
    registerRequestLifecycleHooks(app, tracker, new MaintenanceService());
    let release!: () => void;
    app.get("/stream", async (_request, reply) => {
      reply.raw.writeHead(200);
      reply.raw.write("partial");
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      reply.raw.end();
    });
    try {
      const address = await app.listen({ host: "127.0.0.1", port: 0 });
      await new Promise<void>((resolve, reject) => {
        const client = get(`${address}/stream`, (response) => {
          response.once("data", () => {
            expect(tracker.activeApplicationCount()).toBe(1);
            response.destroy();
            resolve();
          });
          response.on("error", () => undefined);
        });
        client.on("error", reject);
      });
      await vi.waitFor(() => expect(tracker.activeCount()).toBe(0));
      expect(tracker.activeApplicationCount()).toBe(1);
      expect(finished).toHaveBeenCalledTimes(1);
    } finally {
      release?.();
      await app.close();
    }
  });
});

describe("read-only recovery reconciliation", () => {
  it("reports bounded counts without exposing upload or job identifiers", async () => {
    const findMany = vi
      .fn()
      .mockResolvedValue([{ documentVersionId: "synthetic-version" }]);
    const database = {
      uploadSession: {
        count: vi.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(1),
        findMany,
      },
    } as unknown as PrismaClient;
    const jobs = {
      getJobCounts: vi
        .fn()
        .mockResolvedValue({ active: 0, waiting: 0, failed: 10 }),
      getJob: vi.fn().mockResolvedValue(undefined),
    } as unknown as Queue;
    const workflow = {
      getJobCounts: vi
        .fn()
        .mockResolvedValue({ active: 0, waiting: 0, failed: 0 }),
    } as unknown as Queue;
    const result = await new MaintenanceReconciliationService(
      database,
      jobs,
      workflow,
    ).snapshot();
    expect(result.pendingUnexpiredUploads).toBe(2);
    expect(result.completedUnapprovedUploads).toBe(1);
    expect(result.missingStableJobIds).toBe(1);
    expect(result.primaryQueue.failed).toBe(10);
    expect(result.recoveryIdleProven).toBe(false);
    expect(JSON.stringify(result)).not.toContain("synthetic-version");
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 }),
    );
  });

  it("sanitizes database and Redis failures", async () => {
    const database = {
      uploadSession: {
        count: vi.fn().mockRejectedValue(new Error("credential-or-query")),
        findMany: vi.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaClient;
    const queue = {
      getJobCounts: vi.fn().mockResolvedValue({}),
    } as unknown as Queue;
    await expect(
      new MaintenanceReconciliationService(database, queue, queue).snapshot(),
    ).rejects.toThrow("Maintenance reconciliation unavailable");
  });

  it("bounds an unresponsive read-only snapshot", async () => {
    vi.useFakeTimers();
    try {
      const database = {
        uploadSession: {
          count: vi.fn(() => new Promise<number>(() => undefined)),
          findMany: vi.fn().mockResolvedValue([]),
        },
      } as unknown as PrismaClient;
      const queue = {
        getJobCounts: vi.fn().mockResolvedValue({}),
      } as unknown as Queue;
      const snapshot = new MaintenanceReconciliationService(
        database,
        queue,
        queue,
      ).snapshot();
      const rejected = expect(snapshot).rejects.toThrow(
        "Maintenance reconciliation unavailable",
      );
      await vi.advanceTimersByTimeAsync(10_000);
      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });
});
