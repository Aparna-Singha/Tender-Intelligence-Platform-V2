import { describe, expect, it, vi } from "vitest";

import { WorkerReadiness } from "../src/readiness.js";

describe("WorkerReadiness", () => {
  it("returns not_ready promptly when Redis does not answer", async () => {
    vi.useFakeTimers();
    const readiness = new WorkerReadiness({
      database: {
        $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
      } as never,
      queue: {
        getJobCounts: vi.fn().mockResolvedValue({}),
        waitUntilReady: vi.fn().mockResolvedValue(undefined),
      } as never,
      redis: {
        ping: vi.fn(() => new Promise(() => undefined)),
        status: "ready",
      } as never,
    });

    const check = readiness.check();
    await vi.advanceTimersByTimeAsync(2_001);

    await expect(check).resolves.toMatchObject({
      checks: { postgresql: "up", queue: "up", redis: "down" },
      status: "not_ready",
    });
    vi.useRealTimers();
  });
});
