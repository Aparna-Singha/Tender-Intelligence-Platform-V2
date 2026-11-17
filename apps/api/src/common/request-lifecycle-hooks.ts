import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  isOperationalPath,
  shouldRejectForMaintenance,
} from "./maintenance-admission.js";
import type { MaintenanceService } from "./maintenance.service.js";
import type { RequestLifecycle } from "./request-lifecycle.js";

export function registerRequestLifecycleHooks(
  fastify: FastifyInstance,
  requests: RequestLifecycle,
  maintenance: MaintenanceService,
  onStart?: (request: FastifyRequest, startedAt: bigint) => void,
): void {
  fastify.addHook("onRequest", (request, reply, done) => {
    const startedAt = process.hrtime.bigint();
    const rejected = shouldRejectForMaintenance(
      request.url,
      maintenance.isEnabled(),
    );
    onStart?.(request, startedAt);
    requests.start(
      request,
      startedAt,
      !isOperationalPath(request.url) && !rejected,
    );
    request.raw.once("close", () => {
      if (!request.raw.complete) requests.finish(request, 499, false);
    });
    reply.raw.once("close", () => {
      if (!reply.raw.writableFinished) requests.finish(request, 499, false);
    });
    if (rejected) {
      void reply
        .code(503)
        .header("retry-after", "60")
        .send({ message: "Maintenance in progress" });
      return;
    }
    done();
  });
  fastify.addHook("onRequestAbort", (request, done) => {
    requests.finish(request, 499, false);
    done();
  });
  fastify.addHook("onTimeout", (request, _reply, done) => {
    requests.finish(request, 504, false);
    done();
  });
  fastify.addHook("onResponse", (request, reply, done) => {
    requests.finish(request, reply.statusCode, true);
    done();
  });
}
