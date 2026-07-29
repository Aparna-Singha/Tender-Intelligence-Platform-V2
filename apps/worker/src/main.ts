import { Queue, Worker } from "bullmq";
import { S3Client } from "@aws-sdk/client-s3";
import { parseEnvironment, workerEnvironmentSchema } from "@tender/config";
import { createPrismaClient, type PrismaClient } from "@tender/database";
import { createLogger } from "@tender/observability";
import { Redis } from "ioredis";

import { createHealthServer } from "./health-server.js";
import { WorkerReadiness } from "./readiness.js";
import { ClamAvScanner } from "./malware-scanner.js";
import { DocumentProcessor, type DocumentJob } from "./document-processor.js";

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
  const storage = new S3Client({
    credentials: {
      accessKeyId: environment.S3_ACCESS_KEY_ID,
      secretAccessKey: environment.S3_SECRET_ACCESS_KEY,
    },
    endpoint: environment.S3_ENDPOINT,
    forcePathStyle: environment.S3_FORCE_PATH_STYLE,
    region: environment.S3_REGION,
  });
  const processor = new DocumentProcessor(
    database,
    storage,
    environment.S3_BUCKET,
    new ClamAvScanner(environment.CLAMAV_HOST, environment.CLAMAV_PORT),
  );
  const documentWorker = new Worker<DocumentJob>(
    environment.QUEUE_NAME,
    async (job) => processor.process(job),
    { connection: redis, concurrency: 2 },
  );
  documentWorker.on("failed", (job, error) => {
    logger.error(
      { errorType: error.name, jobId: job?.id, jobName: job?.name },
      "Document job failed",
    );
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
      documentWorker.close(),
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
    "Worker infrastructure and document consumer are ready",
  );
}

void bootstrap().catch((error: unknown) => {
  const errorType = error instanceof Error ? error.name : "UnknownError";
  process.stderr.write(`Worker startup failed (${errorType}).\n`);
  process.exitCode = 1;
});
