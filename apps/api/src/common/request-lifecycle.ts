import type { FastifyRequest } from "fastify";
import type { ApiMetrics } from "@tender/observability";

import { metricRouteForRequest } from "./metric-routes.js";

export interface RequestLifecycle {
  start(
    request: FastifyRequest,
    startedAt?: bigint,
    application?: boolean,
  ): void;
  finish(request: FastifyRequest, statusCode: number): boolean;
  activeCount(): number;
  activeApplicationCount(): number;
}

export function createRequestLifecycle(metrics: ApiMetrics): RequestLifecycle {
  const pending = new WeakMap<
    FastifyRequest,
    { startedAt: bigint; application: boolean }
  >();
  let active = 0;
  let activeApplication = 0;

  return {
    start(
      request: FastifyRequest,
      startedAt = process.hrtime.bigint(),
      application = true,
    ): void {
      pending.set(request, { startedAt, application });
      active += 1;
      if (application) activeApplication += 1;
      metrics.requestStarted();
    },
    finish(request: FastifyRequest, statusCode: number): boolean {
      const entry = pending.get(request);
      if (entry === undefined) return false;
      pending.delete(request);
      active -= 1;
      if (entry.application) activeApplication -= 1;
      metrics.requestFinished(
        {
          method: request.method,
          route: metricRouteForRequest(request),
          statusCode,
        },
        Number(process.hrtime.bigint() - entry.startedAt) / 1_000_000_000,
      );
      return true;
    },
    activeCount(): number {
      return active;
    },
    activeApplicationCount(): number {
      return activeApplication;
    },
  };
}
