import type { FastifyRequest } from "fastify";
import type { ApiMetrics } from "@tender/observability";

import { metricRouteForRequest } from "./metric-routes.js";

export interface RequestLifecycle {
  start(
    request: FastifyRequest,
    startedAt?: bigint,
    application?: boolean,
  ): void;
  finish(
    request: FastifyRequest,
    statusCode: number,
    applicationSettled?: boolean,
  ): boolean;
  activeCount(): number;
  activeApplicationCount(): number;
}

export function createRequestLifecycle(metrics: ApiMetrics): RequestLifecycle {
  const pending = new WeakMap<
    FastifyRequest,
    {
      startedAt: bigint;
      application: boolean;
      transportFinished: boolean;
      applicationFinished: boolean;
      interrupted: boolean;
    }
  >();
  let active = 0;
  let activeApplication = 0;

  return {
    start(
      request: FastifyRequest,
      startedAt = process.hrtime.bigint(),
      application = true,
    ): void {
      pending.set(request, {
        startedAt,
        application,
        transportFinished: false,
        applicationFinished: false,
        interrupted: false,
      });
      active += 1;
      if (application) activeApplication += 1;
      metrics.requestStarted();
    },
    finish(
      request: FastifyRequest,
      statusCode: number,
      applicationSettled = true,
    ): boolean {
      const entry = pending.get(request);
      if (entry === undefined) return false;
      if (!applicationSettled) entry.interrupted = true;
      if (
        applicationSettled &&
        !entry.interrupted &&
        !entry.applicationFinished
      ) {
        entry.applicationFinished = true;
        if (entry.application) activeApplication -= 1;
      }
      if (entry.transportFinished) {
        if (entry.applicationFinished) pending.delete(request);
        return false;
      }
      entry.transportFinished = true;
      active -= 1;
      metrics.requestFinished(
        {
          method: request.method,
          route: metricRouteForRequest(request),
          statusCode,
        },
        Number(process.hrtime.bigint() - entry.startedAt) / 1_000_000_000,
      );
      if (entry.applicationFinished || !entry.application)
        pending.delete(request);
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
