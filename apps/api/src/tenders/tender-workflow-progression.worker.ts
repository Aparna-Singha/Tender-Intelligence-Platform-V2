import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { Worker } from "bullmq";
import {
  TENDER_WORKFLOW_PROGRESS_JOB,
  tenderWorkflowProgressQueueName,
  type TenderWorkflowProgressJob,
} from "@tender/contracts";
import type { ApiEnvironment } from "@tender/config";
import { Redis } from "ioredis";

import { API_ENVIRONMENT } from "../infrastructure.tokens.js";
import { TenderAnalysisOrchestratorService } from "./tender-analysis-orchestrator.service.js";

@Injectable()
export class TenderWorkflowProgressionWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(TenderWorkflowProgressionWorker.name);
  private worker: Worker<TenderWorkflowProgressJob> | null = null;

  public constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    private readonly orchestrator: TenderAnalysisOrchestratorService,
  ) {}

  public onApplicationBootstrap(): void {
    this.worker = new Worker<TenderWorkflowProgressJob>(
      tenderWorkflowProgressQueueName(this.environment.QUEUE_NAME),
      async (job) => {
        if (job.name !== TENDER_WORKFLOW_PROGRESS_JOB) return;
        await this.orchestrator.ensureCurrentPipeline(
          job.data.organisationId,
          job.data.tenderId,
          job.data.userId,
          job.data.requestId,
        );
      },
      {
        concurrency: 2,
        connection: new Redis(this.environment.REDIS_URL, {
          lazyConnect: true,
          maxRetriesPerRequest: null,
        }),
      },
    );
    this.worker.on("failed", (job, error) => {
      this.logger.error(
        `Workflow progression failed for ${job?.data.organisationId ?? "unknown"}/${job?.data.tenderId ?? "unknown"}: ${error.message}`,
      );
    });
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }
}
