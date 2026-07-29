import { randomUUID } from "node:crypto";

import { requestIdSchema } from "@tender/contracts";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";

import type { WorkerReadiness } from "./readiness.js";

export interface HealthServerOptions {
  readonly logger: FastifyBaseLogger;
  readonly readiness: WorkerReadiness;
  readonly requestIdHeader: string;
}

export function createHealthServer(
  options: HealthServerOptions,
): FastifyInstance {
  const server = Fastify({
    genReqId: (request) => {
      const value = request.headers[options.requestIdHeader];
      const candidate = Array.isArray(value) ? value[0] : value;
      const result = requestIdSchema.safeParse(candidate);
      return result.success ? result.data : randomUUID();
    },
    loggerInstance: options.logger,
  });

  server.get("/health", (request) => ({
    data: {
      service: "worker",
      status: "ok" as const,
    },
    request_id: request.id,
  }));

  server.get("/ready", async (request, reply) => {
    const readiness = await options.readiness.check();

    if (readiness.status === "not_ready") {
      void reply.status(503);
    }

    return {
      data: readiness,
      request_id: request.id,
    };
  });

  server.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, "Worker health request failed");
    void reply.status(500).send({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred.",
      },
      request_id: request.id,
    });
  });

  return server;
}
