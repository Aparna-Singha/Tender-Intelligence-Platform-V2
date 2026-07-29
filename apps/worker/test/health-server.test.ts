import { pino } from "pino";
import { describe, expect, it, vi } from "vitest";

import { createHealthServer } from "../src/health-server.js";
import type { WorkerReadiness } from "../src/readiness.js";

function readinessWith(status: "ready" | "not_ready"): WorkerReadiness {
  return {
    check: vi.fn(() =>
      Promise.resolve({
        checks: {
          postgresql: status === "ready" ? "up" : "down",
          queue: "up",
          redis: "up",
        },
        status,
      }),
    ),
  } as unknown as WorkerReadiness;
}

describe("worker health server", () => {
  it("returns the standard response envelope and preserves safe request IDs", async () => {
    const server = createHealthServer({
      logger: pino({ enabled: false }),
      readiness: readinessWith("ready"),
      requestIdHeader: "x-request-id",
    });

    const response = await server.inject({
      headers: { "x-request-id": "worker-check-123" },
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: { service: "worker", status: "ok" },
      request_id: "worker-check-123",
    });
    await server.close();
  });

  it("returns 503 with check results when dependencies are unavailable", async () => {
    const server = createHealthServer({
      logger: pino({ enabled: false }),
      readiness: readinessWith("not_ready"),
      requestIdHeader: "x-request-id",
    });

    const response = await server.inject({
      method: "GET",
      url: "/ready",
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      data: {
        checks: { postgresql: "down", queue: "up", redis: "up" },
        status: "not_ready",
      },
    });
    expect(response.json().request_id).toMatch(/^[0-9a-f-]{36}$/);
    await server.close();
  });
});
