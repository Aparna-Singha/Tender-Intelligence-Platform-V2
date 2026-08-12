import { Queue, Worker, type Job } from "bullmq";
import { S3Client } from "@aws-sdk/client-s3";
import { parseEnvironment, workerEnvironmentSchema } from "@tender/config";
import { createPrismaClient, type PrismaClient } from "@tender/database";
import {
  createLogger,
  createWorkerMetrics,
  type WorkerMetrics,
} from "@tender/observability";
import Fastify, { type FastifyInstance } from "fastify";
import { Redis } from "ioredis";

import { createHealthServer } from "./health-server.js";
import { startJobLifecycle } from "./job-observability.js";
import { WorkerReadiness } from "./readiness.js";
import { ClamAvScanner } from "./malware-scanner.js";
import { DocumentProcessor, type DocumentJob } from "./document-processor.js";
import { runWithTimeout } from "./job-timeout.js";
import { TenderProcessor, type TenderDocumentJob } from "./tender-processor.js";
import {
  ExtractionProcessor,
  type ExtractionJob,
} from "./extraction-processor.js";
import {
  RiskAnalysisProcessor,
  type RiskAnalysisJob,
} from "./risk-analysis-processor.js";
import {
  EvidenceAssessmentProcessor,
  isEvidenceAssessmentJob,
  type EvidenceAssessmentJob,
} from "./evidence-assessment-processor.js";
import {
  ChecklistGenerationProcessor,
  isChecklistGenerationJob,
  type ChecklistGenerationJob,
} from "./checklist-generation-processor.js";
import { GeminiGateway } from "./ai-provider.js";
import { isRagJob, RagProcessor, type RagJob } from "./rag-processor.js";
import {
  DraftGenerationProcessor,
  isDraftGenerationJob,
  type DraftGenerationJob,
} from "./draft-generation-processor.js";
import {
  FinalReadinessProcessor,
  isFinalReadinessJob,
  type FinalReadinessJob,
} from "./final-readiness-processor.js";
import {
  ControlledPackageProcessor,
  isControlledPackageJob,
  type ControlledPackageJob,
} from "./controlled-package-processor.js";

type PlatformJob =
  | DocumentJob
  | TenderDocumentJob
  | ExtractionJob
  | RiskAnalysisJob
  | EvidenceAssessmentJob
  | ChecklistGenerationJob
  | RagJob
  | DraftGenerationJob
  | FinalReadinessJob
  | ControlledPackageJob;

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
  const metrics = createWorkerMetrics();
  const metricsServer = createMetricsServer(metrics);
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
  const tenderProcessor = new TenderProcessor(
    database,
    storage,
    environment.S3_BUCKET,
    new ClamAvScanner(environment.CLAMAV_HOST, environment.CLAMAV_PORT),
  );
  const extractionProcessor = new ExtractionProcessor(
    database,
    storage,
    environment.S3_BUCKET,
  );
  const riskAnalysisProcessor = new RiskAnalysisProcessor(database);
  const evidenceAssessmentProcessor = new EvidenceAssessmentProcessor(database);
  const checklistGenerationProcessor = new ChecklistGenerationProcessor(
    database,
  );
  const gemini = new GeminiGateway(
    environment.GEMINI_API_KEY,
    environment.GEMINI_CHAT_MODEL,
    environment.GEMINI_EMBEDDING_MODEL,
  );
  const ragProcessor = new RagProcessor(database, gemini, gemini);
  const draftGateway = new GeminiGateway(
    environment.GEMINI_API_KEY,
    environment.DRAFT_MODEL,
    environment.GEMINI_EMBEDDING_MODEL,
  );
  const draftGenerationProcessor = new DraftGenerationProcessor(
    database,
    gemini,
    draftGateway,
  );
  const finalReadinessProcessor = new FinalReadinessProcessor(database);
  const controlledPackageProcessor = new ControlledPackageProcessor(
    database,
    storage,
    environment.S3_BUCKET,
    new ClamAvScanner(environment.CLAMAV_HOST, environment.CLAMAV_PORT),
  );
  const documentWorker = new Worker<PlatformJob>(
    environment.QUEUE_NAME,
    async (job) => {
      const lifecycle = startJobLifecycle(job, logger, metrics);
      try {
        const result = await dispatchJob(job);
        lifecycle.complete();
        return result;
      } catch (error: unknown) {
        lifecycle.fail(error);
        throw error;
      }
    },
    { connection: redis, concurrency: 2 },
  );
  async function dispatchJob(job: Job<PlatformJob>): Promise<unknown> {
    if (job.name === "process-tender-document") {
      if (!isTenderDocumentJob(job.data))
        throw new Error("Invalid tender document job");
      const data = job.data;
      return runWithTimeout(environment.DOCUMENT_JOB_TIMEOUT_MS, (signal) =>
        tenderProcessor.process(data, signal),
      );
    }
    if (job.name === "extract-tender-version") {
      if (!isExtractionJob(job.data)) throw new Error("Invalid extraction job");
      const data = job.data;
      return runWithTimeout(environment.EXTRACTION_JOB_TIMEOUT_MS, (signal) =>
        extractionProcessor.process(data, signal),
      );
    }
    if (job.name === "analyse-early-tender-risk") {
      if (!isRiskAnalysisJob(job.data))
        throw new Error("Invalid risk analysis job");
      const data = job.data;
      return runWithTimeout(environment.EXTRACTION_JOB_TIMEOUT_MS, (signal) =>
        riskAnalysisProcessor.process(data, signal),
      );
    }
    if (job.name === "compare-company-evidence") {
      if (!isEvidenceAssessmentJob(job.data))
        throw new Error("Invalid evidence assessment job");
      const data = job.data;
      return runWithTimeout(environment.EXTRACTION_JOB_TIMEOUT_MS, (signal) =>
        evidenceAssessmentProcessor.process(data, signal),
      );
    }
    if (job.name === "generate-missing-action-checklist") {
      if (!isChecklistGenerationJob(job.data))
        throw new Error("Invalid checklist generation job");
      const data = job.data;
      return runWithTimeout(environment.EXTRACTION_JOB_TIMEOUT_MS, (signal) =>
        checklistGenerationProcessor.process(data, signal),
      );
    }
    if (job.name === "index-tender-rag" || job.name === "answer-tender-rag") {
      if (!isRagJob(job.data)) throw new Error("Invalid RAG job");
      const data = job.data;
      return runWithTimeout(environment.RAG_JOB_TIMEOUT_MS, (signal) =>
        ragProcessor.process(data, signal),
      );
    }
    if (job.name === "generate-fact-constrained-draft") {
      if (!isDraftGenerationJob(job.data))
        throw new Error("Invalid draft generation job");
      const data = job.data;
      return runWithTimeout(environment.DRAFT_JOB_TIMEOUT_MS, (signal) =>
        draftGenerationProcessor.process(data, signal),
      );
    }
    if (job.name === "run-final-readiness-audit") {
      if (!isFinalReadinessJob(job.data))
        throw new Error("Invalid final readiness job");
      const data = job.data;
      return runWithTimeout(environment.EXTRACTION_JOB_TIMEOUT_MS, (signal) =>
        finalReadinessProcessor.process(data, signal),
      );
    }
    if (job.name === "generate-controlled-review-package") {
      if (!isControlledPackageJob(job.data))
        throw new Error("Invalid controlled package job");
      const data = job.data;
      return runWithTimeout(environment.DOCUMENT_JOB_TIMEOUT_MS, (signal) =>
        controlledPackageProcessor.process(data, signal),
      );
    }
    if (!isCompanyDocumentJob(job.data))
      throw new Error("Invalid company document job");
    const data = job.data;
    return runWithTimeout(environment.DOCUMENT_JOB_TIMEOUT_MS, (signal) =>
      processor.process(job.name, data, signal),
    );
  }
  documentWorker.on("stalled", (jobId) => {
    logger.warn({ event: "job_stalled", jobId }, "Worker job stalled");
    metrics.jobStalled({ jobName: "unknown" });
  });
  documentWorker.on("error", (error) => {
    logger.error(
      { error_type: error.name, event: "worker_error" },
      "Worker infrastructure error",
    );
  });
  documentWorker.on("failed", (job, error) => {
    logger.error(
      { errorType: error.name, jobId: job?.id, jobName: job?.name },
      "Document job failed",
    );
    if (
      job?.name === "analyse-early-tender-risk" &&
      isRiskAnalysisJob(job.data)
    )
      void riskAnalysisProcessor.fail(job.data.riskAnalysisRunId, error.name);
    if (
      job?.name === "compare-company-evidence" &&
      isEvidenceAssessmentJob(job.data)
    )
      void evidenceAssessmentProcessor.fail(
        job.data.assessmentRunId,
        error.name,
      );
    if (
      (job?.name === "index-tender-rag" || job?.name === "answer-tender-rag") &&
      isRagJob(job.data)
    )
      void ragProcessor.fail(job.data, error);
    if (
      job?.name === "generate-fact-constrained-draft" &&
      isDraftGenerationJob(job.data)
    )
      void draftGenerationProcessor.fail(
        job.data.draftGenerationRunId,
        job.data.organisationId,
        error,
      );
    if (
      job?.name === "generate-missing-action-checklist" &&
      isChecklistGenerationJob(job.data)
    )
      void checklistGenerationProcessor.fail(
        job.data.checklistRunId,
        error.name,
      );
    if (
      job?.name === "run-final-readiness-audit" &&
      isFinalReadinessJob(job.data)
    )
      void finalReadinessProcessor.fail(job.data, error);
    if (
      job?.name === "generate-controlled-review-package" &&
      isControlledPackageJob(job.data)
    )
      logger.error(
        {
          jobId: job.id,
          jobName: job.name,
          runId: job.data.controlledReviewPackageRunId,
        },
        "Controlled package job failed safely",
      );
    if (
      job?.name === "process-company-document" &&
      isCompanyDocumentJob(job.data)
    ) {
      void database.document
        .updateMany({
          data: { status: "FAILED" },
          where: {
            status: { in: ["UPLOADED", "SCANNING", "PROCESSING"] },
            versions: { some: { id: job.data.documentVersionId } },
          },
        })
        .catch((failure: unknown) => {
          logger.error(
            {
              errorType:
                failure instanceof Error ? failure.name : "UnknownError",
              jobId: job.id,
            },
            "Could not persist document job failure",
          );
        });
    }
  });
  const readiness = new WorkerReadiness({ database, queue, redis });
  const server = createHealthServer({
    logger,
    metrics,
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
      metricsServer.close(),
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
  await metricsServer.listen({
    host: environment.WORKER_METRICS_HOST,
    port: environment.WORKER_METRICS_PORT,
  });
  logger.info(
    {
      healthPort: environment.WORKER_HEALTH_PORT,
      metricsPort: environment.WORKER_METRICS_PORT,
      queue: environment.QUEUE_NAME,
    },
    "Worker infrastructure and document consumer are ready",
  );
}

function isTenderDocumentJob(value: PlatformJob): value is TenderDocumentJob {
  return "documentId" in value && "jobId" in value && "requestId" in value;
}

function isCompanyDocumentJob(value: PlatformJob): value is DocumentJob {
  return "documentVersionId" in value;
}

function isExtractionJob(value: PlatformJob): value is ExtractionJob {
  return "extractionRunId" in value && "requestId" in value;
}

function isRiskAnalysisJob(value: PlatformJob): value is RiskAnalysisJob {
  return "riskAnalysisRunId" in value && "requestId" in value;
}

void bootstrap().catch((error: unknown) => {
  const errorType = error instanceof Error ? error.name : "UnknownError";
  process.stderr.write(`Worker startup failed (${errorType}).\n`);
  process.exitCode = 1;
});

function createMetricsServer(metrics: WorkerMetrics): FastifyInstance {
  const server = Fastify({ logger: false });
  server.get("/metrics", async (_request, reply) => {
    void reply.header("content-type", metrics.registry.contentType);
    return metrics.registry.metrics();
  });
  return server;
}
