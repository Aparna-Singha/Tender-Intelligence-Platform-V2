import { Queue } from "bullmq";
import { parseEnvironment, workerEnvironmentSchema } from "@tender/config";
import { createPrismaClient, type PrismaClient } from "@tender/database";
import { createLogger } from "@tender/observability";
import { Redis } from "ioredis";

import { createHealthServer } from "./health-server.js";
import { WorkerReadiness } from "./readiness.js";

async function bootstrap(): Promise<void> {
  const environment = parseEnvironment(
    "worker",
    workerEnvironmentSchema,
    process.env,
  );
  const logger = createLogger({
    environment: environment.NODE_ENV,
    level: environment.LOG_LEVEL,
    service: "worker",
  });
  const database: PrismaClient = createPrismaClient(environment.DATABASE_URL);
  const redis = new Redis(environment.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: null,
  });
  const queue = new Queue(environment.QUEUE_NAME, {
    connection: redis,
  });
  const readiness = new WorkerReadiness({ database, queue, redis });
  const server = createHealthServer({
    logger,
    readiness,
    requestIdHeader: environment.REQUEST_ID_HEADER,
  });
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, "Worker is shutting down");

    const results = await Promise.allSettled([
      server.close(),
      queue.close(),
      redis.quit(),
      database.$disconnect(),
    ]);
    const failed = results.some((result) => result.status === "rejected");

    if (failed) {
      logger.error({ results }, "Worker shutdown completed with errors");
      process.exitCode = 1;
    }
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  await server.listen({
    host: environment.WORKER_HEALTH_HOST,
    port: environment.WORKER_HEALTH_PORT,
  });
  logger.info(
    {
      healthPort: environment.WORKER_HEALTH_PORT,
      queue: environment.QUEUE_NAME,
    },
    "Worker infrastructure is ready; no business consumers are registered",
  );
}

void bootstrap().catch((error: unknown) => {
  const errorType = error instanceof Error ? error.name : "UnknownError";
  process.stderr.write(`Worker startup failed (${errorType}).\n`);
  process.exitCode = 1;
});
